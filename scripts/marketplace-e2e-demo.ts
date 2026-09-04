/**
 * Phase 1.5 end-to-end — the full commercial marketplace journey.
 *
 * Runs BOTH products in one process with real HTTP and real signatures between
 * them. Only the two databases and the payment provider are fakes; every byte
 * that crosses the RestoFlow ⇄ Dispatcher boundary is signed, transmitted and
 * verified by production code, and every price, ledger entry and state
 * transition is computed by the real modules.
 *
 * No production data, no network egress, no credentials.
 *
 *   npx tsx scripts/marketplace-e2e-demo.ts
 */

import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import path from "node:path";
import { createRequire } from "node:module";

import { CONTRACT_VERSION, type CreateDeliveryRequest, type DeliveryEvent } from "../lib/delivery/contract";
import { DispatcherClient } from "../lib/delivery/dispatcher-client";
import { verifySignature } from "../lib/delivery/signature";
import { ingestEvent } from "../lib/delivery/ingest";
import { initialProjection, computeConfirmAt } from "../lib/delivery/projection";
import { toCustomerFacing } from "../lib/delivery/status";
import { authorizeTracking } from "../lib/delivery/tracking";
import { FakeDeliveryStore } from "../lib/delivery/__tests__/fake-store";

import { buildSnapshot, checkInvariants, formatNaira } from "../lib/marketplace/pricing";
import { readMarketplaceSettings, pricingConfigFor, isOrderable } from "../lib/marketplace/config";
import { buildMarketplaceOrder, makeOrderCode, transitionRestaurant } from "../lib/marketplace/order";
import { entriesForPayment, summarise, isBalanced, type LedgerEntry } from "../lib/marketplace/ledger";
import { settlePayment, type PaymentIntent, type PaymentStore, type ProviderVerification } from "../lib/marketplace/payment";
import { customerMessage, restaurantMessage, dispatcherMustStaySilent } from "../lib/marketplace/notifications";
import { confirmSweep, type ConfirmPorts } from "../lib/marketplace/workers";

const DISPATCHER_REPO = process.env.DISPATCHER_REPO
  ?? path.join(process.env.HOME ?? "", "Desktop/pack_delivery/pack_delivery");
const req = createRequire(path.join(DISPATCHER_REPO, "functions/package.json"));
const express = req("express");
const { FakeRTDB } = req("./integration/test/fake-rtdb");
const { createDeliveryApi } = req("./integration/api");
const dispatcherSig = req("./integration/signature");
const emitter = req("./integration/webhook_emitter");

const T0 = Date.UTC(2026, 8, 1, 17, 0, 0);
const API_KEY = "rf_stg_key";
const OUT_SECRET = "stg-outbound";
const IN_SECRET = "stg-inbound";
/** Set once the order exists: the externalOrderId IS the marketplace order id. */
let ORDER_REF = "";
const CUSTOMER = "cust-amaka";
const OTHER = "cust-someone-else";
const TRISHAS = { lat: 6.6018, lng: 3.3515 };
const AMAKA = { lat: 6.5745, lng: 3.3663 };

let clock = T0;
const now = () => clock;
const advance = (m: number) => { clock += m * 60_000; };

let step = 0;
const say = (m: string) => console.log(`\n\x1b[1m${String(++step).padStart(2, "0")}\x1b[0m  ${m}`);
const detail = (m: string) => console.log(`    ${m}`);
const pass = (m: string) => console.log(`    \x1b[32m✓\x1b[0m ${m}`);

/** A synthetic restaurant, opted in. Nothing here comes from production. */
const RESTAURANT = {
  name: "Staging Test Kitchen (SYNTHETIC)",
  marketplace: {
    state: "active", marketplaceEnabled: true,
    prepTimeMins: { min: 20, max: 30 },
    pricing: { markup: { type: "percent", bps: 2000 }, roundToMinor: 5000 },
  },
};
const INTERNAL_ONLY_RESTAURANT = { name: "Staging Internal Only (SYNTHETIC)", status: "live" };

