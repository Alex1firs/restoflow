import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { CONTRACT_VERSION, type CreateDeliveryRequest } from "@/lib/delivery/contract";
import { readDeliveryConfig } from "@/lib/delivery/config";
import { DispatcherClient } from "@/lib/delivery/dispatcher-client";
import { initialProjection } from "@/lib/delivery/projection";
import { readConnectSettings, connectReadiness } from "./config";
import { priceConnectDelivery } from "./pricing";
import { connectEntries, connectRefundEntries, connectBalance } from "./ledger";
import { ConnectStore } from "./store";
import { initializeConnectPayment, refundConnectPayment } from "./payments";
import type { ConnectDelivery, ConnectPlace, ConnectQuote } from "./types";

/**
 * RestoFlow Connect — the internal service.
 *
 * ── One entry point, several callers ─────────────────────────────────────────
 * The merchant screens will call this. The Enterprise API will call this. There
 * is deliberately no second path to Dispatcher: the moment a partner-facing API
 * builds its own `CreateDeliveryRequest`, the two drift, and the one with fewer
 * eyes on it is the one that gets the margin or the idempotency wrong.
 *
 * ── Nothing here is a marketplace order ──────────────────────────────────────
 * No basket, no payment, no `orders` document. The food order happened on
 * WhatsApp or a phone call, somewhere RestoFlow cannot see, and pretending
 * otherwise would put permanently-null columns through the marketplace's
 * machinery.
 */

export type ConnectFailure = { ok: false; reason: string; detail?: string };
export type QuoteOk = { ok: true; delivery: ConnectDelivery; quote: ConnectQuote };
export type RequestOk = { ok: true; delivery: ConnectDelivery; replayed: boolean };

/** How long a partner has to accept a quote before it must be asked for again. */
export const QUOTE_TTL_MS = 10 * 60 * 1000;

/**
 * The Dispatcher client Connect calls with.
 *
 * ── Why Connect has its own credentials ──────────────────────────────────────
 * Dispatcher classifies a job by the API key that created it, not by anything
 * in the payload — which is correct, because a partner must not be able to
 * declare what kind of partner it is. So Connect authenticates as itself, and
 * its jobs come back stamped `restoflow_connect`.
 *
 * This is also the seam the Enterprise API will use: a future third-party
 * partner is another registered client calling this same service, not another
 * integration.
 *
 * Falls back to the marketplace credentials when Connect's are unset, so a
 * half-configured environment fails at classification rather than at boot —
 * and `connectClientIsDistinct()` lets a test say so out loud.
 */
function client() {
  const cfg = readDeliveryConfig();
  if (!cfg.ok) return null;
  if (!cfg.config.enabled) return null;

  const apiKey = process.env.CONNECT_DISPATCHER_API_KEY?.trim() || cfg.config.apiKey;
  const signingSecret =
    process.env.CONNECT_DISPATCHER_SIGNING_SECRET?.trim() || cfg.config.signingSecret;

  return new DispatcherClient({
    ...cfg.config,
    apiKey,
    signingSecret,
    log: (event: string, fields: Record<string, unknown>) =>
      console.log(JSON.stringify({ scope: "connect_dispatcher", event, ...fields })),
  });
}

/** True when Connect authenticates as itself rather than borrowing the marketplace's identity. */
export function connectClientIsDistinct(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!env.CONNECT_DISPATCHER_API_KEY?.trim() && !!env.CONNECT_DISPATCHER_SIGNING_SECRET?.trim();
}

