import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { CONTRACT_VERSION, type CreateDeliveryRequest } from "@/lib/delivery/contract";
import { readDeliveryConfig } from "@/lib/delivery/config";
import { DispatcherClient } from "@/lib/delivery/dispatcher-client";
import { initialProjection } from "@/lib/delivery/projection";
import { readConnectSettings, connectReadiness } from "./config";
import { priceConnectDelivery } from "./pricing";
import { connectEntries, connectBalance } from "./ledger";
import { ConnectStore } from "./store";
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
}): Promise<QuoteOk | ConnectFailure> {
  const nowMs = args.nowMs ?? Date.now();
  const ctx = await partnerContext(args.db, args.restaurantId);
  if (!ctx.ok) return { ok: false, reason: ctx.reason };

  const c = client();
  if (!c) return { ok: false, reason: "delivery_integration_disabled" };

  const id = `cn_${randomBytes(9).toString("hex")}`;
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
    delivery: null,
    trackingToken: null,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    createdByUid: args.createdByUid,
    correlationId,
  };

  await new ConnectStore(args.db).create(delivery);
  return { ok: true, delivery, quote };
}

/**
 * Turn an accepted quote into a real Dispatcher job.
 *
 * Idempotent on the Connect delivery id, which is also the `externalOrderId`
 * Dispatcher dedupes on — so a double-tap, a retried request or a replayed
 * call all converge on one job rather than two couriers.
 */
export async function requestConnectDelivery(args: {
  db: Firestore;
  restaurantId: string;
  deliveryId: string;
  nowMs?: number;
}): Promise<RequestOk | ConnectFailure> {
  const nowMs = args.nowMs ?? Date.now();
  const store = new ConnectStore(args.db);

  const existing = await store.get(args.restaurantId, args.deliveryId);
  if (!existing) return { ok: false, reason: "not_found" };

  if (existing.delivery?.deliveryJobId) {
    return { ok: true, delivery: existing, replayed: true };
  }
  if (existing.state !== "quoted") return { ok: false, reason: "not_quoted" };
  if (!existing.quote) return { ok: false, reason: "no_quote" };

  // An expired quote is refused outright. Requesting on a stale price means
  // either the partner or RestoFlow eats a difference nobody agreed to.
  if (existing.quote.expiresAtMs <= nowMs) return { ok: false, reason: "quote_expired" };

  const ctx = await partnerContext(args.db, args.restaurantId);
  if (!ctx.ok) return { ok: false, reason: ctx.reason };

  const c = client();
  if (!c) return { ok: false, reason: "delivery_integration_disabled" };

  const req: CreateDeliveryRequest = {
    contractVersion: CONTRACT_VERSION,
    correlationId: existing.correlationId ?? `cn-${randomUUID().slice(0, 13)}`,
    externalOrderId: existing.id,
    quoteId: existing.quote.quoteId,
    serviceType: "FOOD_STANDARD",
    pickup: {
      name: existing.pickup.name,
      address: existing.pickup.address,
      location: existing.pickup.location,
      contactPhone: existing.pickup.contactPhone,
      ...(existing.pickup.instructions ? { instructions: existing.pickup.instructions } : {}),
    },
    dropoff: {
      // First name only. The contract says so and the rider needs no more.
      name: existing.dropoff.name.trim().split(/\s+/)[0] ?? "Customer",
      address: existing.dropoff.address,
      location: existing.dropoff.location,
      contactPhone: existing.dropoff.contactPhone,
      ...(existing.dropoff.instructions ? { instructions: existing.dropoff.instructions } : {}),
    },
    readyAt: existing.readyAt,
    // What Dispatcher charges US. RestoFlow's margin is not Dispatcher's
    // business and must never inflate what the rider's side sees.
    deliveryFeeMinor: existing.quote.dispatcherCostMinor,
    // Prepaid: the partner owes RestoFlow, and the rider collects nothing.
    paymentCollection: "NONE",
    packageDescription: existing.packageDescription,
  };

  const res = await c.createDelivery(req);
  if (!res.ok) return { ok: false, reason: "create_failed", detail: res.failure.kind };

  const v = res.value;
  const projection = initialProjection({
    correlationId: req.correlationId,
    quoteId: existing.quote.quoteId,
    nowMs,
  });
  projection.deliveryJobId = v.deliveryJobId;
  projection.state = v.state;
  projection.driver = v.driver;
  projection.etaToPickupMins = v.etaToPickupMins;
  projection.etaToDropoffMins = v.etaToDropoffMins;
  projection.pickupCode = v.pickupCode ?? null;

  const attached = await store.attachDelivery(existing.id, {
    state: "requested",
    delivery: projection,
    trackingToken: randomBytes(16).toString("hex"),
  });

  if (!attached) {
    // Somebody else won the race. Their job is the job.
    const fresh = await store.get(args.restaurantId, existing.id);
    return fresh
      ? { ok: true, delivery: fresh, replayed: true }
      : { ok: false, reason: "attach_failed" };
  }

  // The receiving code is the customer's proof and is never stored on a record
  // the partner can read.
  await store.writeHandover(existing.id, {
    pickupCode: v.pickupCode ?? null,
    receivingCode: v.receivingCode ?? null,
  });

  const entries = connectEntries({
    deliveryId: existing.id,
    restaurantId: existing.restaurantId,
    price: {
      dispatcherCostMinor: existing.quote.dispatcherCostMinor,
      marginMinor: existing.quote.marginMinor,
      partnerPriceMinor: existing.quote.partnerPriceMinor,
      marginBps: existing.quote.marginBps,
    },
    nowMs,
  });
  if (connectBalance(entries) !== 0) {
    // Refuse to write books that do not balance. Loudly, because a silent
    // imbalance is discovered months later by somebody reconciling by hand.
    console.error(JSON.stringify({
      scope: "connect_ledger", event: "unbalanced", deliveryId: existing.id,
      balance: connectBalance(entries),
    }));
  } else {
    await store.writeLedger(entries);
  }

  const fresh = await store.get(args.restaurantId, existing.id);
  return { ok: true, delivery: fresh ?? existing, replayed: v.replayed };
}