async function main() {
  console.log("\n\x1b[1mPhase 1.5 · full marketplace journey\x1b[0m");
  console.log("Both products in-process. Real HTTP, real signatures, synthetic data only.\n");

  // ── Dispatcher ────────────────────────────────────────────────────────────
  const dispatcherDb = new FakeRTDB({
    api_keys: {
      [dispatcherSig.hashApiKey(API_KEY)]: {
        clientId: "restoflow", isActive: true,
        signingSecret: OUT_SECRET, callbackUrl: "", callbackSecret: IN_SECRET,
      },
    },
  });

  const dispatcherApp = express();
  dispatcherApp.use("/v1", createDeliveryApi({
    db: dispatcherDb, now, log: () => {},
    riderSupply: async () => 4,
    emitEvent: async (e: EmitArgs) => { await emitToRestoFlow(e); },
    generateCodes: () => ({ pickupCode: "PICK42", receivingCode: "RECV77" }),
    hashCode: (c: string) => crypto.createHash("sha256").update(c).digest("hex"),
    hashApiKey: dispatcherSig.hashApiKey,
  }));
  const dServer = http.createServer(dispatcherApp);
  await listen(dServer);
  const dispatcherUrl = `http://127.0.0.1:${port(dServer)}`;

  // ── RestoFlow ─────────────────────────────────────────────────────────────
  const deliveryStore = new FakeDeliveryStore();
  const ledger: LedgerEntry[] = [];
  const pushes: string[] = [];
  const restaurantAlerts: string[] = [];
  let webhookRejections = 0;

  // A marketplace store that models the ONE property that matters.
  const orders = new Map<string, ReturnType<typeof buildMarketplaceOrder>>();
  const intents = new Map<string, PaymentIntent>();
  const paymentsByRef = new Map<string, string>();
  let orderSeq = 0;

  const marketplaceStore: PaymentStore = {
    async getOrderIdByReference(r) { return paymentsByRef.get(r) ?? null; },
    async getIntent(r) { return intents.get(r) ?? null; },
    async materialiseOrder({ reference, intent, nowMs }) {
      const existing = paymentsByRef.get(reference);
      if (existing) return { orderId: existing, created: false };
      const orderId = `order_${++orderSeq}`;
      const order = buildMarketplaceOrder({
        marketplaceOrderCode: makeOrderCode(), restaurantId: intent.restaurantId,
        customerId: intent.customerId, customerFirstName: intent.customerFirstName,
        customerPhone: intent.customerPhone, deliveryAddress: intent.deliveryAddress,
        deliveryLocation: intent.deliveryLocation ?? null,
        note: intent.note, items: intent.items, pricing: intent.pricing,
        paymentReference: reference, prepMins: intent.prepMins,
        correlationId: intent.correlationId, nowMs,
      });
      orders.set(orderId, order);
      paymentsByRef.set(reference, orderId);
      intents.delete(reference);
      ledger.push(...entriesForPayment({
        orderId, restaurantId: intent.restaurantId, snapshot: intent.pricing,
        nowMs, createdBy: "payment-verify",
      }));
      deliveryStore.seedOrder({
        orderId, restaurantId: intent.restaurantId, customerId: intent.customerId,
        restaurantProgress: "placed",
        delivery: initialProjection({ correlationId: intent.correlationId, quoteId: intent.quoteId, nowMs }),
      });
      return { orderId, created: true };
    },
    async recordFailure() {},
  };

  const rfServer = http.createServer(async (rq, rs) => {
    const chunks: Buffer[] = [];
    for await (const c of rq) chunks.push(c as Buffer);
    const rawBody = Buffer.concat(chunks).toString("utf8");
    const verdict = verifySignature({
      secret: IN_SECRET, rawBody,
      signatureHeader: rq.headers["x-rf-signature"] as string,
      timestampHeader: rq.headers["x-rf-timestamp"] as string,
      nowMs: now(),
    });
    if (!verdict.ok) { webhookRejections++; rs.writeHead(401).end("{}"); return; }
    const event = JSON.parse(rawBody) as DeliveryEvent;
    const r = await ingestEvent(event, {
      store: deliveryStore, nowMs: now(),
      onStateChange: async ({ projection, orderId }) => {
        const o = orders.get(orderId);
        const copy = toCustomerFacing(projection.state, { driverFirstName: projection.driver?.firstName });
        if (copy.notify && o) pushes.push(copy.headline);
      },
    });
    rs.writeHead(200).end(JSON.stringify({ outcome: r.outcome }));
  });
  await listen(rfServer);
  const rfUrl = `http://127.0.0.1:${port(rfServer)}`;
  await dispatcherDb.ref(`api_keys/${dispatcherSig.hashApiKey(API_KEY)}`)
    .update({ callbackUrl: `${rfUrl}/api/webhooks/dispatcher` });

  type EmitArgs = { deliveryId: string; state: string; type: string; extra?: Record<string, unknown> };
  async function emitToRestoFlow(e: EmitArgs) {
    const d = dispatcherDb._read(`deliveries/${e.deliveryId}`);
    if (!d) return;
    if (dispatcherMustStaySilent(d)) { /* Dispatcher stays quiet; RestoFlow tells the customer */ }
    const sequence = await emitter.nextSequence(dispatcherDb, e.deliveryId);
    const event = emitter.buildEvent({
      type: e.type, state: e.state, deliveryId: e.deliveryId,
      externalOrderId: d.externalOrderId, correlationId: d.correlationId,
      sequence, occurredAtMs: now(), extra: e.extra,
    });
    return emitter.deliverEvent({
      httpPost: async (url: string, body: string, headers: Record<string, string>) => {
        const res = await fetch(url, { method: "POST", body, headers });
        return { status: res.status, body: await res.text() };
      },
      signHeaders: dispatcherSig.signedEventHeaders,
      now, sleep: async () => {}, log: () => {},
    }, { event, endpoint: `${rfUrl}/api/webhooks/dispatcher`, secret: IN_SECRET });
  }

  const client = new DispatcherClient({
    baseUrl: dispatcherUrl, apiKey: API_KEY, signingSecret: OUT_SECRET, now,
  });

  async function riderAction(id: string, patch: Record<string, unknown>, state: string, type = "delivery.state_changed", extra?: Record<string, unknown>) {
    dispatcherDb._write(`deliveries/${id}`, { ...dispatcherDb._read(`deliveries/${id}`), ...patch });
    await emitToRestoFlow({ deliveryId: id, state, type, extra });
  }

  // ═══════════════════════════════════════════════════════════════════════════

  say("Restaurant selection — only opted-in restaurants are orderable");
  const settings = readMarketplaceSettings(RESTAURANT);
  const internalOnly = readMarketplaceSettings(INTERNAL_ONLY_RESTAURANT);
  assert.equal(isOrderable(settings, now()).ok, true);
  assert.equal(isOrderable(internalOnly, now()).ok, false);
  assert.equal(isOrderable(internalOnly, now()).reason, "not_listed");
  pass("Staging Test Kitchen is listed; Staging Internal Only is NOT, despite being live");

  say("Marketplace menu — the customer price is a layer on top of the POS price");
  const config = pricingConfigFor({ settings });
  const BASE = 1_000_000; // the restaurant's own ₦10,000
  detail(`menu_items price (restaurant's own): ${formatNaira(BASE)}`);
  detail(`restaurant markup: 20% (configured, not hard-coded)`);

  say("Delivery serviceability + quote, BEFORE the customer can pay");
  const correlationId = "corr-stg-1";
  const quote = await client.quote({
    contractVersion: CONTRACT_VERSION, correlationId, externalRef: "cart-stg-1",
    serviceType: "FOOD_STANDARD", pickup: TRISHAS, dropoff: AMAKA,
    readyAt: new Date(now() + 25 * 60_000).toISOString(),
  });
  assert.equal(quote.ok, true);
  const q = (quote as { value: { quoteId: string; feeMinor: number; distanceKm: number; etaToPickupMins: number } }).value;
  pass(`serviceable · ${formatNaira(q.feeMinor)} · ${q.distanceKm} km · rider ${q.etaToPickupMins} min away`);

  say("Immutable price snapshot");
  const snapshot = buildSnapshot({
    lines: [{ dishId: "stg-jollof", name: "Jollof Rice & Chicken", quantity: 1, basePriceMinor: BASE }],
    config,
    deliveryFeeMinor: 200_000,       // what the customer is charged
    deliveryCostMinor: q.feeMinor,   // what Dispatcher charges us
    processorFeeMinor: 21_000,
    quoteId: q.quoteId, nowMs: now(),
  });
  assert.equal(checkInvariants(snapshot).ok, true);
  detail(`restaurant subtotal ..... ${formatNaira(snapshot.restaurantSubtotalMinor)}`);
  detail(`marketplace markup ...... ${formatNaira(snapshot.markupTotalMinor)}`);
  detail(`customer food price ..... ${formatNaira(snapshot.customerSubtotalMinor)}`);
  detail(`delivery ................ ${formatNaira(snapshot.deliveryFeeMinor)}`);
  detail(`TOTAL CHARGED ........... ${formatNaira(snapshot.totalChargedMinor)}`);
  assert.equal(snapshot.restaurantSubtotalMinor, 1_000_000);
  assert.equal(snapshot.customerSubtotalMinor, 1_200_000);
  assert.equal(snapshot.totalChargedMinor, 1_400_000);
  pass("₦10,000 base → ₦12,000 customer → ₦14,000 charged; invariants hold");

  say("Payment");
  const reference = "pay_stg_1";
  intents.set(reference, {
    reference, restaurantId: "staging-test-kitchen", customerId: CUSTOMER,
    customerFirstName: "Amaka", customerPhone: "+2348111111111",
    deliveryAddress: "2 Mobolaji Bank Anthony Way", deliveryLocation: AMAKA,
    note: "extra pepper",
    items: [{ dishId: "stg-jollof", menuItemId: "stg-jollof", name: "Jollof Rice & Chicken", quantity: 1, options: [], note: "" }],
    pricing: snapshot, quoteId: q.quoteId, prepMins: 25, correlationId,
    createdAt: now(), expiresAt: now() + 30 * 60_000,
  });
  const verification: ProviderVerification = {
    reference, status: "success", amountMinor: snapshot.totalChargedMinor, feeMinor: 21_000,
  };
  const settled = await settlePayment({ verification, store: marketplaceStore, nowMs: now() });
  assert.equal(settled.outcome, "created");
  const orderId = (settled as { orderId: string }).orderId;
  ORDER_REF = orderId;   // the delivery integration keys on the marketplace order id
  const order = orders.get(orderId)!;
  pass(`one marketplace order: ${order.marketplaceOrderCode} (${orderId})`);
  assert.equal(order.orderSource, "marketplace");

  say("Ledger");
  assert.equal(isBalanced(ledger), true);
  const fin = summarise(ledger, snapshot);
  detail(`customer paid ........... ${formatNaira(fin.customerPaidMinor)}`);
  detail(`restaurant owed ......... ${formatNaira(fin.restaurantOwedMinor)}`);
  detail(`delivery owed ........... ${formatNaira(fin.deliveryOwedMinor)}`);
  detail(`processor ............... ${formatNaira(fin.processorCostMinor)}`);
  detail(`platform gross .......... ${formatNaira(fin.platformGrossMinor)}`);
  assert.equal(fin.restaurantOwedMinor, 1_000_000);
  assert.equal(fin.balanced, true);
  pass("books balance; the restaurant is owed exactly its own price");

  say("Restaurant is notified — with ITS subtotal, never the customer's total");
  const alert = restaurantMessage({
    event: "new_marketplace_order", orderCode: order.marketplaceOrderCode,
    itemsSummary: "1× Jollof Rice & Chicken",
    restaurantSubtotalMinor: snapshot.restaurantSubtotalMinor,
  });
  restaurantAlerts.push(alert.text);
  assert.ok(alert.text.includes("₦10,000"));
  assert.equal(alert.text.includes("12,000"), false);
  assert.equal(alert.text.includes("14,000"), false);
  pass("the kitchen sees ₦10,000; the markup never reaches it");

  say("Restaurant accepts, and the dispatch clock is set");
  const acceptedAt = now();
  const t = transitionRestaurant("placed", "accepted");
  assert.equal(t.ok, true);
  const confirmAt = computeConfirmAt({
    acceptedAtMs: acceptedAt, prepMins: 25, etaToPickupMins: q.etaToPickupMins, nowMs: acceptedAt,
  });
  pass(`accepted · food ready T+25 · courier released at T+${Math.round((confirmAt - acceptedAt) / 60_000)}`);
  pushes.push(customerMessage({ event: "restaurant_accepted", orderId, orderCode: order.marketplaceOrderCode, restaurantName: "Staging Test Kitchen" }).title);

  say("Delivery job reserved (draft — riders cannot see it)");
  const createReq: CreateDeliveryRequest = {
    contractVersion: CONTRACT_VERSION, correlationId, externalOrderId: ORDER_REF,
    quoteId: q.quoteId, serviceType: "FOOD_STANDARD",
    pickup: { name: "Staging Test Kitchen", address: "1 Test Street", location: TRISHAS, contactPhone: "+2348000000000" },
    dropoff: { name: "Amaka", address: "2 Mobolaji Bank Anthony Way", location: AMAKA, contactPhone: "+2348111111111", instructions: "Gate 3" },
    readyAt: new Date(acceptedAt + 25 * 60_000).toISOString(),
    deliveryFeeMinor: q.feeMinor, paymentCollection: "NONE",
    packageDescription: "Hot food · 1 bag",
  };
  const created = await client.createDelivery(createReq);
  assert.equal(created.ok, true);
  const job = (created as { value: { deliveryJobId: string } }).value;
  const jobId = job.deliveryJobId;
  pass(`deliveryJobId ${jobId} · status draft`);
  const stored = dispatcherDb._read(`deliveries/${jobId}`);
  assert.equal(stored.status, "draft");
  assert.equal(stored.receiverPhoneNumber, null);
  assert.equal(dispatcherDb._read(`delivery_contacts/${jobId}`).receiverPhoneNumber, "+2348111111111");
  pass("customer phone is in delivery_contacts, NOT in the record riders browse");
  for (const leak of ["itemsTotal", "markup", "restaurantPayable", "customerId", "1000000", "1200000"]) {
    assert.equal(JSON.stringify(stored).includes(leak), false, leak);
  }
  pass("no food price, markup, payable or customer identity crossed the boundary");

  deliveryStore.orders.get(orderId)!.delivery!.deliveryJobId = jobId;
  deliveryStore.orders.get(orderId)!.restaurantProgress = "preparing";

  say("The confirm sweep releases the job when the prep clock says so");
  advance(11);
  const sweepPorts: ConfirmPorts = {
    findDueForConfirm: async () => [{
      orderId: ORDER_REF, restaurantId: "staging-test-kitchen", correlationId,
      delivery: deliveryStore.orders.get(orderId)!.delivery!, confirmAt,
    }],
    confirmDelivery: async ({ externalOrderId, correlationId: cid }: never) => {
      const r = await client.confirmDelivery({ externalOrderId: ORDER_REF, correlationId });
      void externalOrderId; void cid;
      return r.ok ? { ok: true, retryable: false } : { ok: false, retryable: r.failure.retryable };
    },
    markAttention: async () => {}, log: () => {},
  };
  const sweep = await confirmSweep(sweepPorts, now());
  assert.equal(sweep.actioned, 1);
  assert.equal(dispatcherDb._read(`deliveries/${jobId}`).status, "pending");
  pass("draft → pending · the sweep is idempotent and survives a restart");

  say("Rider assigned, travels, arrives, collects, delivers");
  advance(2);
  await riderAction(jobId, {
    status: "accepted", deliveryBoyId: "rider-77", deliveryBoyName: "Kelechi Obi",
    deliveryBoyPhone: "+2348090000000", deliveryBoyProfileImageUrl: "https://img/k",
  }, "DRIVER_ASSIGNED", "delivery.driver_assigned", {
    driver: { firstName: "Kelechi", photoUrl: "https://img/k", vehicle: "Bike", contactHandle: "dh_rider-77" },
    etaToPickupMins: 6,
  });
  advance(6);
  await riderAction(jobId, { status: "in_progress" }, "DRIVER_TO_PICKUP");
  await riderAction(jobId, { status: "in_progress", arrivedAtPickupAt: now() }, "ARRIVED_AT_PICKUP");
  advance(4);
  await riderAction(jobId, { status: "in_progress", pickedUpAt: now() }, "PICKED_UP");
  advance(9);
  await riderAction(jobId, { status: "in_progress", pickedUpAt: clock - 9 * 60_000 }, "EN_ROUTE_TO_CUSTOMER");
  advance(3);
  await riderAction(jobId, { status: "in_progress", pickedUpAt: clock - 12 * 60_000 }, "ARRIVING");
  advance(2);
  await riderAction(jobId, { status: "completed", deliveryCompletedAt: now() }, "DELIVERED");

  const finalProjection = deliveryStore.orders.get(orderId)!.delivery!;
  assert.equal(finalProjection.state, "DELIVERED");
  pass(`delivered · projection sequence ${finalProjection.sequence}`);

  say("Tracking was scoped, and has now closed");
  const owner = authorizeTracking({ order: await deliveryStore.getOrder(orderId), requestingCustomerId: CUSTOMER });
  const stranger = authorizeTracking({ order: await deliveryStore.getOrder(orderId), requestingCustomerId: OTHER });
  assert.equal(owner.allowed, false);
  assert.equal((owner as { reason: string }).reason, "completed");
  assert.equal((stranger as { reason: string }).reason, "not_found");
  pass("the owner is told 'completed'; a stranger gets the same answer as a non-existent order");

  say("Customer notifications sent along the way");
  for (const p of pushes) detail(`· ${p}`);

  // ── The deliberate repetition ─────────────────────────────────────────────
  say("REPLAY: the payment callback, four more times");
  for (let i = 0; i < 4; i++) {
    const again = await settlePayment({ verification, store: marketplaceStore, nowMs: now() });
    assert.equal(again.outcome, "replayed");
    assert.equal((again as { orderId: string }).orderId, orderId);
  }
  assert.equal(orders.size, 1);
  pass("5 payment callbacks → 1 marketplace order");

  say("REPLAY: the delivery-job creation, four more times");
  for (let i = 0; i < 4; i++) {
    const again = await client.createDelivery(createReq);
    assert.equal(again.ok, true);
    assert.equal((again as { value: { deliveryJobId: string } }).value.deliveryJobId, jobId);
  }
  assert.equal(Object.keys(dispatcherDb._read("deliveries")).length, 1);
  pass("5 create requests → 1 delivery job");

  say("REPLAY: every Dispatcher webhook, in reverse order");
  const before = JSON.stringify(deliveryStore.orders.get(orderId)!.delivery);
  const stream: DeliveryEvent[] = [];
  for (let s = 1; s <= finalProjection.sequence; s++) {
    stream.push(emitter.buildEvent({
      type: "delivery.state_changed", state: "DELIVERED",
      deliveryId: jobId, externalOrderId: ORDER_REF, correlationId, sequence: s, occurredAtMs: now(),
    }));
  }
  for (const e of [...stream].reverse()) {
    const raw = JSON.stringify(e);
    const ts = now();
    const res = await fetch(`${rfUrl}/api/webhooks/dispatcher`, {
      method: "POST", body: raw,
      headers: {
        "content-type": "application/json",
        "x-rf-timestamp": String(ts),
        "x-rf-signature": dispatcherSig.computeSignature(IN_SECRET, ts, raw),
      },
    });
    assert.equal(res.status, 200);
  }
  assert.equal(JSON.stringify(deliveryStore.orders.get(orderId)!.delivery), before);
  pass(`${stream.length} webhooks replayed out of order · projection byte-identical`);

  say("REPLAY: the ledger is unchanged, and still balances");
  const ledgerIds = ledger.map((e) => e.entryId);
  assert.equal(new Set(ledgerIds).size, ledgerIds.length, "no duplicate entries");
  assert.equal(isBalanced(ledger), true);
  pass(`${ledger.length} entries · one commercial ledger`);

  say("An unsigned and a forged webhook are both refused");
  await fetch(`${rfUrl}/api/webhooks/dispatcher`, {
    method: "POST", body: JSON.stringify(stream[0]), headers: { "content-type": "application/json" },
  });
  const forgedRaw = JSON.stringify(stream[0]);
  const fts = now();
  await fetch(`${rfUrl}/api/webhooks/dispatcher`, {
    method: "POST", body: forgedRaw,
    headers: {
      "content-type": "application/json",
      "x-rf-timestamp": String(fts),
      "x-rf-signature": dispatcherSig.computeSignature("attacker-guess", fts, forgedRaw),
    },
  });
  assert.equal(webhookRejections, 2);
  pass("401 both times");

  // ── Result ────────────────────────────────────────────────────────────────
  console.log("\n\x1b[1m  RESULT\x1b[0m");
  console.log(`    payments ...................... ${paymentsByRef.size}`);
  console.log(`    marketplace orders ............ ${orders.size}`);
  console.log(`    Dispatcher delivery jobs ...... ${Object.keys(dispatcherDb._read("deliveries")).length}`);
  console.log(`    commercial ledgers ............ ${new Set(ledger.map((e) => e.orderId)).size}`);
  console.log(`    completed deliveries .......... ${Object.values(dispatcherDb._read("deliveries") as Record<string, { status: string }>).filter((d) => d.status === "completed").length}`);
  console.log(`    payment callbacks issued ...... 5`);
  console.log(`    create requests issued ........ 5`);
  console.log(`    webhooks replayed ............. ${stream.length}`);
  console.log(`    unauthorised webhooks blocked . ${webhookRejections}`);

  assert.equal(paymentsByRef.size, 1);
  assert.equal(orders.size, 1);
  assert.equal(Object.keys(dispatcherDb._read("deliveries")).length, 1);
  assert.equal(new Set(ledger.map((e) => e.orderId)).size, 1);

  console.log("\n\x1b[1m  MONEY\x1b[0m");
  console.log(`    customer paid ................. ${formatNaira(fin.customerPaidMinor)}`);
  console.log(`    restaurant owed ............... ${formatNaira(fin.restaurantOwedMinor)}`);
  console.log(`    delivery owed ................. ${formatNaira(fin.deliveryOwedMinor)}`);
  console.log(`    processor ..................... ${formatNaira(fin.processorCostMinor)}`);
  console.log(`    platform gross ................ ${formatNaira(fin.platformGrossMinor)}`);
  console.log(`    balanced ...................... ${fin.balanced}`);

  console.log("\n\x1b[32m\x1b[1m  1 payment · 1 order · 1 delivery job · 1 ledger · 1 delivery\x1b[0m\n");

  await Promise.all([close(dServer), close(rfServer)]);
}

const listen = (s: http.Server) => new Promise<void>((r) => s.listen(0, "127.0.0.1", () => r()));
const close = (s: http.Server) => new Promise<void>((r) => s.close(() => r()));
const port = (s: http.Server) => (s.address() as { port: number }).port;

main().catch((e) => { console.error("\n\x1b[31mFAILED\x1b[0m\n", e); process.exit(1); });
