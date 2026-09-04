/**
 * Phase 1 end-to-end demonstration — RestoFlow ⇄ Dispatcher.
 *
 * Runs BOTH systems in one process, with REAL HTTP and REAL signatures between
 * them. Nothing is mocked at the boundary:
 *
 *   Dispatcher  the actual express router from functions/integration/api.js,
 *               on a real http server, over an in-memory Realtime Database
 *   RestoFlow   the actual DispatcherClient, the actual signature verification,
 *               the actual ingest pipeline and projection reducer, over an
 *               in-memory store
 *
 * The only fakes are the two databases. Every byte that crosses the boundary is
 * signed, transmitted and verified by production code.
 *
 * No production data, no network egress, no credentials.
 *
 *   npx tsx scripts/delivery-e2e-demo.ts
 *   DISPATCHER_REPO=/path/to/dispatcher npx tsx scripts/delivery-e2e-demo.ts
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
import { toCustomerFacing, reduceOrderState, deriveWaitingForOrder } from "../lib/delivery/status";
import { authorizeTracking, buildTrackingPayload } from "../lib/delivery/tracking";
import { FakeDeliveryStore } from "../lib/delivery/__tests__/fake-store";

const DISPATCHER_REPO = process.env.DISPATCHER_REPO
  ?? path.join(process.env.HOME ?? "", "Desktop/pack_delivery/pack_delivery");

const req = createRequire(path.join(DISPATCHER_REPO, "functions/package.json"));
const express = req("express");
const { FakeRTDB } = req("./integration/test/fake-rtdb");
const { createDeliveryApi } = req("./integration/api");
const dispatcherSig = req("./integration/signature");
const dispatcherContract = req("./integration/contract");
const emitter = req("./integration/webhook_emitter");

// ── Scenario ────────────────────────────────────────────────────────────────

const NOW = Date.UTC(2026, 8, 1, 17, 0, 0);
const API_KEY = "rf_demo_key";
const OUTBOUND_SECRET = "demo-outbound-secret"; // RestoFlow → Dispatcher
const INBOUND_SECRET = "demo-inbound-secret";   // Dispatcher → RestoFlow
const ORDER_ID = "RF-DEMO-1";
const CUSTOMER = "cust-amaka";
const OTHER_CUSTOMER = "cust-someone-else";

const TRISHAS = { lat: 6.6018, lng: 3.3515 };
const AMAKA = { lat: 6.5745, lng: 3.3663 };

let clock = NOW;
const now = () => clock;
const advance = (mins: number) => { clock += mins * 60_000; };

let step = 0;
const say = (msg: string) => console.log(`\n\x1b[1m${String(++step).padStart(2, "0")}\x1b[0m  ${msg}`);
const detail = (msg: string) => console.log(`    ${msg}`);
const pass = (msg: string) => console.log(`    \x1b[32m✓\x1b[0m ${msg}`);

async function main() {
  console.log("\n\x1b[1mPhase 1 · RestoFlow ⇄ Dispatcher end-to-end\x1b[0m");
  console.log("Both systems in-process. Real HTTP, real signatures, in-memory databases.\n");

  // ── Stand up Dispatcher ───────────────────────────────────────────────────
  const dispatcherDb = new FakeRTDB({
    api_keys: {
      [dispatcherSig.hashApiKey(API_KEY)]: {
        clientId: "restoflow", isActive: true,
        signingSecret: OUTBOUND_SECRET,
        callbackUrl: "", // filled once RestoFlow's server is listening
        callbackSecret: INBOUND_SECRET,
      },
    },
  });

  type EmitArgs = { deliveryId: string; state: string; type: string; extra?: Record<string, unknown> };
  const emitted: EmitArgs[] = [];

  const dispatcherApp = express();
  dispatcherApp.use("/v1", createDeliveryApi({
    db: dispatcherDb,
    now,
    log: () => {},
    riderSupply: async () => 4,
    emitEvent: async (e: EmitArgs) => {
      emitted.push(e);
      await emitToRestoFlow(e);
    },
    generateCodes: () => ({ pickupCode: "PICK42", receivingCode: "RECV77" }),
    hashCode: (c: string) => crypto.createHash("sha256").update(c).digest("hex"),
    hashApiKey: dispatcherSig.hashApiKey,
  }));
  const dispatcherServer = http.createServer(dispatcherApp);
  await listen(dispatcherServer);
  const dispatcherUrl = `http://127.0.0.1:${port(dispatcherServer)}`;

  // ── Stand up RestoFlow's webhook receiver ─────────────────────────────────
  const store = new FakeDeliveryStore();
  const pushes: string[] = [];
  let webhookRejections = 0;

  const rfServer = http.createServer(async (rq, rs) => {
    const chunks: Buffer[] = [];
    for await (const c of rq) chunks.push(c as Buffer);
    const rawBody = Buffer.concat(chunks).toString("utf8");

    // The production verification path, byte for byte.
    const verdict = verifySignature({
      secret: INBOUND_SECRET, rawBody,
      signatureHeader: rq.headers["x-rf-signature"] as string,
      timestampHeader: rq.headers["x-rf-timestamp"] as string,
      nowMs: now(),
    });
    if (!verdict.ok) {
      webhookRejections++;
      rs.writeHead(401).end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    const event = JSON.parse(rawBody) as DeliveryEvent;
    const result = await ingestEvent(event, {
      store, nowMs: now(),
      onStateChange: async ({ projection }) => {
        const copy = toCustomerFacing(projection.state, { driverFirstName: projection.driver?.firstName });
        if (copy.notify) pushes.push(copy.headline);
      },
    });
    rs.writeHead(200).end(JSON.stringify({ received: true, outcome: result.outcome }));
  });
  await listen(rfServer);
  const rfUrl = `http://127.0.0.1:${port(rfServer)}`;
  await dispatcherDb.ref(`api_keys/${dispatcherSig.hashApiKey(API_KEY)}`).update({
    callbackUrl: `${rfUrl}/api/webhooks/dispatcher`,
  });

  /** Dispatcher's real emitter, over real HTTP, to RestoFlow's real receiver. */
  async function emitToRestoFlow(e: EmitArgs) {
    const d = dispatcherDb._read(`deliveries/${e.deliveryId}`);
    if (!d) return;
    const sequence = await emitter.nextSequence(dispatcherDb, e.deliveryId);
    const event = emitter.buildEvent({
      type: e.type, state: e.state, deliveryId: e.deliveryId,
      externalOrderId: d.externalOrderId, correlationId: d.correlationId,
      sequence, occurredAtMs: now(), extra: e.extra,
    });
    return emitter.deliverEvent(
      {
        httpPost: async (url: string, body: string, headers: Record<string, string>) => {
          const res = await fetch(url, { method: "POST", body, headers });
          return { status: res.status, body: await res.text() };
        },
        signHeaders: dispatcherSig.signedEventHeaders,
        now, sleep: async () => {}, log: () => {},
      },
      { event, endpoint: `${rfUrl}/api/webhooks/dispatcher`, secret: INBOUND_SECRET }
    );
  }

  const client = new DispatcherClient({
    baseUrl: `${dispatcherUrl}`, apiKey: API_KEY, signingSecret: OUTBOUND_SECRET, now,
  });

  /** Move the Dispatcher delivery on, exactly as the rider app would. */
  async function riderAction(deliveryId: string, patch: Record<string, unknown>, state: string, type = "delivery.state_changed", extra?: Record<string, unknown>) {
    const current = dispatcherDb._read(`deliveries/${deliveryId}`);
    dispatcherDb._write(`deliveries/${deliveryId}`, { ...current, ...patch });
    await emitToRestoFlow({ deliveryId, state, type, extra });
  }

  // ═══════════════════════════════════════════════════════════════════════════

  say("A synthetic restaurant and a synthetic marketplace order");
  detail("Trisha's Kitchen · Amaka · 2 items · food already paid to RestoFlow");
  detail(`prep estimate 25 min · order ${ORDER_ID}`);
  const correlationId = "corr-demo-1";

  say("RestoFlow asks Dispatcher to quote the delivery (before the customer pays)");
  const quote = await client.quote({
    contractVersion: CONTRACT_VERSION, correlationId, externalRef: ORDER_ID,
    serviceType: "FOOD_STANDARD", pickup: TRISHAS, dropoff: AMAKA,
    readyAt: new Date(now() + 25 * 60_000).toISOString(),
  });
  assert.equal(quote.ok, true, "quote must succeed");
  const q = (quote as { value: { serviceable: boolean; quoteId: string; feeMinor: number; distanceKm: number; etaToPickupMins: number; etaToDropoffMins: number } }).value;
  assert.equal(q.serviceable, true);
  pass(`serviceable · ₦${(q.feeMinor / 100).toLocaleString()} · ${q.distanceKm} km · rider ${q.etaToPickupMins} min away · ${q.etaToDropoffMins} min to the door`);
  detail(`quote ${q.quoteId} persisted by Dispatcher`);

  say("An unserviceable address is refused BEFORE the customer can pay");
  const far = await client.quote({
    contractVersion: CONTRACT_VERSION, correlationId: "corr-far", externalRef: "cart-far",
    serviceType: "FOOD_STANDARD", pickup: TRISHAS, dropoff: { lat: 7.3775, lng: 3.9470 },
  });
  assert.equal(far.ok, false);
  assert.equal((far as { failure: { kind: string } }).failure.kind, "unserviceable");
  pass("Ibadan → 422 unserviceable, and the client does NOT retry a definite answer");

  say("Customer pays · restaurant accepts · RestoFlow computes when to dispatch");
  const acceptedAt = now();
  const confirmAt = computeConfirmAt({ acceptedAtMs: acceptedAt, prepMins: 25, etaToPickupMins: q.etaToPickupMins, nowMs: acceptedAt });
  pass(`accepted at T+0 · food ready at T+25 · confirm at T+${Math.round((confirmAt - acceptedAt) / 60_000)} min`);
  detail("the rider is released only when the kitchen is nearly done");

  say("RestoFlow reserves ONE delivery job (draft — riders cannot see it)");
  const createReq: CreateDeliveryRequest = {
    contractVersion: CONTRACT_VERSION, correlationId, externalOrderId: ORDER_ID,
    quoteId: q.quoteId, serviceType: "FOOD_STANDARD",
    pickup: { name: "Trisha's Kitchen", address: "1 Allen Avenue, Ikeja", location: TRISHAS, contactPhone: "+2348000000000", instructions: "Collect at the counter, quote the pickup code" },
    dropoff: { name: "Amaka", address: "2 Mobolaji Bank Anthony Way", location: AMAKA, contactPhone: "+2348111111111", instructions: "Gate 3, call on arrival" },
    readyAt: new Date(acceptedAt + 25 * 60_000).toISOString(),
    deliveryFeeMinor: q.feeMinor, paymentCollection: "NONE",
    packageDescription: "Hot food · 2 bags",
  };
  const created = await client.createDelivery(createReq);
  assert.equal(created.ok, true);
  const job = (created as { value: { deliveryJobId: string; state: string; replayed: boolean; pickupCode: string; receivingCode: string } }).value;
  assert.equal(job.state, "REQUESTED");
  assert.equal(job.replayed, false);
  pass(`deliveryJobId ${job.deliveryJobId} · state REQUESTED · pickup code ${job.pickupCode} · receiving code ${job.receivingCode}`);
  assert.equal(dispatcherDb._read(`deliveries/${job.deliveryJobId}`).status, "draft");
  pass("Dispatcher holds it as `draft` — invisible to every rider");

  const storedJob = JSON.stringify(dispatcherDb._read(`deliveries/${job.deliveryJobId}`));
  for (const leak of ["itemsTotal", "markup", "restaurantPayable", "customerId", "paymentReference"]) {
    assert.equal(storedJob.includes(leak), false);
  }
  pass("no food price, markup, settlement figure or customer identity crossed the boundary");

  store.seedOrder({
    orderId: ORDER_ID, restaurantId: "trishas-kitchen", customerId: CUSTOMER,
    restaurantName: "Trisha's Kitchen", restaurantProgress: "preparing",
    delivery: { ...initialProjection({ correlationId, quoteId: q.quoteId, nowMs: now() }), deliveryJobId: job.deliveryJobId },
  });

  say("DUPLICATE CREATE: RestoFlow retries the same order four more times");
  const ids = new Set([job.deliveryJobId]);
  for (let i = 0; i < 4; i++) {
    const again = await client.createDelivery(createReq);
    assert.equal(again.ok, true);
    const v = (again as { value: { deliveryJobId: string; replayed: boolean } }).value;
    assert.equal(v.replayed, true);
    ids.add(v.deliveryJobId);
  }
  assert.equal(ids.size, 1);
  assert.equal(Object.keys(dispatcherDb._read("deliveries")).length, 1);
  pass(`5 create requests → 1 delivery job (${[...ids][0]})`);

  say("A materially different payload under the same order id is REFUSED");
  const tampered = await client.createDelivery({ ...createReq, deliveryFeeMinor: 999900 });
  assert.equal(tampered.ok, false);
  assert.equal((tampered as { failure: { kind: string } }).failure.kind, "conflict");
  assert.equal(dispatcherDb._read(`deliveries/${job.deliveryJobId}`).orderCost, String(Math.round(q.feeMinor / 100)));
  pass("409 conflict · the original delivery is untouched");

  say("The prep clock fires — RestoFlow releases the job to riders");
  advance(11);
  const confirmed = await client.confirmDelivery({ externalOrderId: ORDER_ID, correlationId });
  assert.equal(confirmed.ok, true);
  assert.equal(dispatcherDb._read(`deliveries/${job.deliveryJobId}`).status, "pending");
  pass("draft → pending · this is the trigger the existing rider broadcast fires on");
  assert.equal(store.orders.get(ORDER_ID)!.delivery!.state, "SEARCHING_FOR_DRIVER");
  pass("event reached RestoFlow · projection now SEARCHING_FOR_DRIVER");

  say("Before a rider exists, tracking is refused");
  let decision = authorizeTracking({ order: await store.getOrder(ORDER_ID), requestingCustomerId: CUSTOMER });
  assert.equal(decision.allowed, false);
  pass(`the owning customer is told "${(decision as { reason: string }).reason}" — there is nothing to show yet`);

  say("A rider accepts");
  advance(2);
  await riderAction(job.deliveryJobId, {
    status: "accepted", deliveryBoyId: "rider-77", deliveryBoyName: "Kelechi Obi",
    deliveryBoyPhone: "+2348090000000", deliveryBoyProfileImageUrl: "https://img/kelechi",
  }, "DRIVER_ASSIGNED", "delivery.driver_assigned", {
    driver: { firstName: "Kelechi", photoUrl: "https://img/kelechi", vehicle: "Bike", contactHandle: "dh_rider-77" },
    etaToPickupMins: 6,
  });
  const assigned = store.orders.get(ORDER_ID)!.delivery!;
  assert.equal(assigned.state, "DRIVER_ASSIGNED");
  assert.equal(assigned.driver?.firstName, "Kelechi");
  pass(`RestoFlow sees: ${toCustomerFacing(assigned.state, { driverFirstName: "Kelechi" }).headline}`);
  assert.equal(JSON.stringify(assigned).includes("Obi"), false);
  assert.equal(JSON.stringify(assigned).includes("+2348090000000"), false);
  pass("surname and rider phone did NOT cross — only the public projection did");

  say("Rider travels · arrives · the kitchen is still plating");
  advance(6);
  await riderAction(job.deliveryJobId, { status: "in_progress" }, "DRIVER_TO_PICKUP");
  await riderAction(job.deliveryJobId, { status: "in_progress", arrivedAtPickupAt: now() }, "ARRIVED_AT_PICKUP");
  const arrived = store.orders.get(ORDER_ID)!.delivery!;
  const derived = deriveWaitingForOrder(arrived.state, "preparing");
  assert.equal(derived, "WAITING_FOR_ORDER");
  pass(`RestoFlow derives WAITING_FOR_ORDER — Dispatcher cannot know the food is not ready`);
  detail(`customer reads: "${toCustomerFacing(derived, { driverFirstName: "Kelechi" }).headline}"`);

  say("Live tracking, now that a rider is assigned");
  dispatcherDb._write(`deliveries/${job.deliveryJobId}/deliveryBoyLiveLocation`, { latitude: 6.59211234, longitude: 3.35899876 });
  dispatcherDb._write(`deliveries/${job.deliveryJobId}/deliveryBoyLiveTimestamp`, now());
  decision = authorizeTracking({ order: await store.getOrder(ORDER_ID), requestingCustomerId: CUSTOMER });
  assert.equal(decision.allowed, true);
  const live = await client.getTracking({ externalOrderId: ORDER_ID, correlationId });
  assert.equal(live.ok, true);
  const t = (live as { value: { location: { lat: number; lng: number; recordedAt: string } | null } }).value;
  const payload = buildTrackingPayload({
    state: arrived.state, headline: "at the restaurant", detail: null, showMap: true,
    driver: arrived.driver,
    raw: t.location ? { lat: t.location.lat, lng: t.location.lng, recordedAtMs: Date.parse(t.location.recordedAt) } : null,
    etaToDropoffMins: 14, nowMs: now(),
  });
  assert.ok(payload.location);
  pass(`position ${payload.location!.lat}, ${payload.location!.lng} (coarsened from 6.59211234, 3.35899876)`);

  say("IDOR: a different customer asks for this same order");
  const attack = authorizeTracking({ order: await store.getOrder(ORDER_ID), requestingCustomerId: OTHER_CUSTOMER });
  assert.equal(attack.allowed, false);
  assert.equal((attack as { reason: string }).reason, "not_found");
  pass("`not_found` — identical to an order that does not exist, so ids cannot be enumerated");

  say("Pickup · en route · arriving · delivered");
  advance(4);
  await riderAction(job.deliveryJobId, { status: "in_progress", pickedUpAt: now() }, "PICKED_UP");
  advance(8);
  await riderAction(job.deliveryJobId, { status: "in_progress", pickedUpAt: clock - 8 * 60_000 }, "EN_ROUTE_TO_CUSTOMER");
  advance(5);
  await riderAction(job.deliveryJobId, { status: "in_progress", pickedUpAt: clock - 13 * 60_000 }, "ARRIVING");
  advance(2);
  await riderAction(job.deliveryJobId, { status: "completed", deliveryCompletedAt: now() }, "DELIVERED");

  const final = store.orders.get(ORDER_ID)!.delivery!;
  assert.equal(final.state, "DELIVERED");
  pass(`RestoFlow projection: DELIVERED (sequence ${final.sequence})`);
  assert.equal(reduceOrderState("ready", final.state), "completed");
  pass("order state reduces to `completed`");

  say("Tracking access ENDS at completion");
  const after = authorizeTracking({ order: await store.getOrder(ORDER_ID), requestingCustomerId: CUSTOMER });
  assert.equal(after.allowed, false);
  assert.equal((after as { reason: string }).reason, "completed");
  pass("the owning customer can no longer retrieve a courier position");

  say("Customer push notifications sent along the way");
  for (const p of pushes) detail(`· ${p}`);
  assert.ok(pushes.includes("Courier assigned"));
  assert.ok(pushes.includes("Delivered"));

  // ── The deliberate repetition Phase 1 must survive ────────────────────────
  say("DELIBERATE REPLAY: every status webhook re-sent, in reverse order");
  const beforeReplay = JSON.stringify(store.orders.get(ORDER_ID)!.delivery);
  const claimedBefore = store.claims.size;

  const allEvents: DeliveryEvent[] = [];
  for (let seq = 1; seq <= final.sequence; seq++) {
    const stored = dispatcherDb._read(`deliveries/${job.deliveryJobId}`);
    allEvents.push(emitter.buildEvent({
      type: "delivery.state_changed",
      state: dispatcherContract.toCanonicalState(stored),
      deliveryId: job.deliveryJobId, externalOrderId: ORDER_ID,
      correlationId, sequence: seq, occurredAtMs: now(),
    }));
  }
  for (const e of [...allEvents].reverse()) {
    const raw = JSON.stringify(e);
    const ts = now();
    const res = await fetch(`${rfUrl}/api/webhooks/dispatcher`, {
      method: "POST", body: raw,
      headers: {
        "content-type": "application/json",
        "x-rf-timestamp": String(ts),
        "x-rf-signature": dispatcherSig.computeSignature(INBOUND_SECRET, ts, raw),
      },
    });
    assert.equal(res.status, 200, "a replay must be accepted, not retried forever");
  }
  assert.equal(JSON.stringify(store.orders.get(ORDER_ID)!.delivery), beforeReplay);
  pass(`${allEvents.length} events replayed out of order · projection byte-identical`);
  assert.equal(store.claims.size, claimedBefore);
  pass("no new event claims — every replay was recognised as a duplicate");

  say("DELIBERATE REPLAY: the create request, once more, after delivery");
  const lateCreate = await client.createDelivery(createReq);
  assert.equal(lateCreate.ok, true);
  assert.equal((lateCreate as { value: { deliveryJobId: string } }).value.deliveryJobId, job.deliveryJobId);
  assert.equal(Object.keys(dispatcherDb._read("deliveries")).length, 1);
  pass("still one delivery job");

  say("An UNSIGNED webhook is refused");
  const bad = await fetch(`${rfUrl}/api/webhooks/dispatcher`, {
    method: "POST", body: JSON.stringify(allEvents[0]),
    headers: { "content-type": "application/json" },
  });
  assert.equal(bad.status, 401);
  pass("401 · an unsigned callback cannot mark an order delivered");

  say("A FORGED webhook with a wrong secret is refused");
  const forgedRaw = JSON.stringify({ ...allEvents[0], state: "DELIVERED" });
  const fts = now();
  const forged = await fetch(`${rfUrl}/api/webhooks/dispatcher`, {
    method: "POST", body: forgedRaw,
    headers: {
      "content-type": "application/json",
      "x-rf-timestamp": String(fts),
      "x-rf-signature": dispatcherSig.computeSignature("attacker-guess", fts, forgedRaw),
    },
  });
  assert.equal(forged.status, 401);
  assert.equal(webhookRejections, 2);
  pass("401 · the API key alone is not sufficient to forge an event");

  // ── Final ledger of the run ───────────────────────────────────────────────
  console.log("\n\x1b[1m  RESULT\x1b[0m");
  const marketplaceOrders = 1;
  const deliveryJobs = Object.keys(dispatcherDb._read("deliveries")).length;
  const finalDeliveries = Object.values(dispatcherDb._read("deliveries") as Record<string, { status: string }>)
    .filter((d) => d.status === "completed").length;
  console.log(`    marketplace orders ............ ${marketplaceOrders}`);
  console.log(`    Dispatcher delivery jobs ...... ${deliveryJobs}`);
  console.log(`    completed deliveries .......... ${finalDeliveries}`);
  console.log(`    create requests issued ........ 7 (1 new, 5 replays, 1 conflict)`);
  console.log(`    webhooks delivered ............ ${final.sequence}`);
  console.log(`    webhooks replayed ............. ${allEvents.length}`);
  console.log(`    unauthorised webhooks blocked . ${webhookRejections}`);
  assert.equal(marketplaceOrders, 1);
  assert.equal(deliveryJobs, 1);
  assert.equal(finalDeliveries, 1);

  console.log("\n\x1b[1m  CORRELATION\x1b[0m");
  console.log(`    marketplaceOrderId ... ${ORDER_ID}`);
  console.log(`    deliveryJobId ........ ${job.deliveryJobId}`);
  console.log(`    quoteId .............. ${q.quoteId}`);
  console.log(`    correlationId ........ ${correlationId}`);
  console.log(`    timeline entries ..... ${store.timeline.length}`);

  console.log("\n\x1b[32m\x1b[1m  one marketplace order · one Dispatcher delivery job · one final delivery\x1b[0m\n");

  await Promise.all([close(dispatcherServer), close(rfServer)]);
}

const listen = (s: http.Server) => new Promise<void>((r) => s.listen(0, "127.0.0.1", () => r()));
const close = (s: http.Server) => new Promise<void>((r) => s.close(() => r()));
const port = (s: http.Server) => (s.address() as { port: number }).port;

main().catch((err) => { console.error("\n\x1b[31mDEMONSTRATION FAILED\x1b[0m\n", err); process.exit(1); });