async function partnerContext(db: Firestore, restaurantId: string) {
  const snap = await db.collection("restaurants").doc(restaurantId).get();
  if (!snap.exists) return { ok: false as const, reason: "restaurant_not_found" };
  const raw = snap.data() ?? {};
  const settings = readConnectSettings(raw);
  const readiness = connectReadiness(settings, {
    isProduction: (process.env.DELIVERY_ENVIRONMENT ?? "development") === "production",
  });
  if (!readiness.ok) return { ok: false as const, reason: readiness.reason };

  const lat = Number(raw.latitude);
  const lng = Number(raw.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) {
    // The partner's own saved location is the pickup. Without it there is
    // nothing to collect from, and guessing is not an option.
    return { ok: false as const, reason: "pickup_location_not_set" };
  }

  return {
    ok: true as const,
    settings,
    pickup: {
      name: settings.pickupName ?? String(raw.name ?? restaurantId),
      address: String(raw.address ?? ""),
      location: { lat, lng },
      contactPhone: String(raw.phone ?? raw.notificationPhone ?? ""),
      instructions: settings.defaultPickupInstructions,
    },
  };
}

/**
 * Price a delivery, and remember what was quoted.
 *
 * The quote is persisted with its expiry because the partner sees a number and
 * then goes away to think about it. When they come back, the question is not
 * "what does this cost" but "is what we told them still true" — and that can
 * only be answered against what was actually said.
 */
export async function quoteConnectDelivery(args: {
  db: Firestore;
  restaurantId: string;
  createdByUid: string;
  dropoff: ConnectPlace & { name: string };
  packageDescription: string;
  readyAt: string;
  nowMs?: number;
  /** Re-quoting an existing delivery in place, rather than starting a new one. */
  reuseDeliveryId?: string;
}): Promise<QuoteOk | ConnectFailure> {
  const nowMs = args.nowMs ?? Date.now();
  const ctx = await partnerContext(args.db, args.restaurantId);
  if (!ctx.ok) return { ok: false, reason: ctx.reason };

  const c = client();
  if (!c) return { ok: false, reason: "delivery_integration_disabled" };

  const id = args.reuseDeliveryId ?? `cn_${randomBytes(9).toString("hex")}`;
  const correlationId = `cn-${randomUUID().slice(0, 13)}`;

  const res = await c.quote({
    contractVersion: CONTRACT_VERSION,
    correlationId,
    // Never a customer id, and never a marketplace order id — this delivery is
    // its own anchor from the moment it is priced.
    externalRef: id,
    serviceType: "FOOD_STANDARD",
    pickup: ctx.pickup.location,
    dropoff: args.dropoff.location,
    readyAt: args.readyAt,
  });

  if (!res.ok) return { ok: false, reason: "quote_failed", detail: res.failure.kind };
  const q = res.value;
  if (!q.serviceable || q.quoteId == null || q.feeMinor == null) {
    return { ok: false, reason: "not_serviceable", detail: q.reason ?? undefined };
  }

  const price = priceConnectDelivery({
    dispatcherCostMinor: q.feeMinor,
    marginBps: ctx.settings.marginBps!,
  });

  // Dispatcher's own expiry wins when it gives one; ours is the ceiling.
  const dispatcherExpiry = q.expiresAt ? Date.parse(q.expiresAt) : NaN;
  const expiresAtMs = Number.isFinite(dispatcherExpiry)
    ? Math.min(dispatcherExpiry, nowMs + QUOTE_TTL_MS)
    : nowMs + QUOTE_TTL_MS;

  const quote: ConnectQuote = {
    quoteId: q.quoteId,
    dispatcherCostMinor: price.dispatcherCostMinor,
    marginBps: price.marginBps,
    marginMinor: price.marginMinor,
    partnerPriceMinor: price.partnerPriceMinor,
    distanceKm: q.distanceKm,
    etaToPickupMins: q.etaToPickupMins,
    etaToDropoffMins: q.etaToDropoffMins,
    expiresAtMs,
    quotedAtMs: nowMs,
  };

  const delivery: ConnectDelivery = {
    id,
    restaurantId: args.restaurantId,
    state: "quoted",
    pickup: ctx.pickup,
    dropoff: args.dropoff,
    packageDescription: args.packageDescription,
    readyAt: args.readyAt,
    quote,
    payer: null,
    payment: null,
    refund: null,
    delivery: null,
    // Minted at QUOTE, not at dispatch: the pay link has to exist before the
    // courier does, and it is the same token the customer later tracks with.
    trackingToken: randomBytes(16).toString("hex"),
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    createdByUid: args.createdByUid,
    correlationId,
  };

  const store = new ConnectStore(args.db);
  if (args.reuseDeliveryId) {
    // A refresh, not a new delivery: keep the token the pay link already uses.
    await store.update(id, { quote, state: "quoted" });
  } else {
    await store.create(delivery);
  }
  return { ok: true, delivery, quote };
}

/** Below this much remaining, re-quote rather than send somebody to a checkout that may die mid-payment. */
export const QUOTE_MIN_REMAINING_MS = 2 * 60 * 1000;

export type PayerChoice = "customer" | "restaurant";

/**
 * Choose who pays, refresh the price if the quote is going stale, and open a
 * Paystack checkout.
 *
 * ── Why the quote is refreshed BEFORE payment, never after ───────────────────
 * A quote that expires between the pay link and the payment leaves money taken
 * for a delivery that can no longer be priced — recoverable only by refunding
 * somebody who did nothing wrong. So a quote with little life left is replaced
 * here, and if the price moved the caller is told before anybody is charged.
 *
 * Once the intent exists the amount is frozen. A later re-quote cannot change
 * what a payer has already been shown.
 */
export async function preparePayment(args: {
  db: Firestore;
  restaurantId: string;
  deliveryId: string;
  payer: PayerChoice;
  payerEmail?: string;
  nowMs?: number;
}): Promise<
  | { ok: true; delivery: ConnectDelivery; amountMinor: number; priceChanged: boolean; authorizationUrl: string }
  | ConnectFailure
> {
  const nowMs = args.nowMs ?? Date.now();
  const store = new ConnectStore(args.db);
  const existing = await store.get(args.restaurantId, args.deliveryId);
  if (!existing) return { ok: false, reason: "not_found" };

  // Already paid, or already dispatched: never open a second checkout.
  if (existing.payment?.paidAtMs) return { ok: false, reason: "already_paid" };
  if (existing.delivery) return { ok: false, reason: "already_dispatched" };
  if (!existing.quote) return { ok: false, reason: "no_quote" };

  const ctx = await partnerContext(args.db, args.restaurantId);
  if (!ctx.ok) return { ok: false, reason: ctx.reason };

  let quote = existing.quote;
  let priceChanged = false;

  if (quote.expiresAtMs - nowMs < QUOTE_MIN_REMAINING_MS) {
    const fresh = await quoteConnectDelivery({
      db: args.db,
      restaurantId: args.restaurantId,
      createdByUid: existing.createdByUid,
      dropoff: existing.dropoff,
      packageDescription: existing.packageDescription,
      readyAt: existing.readyAt,
      nowMs,
      reuseDeliveryId: existing.id,
    });
    if (!fresh.ok) return fresh;
    priceChanged = fresh.quote.partnerPriceMinor !== quote.partnerPriceMinor;
    quote = fresh.quote;
  }

  const reference = `cnpay_${existing.id}_${randomBytes(4).toString("hex")}`;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const init = await initializeConnectPayment({
    reference,
    // Server-computed, from the frozen quote. No client supplies an amount.
    amountMinor: quote.partnerPriceMinor,
    email: args.payerEmail?.trim() || "delivery@restoflow.app",
    deliveryId: existing.id,
    callbackUrl: `${appUrl}/d/${existing.id}?t=${existing.trackingToken ?? ""}`,
  });
  if (!init.ok) return { ok: false, reason: "payment_init_failed", detail: init.reason };

  const payment = {
    reference: init.reference,
    payer: args.payer,
    amountMinor: quote.partnerPriceMinor,
    dispatcherCostMinor: quote.dispatcherCostMinor,
    marginMinor: quote.marginMinor,
    quoteId: quote.quoteId,
    createdAtMs: nowMs,
    authorizationUrl: init.authorizationUrl,
    paidAtMs: null,
  };

  await store.update(existing.id, { state: "awaiting_payment", payer: args.payer, quote, payment });
  await store.mapReference(init.reference, existing.id);

  const fresh2 = await store.get(args.restaurantId, existing.id);
  return {
    ok: true,
    delivery: fresh2 ?? existing,
    amountMinor: quote.partnerPriceMinor,
    priceChanged,
    authorizationUrl: init.authorizationUrl,
  };
}

/**
 * A confirmed Paystack charge for a Connect delivery.
 *
 * Idempotent on the payment reference. A webhook replay finds the delivery
 * already paid and returns without charging, dispatching or booking anything a
 * second time.
 */
export async function onConnectPaymentConfirmed(args: {
  db: Firestore;
  reference: string;
  amountMinor: number;
  nowMs?: number;
}): Promise<{ outcome: "dispatched" | "replayed" | "ignored" | "held"; deliveryId?: string; reason?: string }> {
  const nowMs = args.nowMs ?? Date.now();
  const store = new ConnectStore(args.db);

  const deliveryId = await store.deliveryIdForReference(args.reference);
  if (!deliveryId) return { outcome: "ignored", reason: "unknown_reference" };

  const d = await store.getInternal(deliveryId);
  if (!d || !d.payment) return { outcome: "ignored", reason: "no_intent" };

  if (d.payment.paidAtMs) return { outcome: "replayed", deliveryId };

  // Checked against the FROZEN snapshot, never recomputed. A re-quote between
  // checkout and callback must not silently change what was owed.
  if (args.amountMinor !== d.payment.amountMinor) {
    console.error(JSON.stringify({
      scope: "connect_payment", event: "amount_mismatch", deliveryId,
      expected: d.payment.amountMinor, actual: args.amountMinor,
    }));
    return { outcome: "ignored", reason: "amount_mismatch" };
  }

  const claimed = await store.markPaid(deliveryId, nowMs);
  if (!claimed) return { outcome: "replayed", deliveryId };

  // Books first: the money is real whether or not a courier can be found.
  const price = {
    dispatcherCostMinor: d.payment.dispatcherCostMinor,
    marginMinor: d.payment.marginMinor,
    partnerPriceMinor: d.payment.amountMinor,
    marginBps: d.quote?.marginBps ?? 0,
  };
  const entries = connectEntries({
    deliveryId, restaurantId: d.restaurantId, price, payer: d.payment.payer, nowMs,
  });
  if (connectBalance(entries) !== 0) {
    console.error(JSON.stringify({ scope: "connect_ledger", event: "unbalanced", deliveryId }));
  } else {
    await store.writeLedger(entries);
  }

  const dispatched = await dispatchPaidDelivery({ db: args.db, deliveryId, nowMs });
  return dispatched.ok
    ? { outcome: "dispatched", deliveryId }
    : { outcome: "held", deliveryId, reason: dispatched.reason };
}

/**
 * Hand a paid delivery to Dispatcher.
 *
 * ── Reconcile before retrying, always ────────────────────────────────────────
 * A create that times out is not a create that failed. Asking again could put a
 * second rider on the same job, so an ambiguous result is resolved by asking
 * Dispatcher what it holds for this externalOrderId — the same machinery the
 * marketplace sweeps use — before anything is retried or refunded.
 */
export async function dispatchPaidDelivery(args: {
  db: Firestore;
  deliveryId: string;
  nowMs?: number;
}): Promise<{ ok: true; replayed: boolean } | ConnectFailure> {
  const nowMs = args.nowMs ?? Date.now();
  const store = new ConnectStore(args.db);
  const d = await store.getInternal(args.deliveryId);
  if (!d) return { ok: false, reason: "not_found" };
  if (d.delivery?.deliveryJobId) return { ok: true, replayed: true };
  if (!d.payment?.paidAtMs) return { ok: false, reason: "not_paid" };
  if (!d.quote) return { ok: false, reason: "no_quote" };

  const c = client();
  if (!c) return { ok: false, reason: "delivery_integration_disabled" };

  const correlationId = d.correlationId ?? `cn-${randomUUID().slice(0, 13)}`;

  const req: CreateDeliveryRequest = {
    contractVersion: CONTRACT_VERSION,
    correlationId,
    externalOrderId: d.id,
    quoteId: d.payment.quoteId,
    serviceType: "FOOD_STANDARD",
    pickup: {
      name: d.pickup.name,
      address: d.pickup.address,
      location: d.pickup.location,
      contactPhone: d.pickup.contactPhone,
      ...(d.pickup.instructions ? { instructions: d.pickup.instructions } : {}),
    },
    dropoff: {
      name: d.dropoff.name.trim().split(/\s+/)[0] ?? "Customer",
      address: d.dropoff.address,
      location: d.dropoff.location,
      contactPhone: d.dropoff.contactPhone,
      ...(d.dropoff.instructions ? { instructions: d.dropoff.instructions } : {}),
    },
    readyAt: d.readyAt,
    // What Dispatcher charges US. The margin is not Dispatcher's business and
    // must never inflate what the rider's side sees.
    deliveryFeeMinor: d.payment.dispatcherCostMinor,
    // Prepaid: the customer already paid RestoFlow, so the rider collects nothing.
    paymentCollection: "NONE",
    packageDescription: d.packageDescription,
  };

  const res = await c.createDelivery(req);

  if (!res.ok) {
    // Ambiguous — a timeout or a transport failure. Ask what Dispatcher holds
    // before deciding anything.
    const existing = await c.getDelivery({ externalOrderId: d.id, correlationId });
    if (existing.ok && existing.value.deliveryJobId) {
      await attach(store, d, existing.value, nowMs);
      return { ok: true, replayed: true };
    }
    // Only now is it safe to call this a failure.
    await store.update(d.id, { state: "payment_held_unfulfilled" });
    return { ok: false, reason: "dispatch_failed", detail: res.failure.kind };
  }

  await attach(store, d, res.value, nowMs);
  return { ok: true, replayed: res.value.replayed };
}

async function attach(
  store: ConnectStore,
  d: ConnectDelivery,
  v: { deliveryJobId: string; state: import("@/lib/delivery/contract").DeliveryState; driver: import("@/lib/delivery/contract").DriverPublicProfile | null; etaToPickupMins: number | null; etaToDropoffMins: number | null; pickupCode: string | null; receivingCode: string | null },
  nowMs: number
): Promise<void> {
  const projection = initialProjection({
    correlationId: d.correlationId ?? "",
    quoteId: d.payment?.quoteId ?? null,
    nowMs,
  });
  projection.deliveryJobId = v.deliveryJobId;
  projection.state = v.state;
  projection.driver = v.driver;
  projection.etaToPickupMins = v.etaToPickupMins;
  projection.etaToDropoffMins = v.etaToDropoffMins;
  projection.pickupCode = v.pickupCode ?? null;

  const attached = await store.attachDelivery(d.id, { state: "requested", delivery: projection });
  if (!attached) return; // somebody else won; their job is the job

  await store.writeHandover(d.id, {
    pickupCode: v.pickupCode ?? null,
    receivingCode: v.receivingCode ?? null,
  });
}

/**
 * Refund a delivery that was paid for and can never be fulfilled.
 *
 * ── One refund, forever ──────────────────────────────────────────────────────
 * The obligation is keyed on the payment reference and claimed with a
 * compare-and-set, so a webhook replay, a retried worker and a manual
 * reconciliation all converge on the same single refund. Paystack refusing a
 * duplicate is treated as success for the same reason: it is the outcome we
 * wanted, and calling it an error would make a retrying worker loop forever.
 */
export async function refundConnectDelivery(args: {
  db: Firestore;
  deliveryId: string;
  reason: string;
  nowMs?: number;
}): Promise<{ ok: true; alreadyRefunded: boolean } | ConnectFailure> {
  const nowMs = args.nowMs ?? Date.now();
  const store = new ConnectStore(args.db);
  const d = await store.getInternal(args.deliveryId);
  if (!d) return { ok: false, reason: "not_found" };
  if (!d.payment?.paidAtMs) return { ok: false, reason: "not_paid" };
  if (d.delivery?.deliveryJobId) return { ok: false, reason: "already_dispatched" };
  if (d.refund?.status === "succeeded") return { ok: true, alreadyRefunded: true };

  // ── Prove it, do not assume it ──────────────────────────────────────────────
  // Our record saying there is no job is not evidence: the create may have
  // succeeded and the response lost. Refunding on that assumption pays the
  // customer back for a courier who is already on the way. So Dispatcher is
  // asked directly, and a job it holds cancels the refund and is adopted
  // instead.
  const rc = client();
  if (!rc) return { ok: false, reason: "delivery_integration_disabled" };
  const correlationId = d.correlationId ?? `cn-${randomUUID().slice(0, 13)}`;
  const probe = await rc.getDelivery({ externalOrderId: d.id, correlationId });
  if (probe.ok && probe.value.deliveryJobId) {
    await attach(store, d, probe.value, nowMs);
    return { ok: false, reason: "job_exists_after_all" };
  }
  if (!probe.ok && probe.failure.kind !== "server_rejected") {
    // A rejection means Dispatcher answered and holds nothing for this id —
    // that is the proof we need. Anything else (timeout, network, auth) means
    // we could not ask, and holding is safe where refunding blind is not.
    return { ok: false, reason: "reconciliation_unavailable", detail: probe.failure.kind };
  }

  const claimed = await store.claimRefund(d.id, {
    id: `${d.id}__refund`,
    reference: d.payment.reference,
    amountMinor: d.payment.amountMinor,
    reason: args.reason,
    status: "pending",
    providerReference: null,
    providerStatus: null,
    requestedAtMs: nowMs,
    settledAtMs: null,
    lastError: null,
  });
  if (!claimed) {
    const fresh = await store.getInternal(d.id);
    return { ok: true, alreadyRefunded: fresh?.refund?.status === "succeeded" };
  }

  const res = await refundConnectPayment({
    reference: d.payment.reference,
    amountMinor: d.payment.amountMinor,
    reason: args.reason,
  });

  if (!res.ok) {
    await store.update(d.id, {
      state: "refund_failed",
      refund: { ...d.refund!, ...(await store.getInternal(d.id))!.refund!, status: "failed", lastError: res.reason },
    });
    return { ok: false, reason: "refund_failed", detail: res.reason };
  }

  // Accepted is not settled. Paystack returns `pending` and settles later, so
  // our status follows the provider rather than declaring victory on a 200.
  const settled = res.providerStatus === "processed" || res.providerStatus === "success"
    || res.providerStatus === "already_refunded";
  const current = (await store.getInternal(d.id))!;
  await store.update(d.id, {
    state: settled ? "refunded" : "refund_pending",
    refund: {
      ...current.refund!,
      status: settled ? "succeeded" : "pending",
      providerReference: res.providerReference,
      providerStatus: res.providerStatus,
      settledAtMs: settled ? nowMs : null,
    },
  });

  const price = {
    dispatcherCostMinor: d.payment.dispatcherCostMinor,
    marginMinor: d.payment.marginMinor,
    partnerPriceMinor: d.payment.amountMinor,
    marginBps: d.quote?.marginBps ?? 0,
  };
  await store.writeLedger(
    connectRefundEntries({ deliveryId: d.id, restaurantId: d.restaurantId, price, payer: d.payment.payer, nowMs })
  );

  return { ok: true, alreadyRefunded: res.alreadyRefunded };
}
