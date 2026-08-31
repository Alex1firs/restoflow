/**
 * RestoFlow ⇄ Dispatcher cross-system contract, v1.
 *
 * ── What this file is ────────────────────────────────────────────────────────
 * The complete, versioned description of everything that crosses the boundary
 * between the two products. It is the ONLY shared vocabulary. Neither side may
 * reach past it into the other's internal model:
 *
 *   - RestoFlow never learns a Dispatcher `deliveryBoyId`, wallet, commission
 *     rate, RTDB path or internal status string.
 *   - Dispatcher never learns a food price, a marketplace markup, a restaurant
 *     payable, a platform margin, a customer account id or an item name.
 *
 * ── Why it is pure ───────────────────────────────────────────────────────────
 * No firebase, no next, no `server-only`, no React. It is imported by route
 * handlers, by tests, and (mirrored, see functions/integration/contract.js in
 * the Dispatcher repo) by the other product. A dependency here would make the
 * contract un-mirrorable.
 *
 * ── Versioning ───────────────────────────────────────────────────────────────
 * `CONTRACT_VERSION` is sent on every request and every event. A receiver that
 * does not recognise the MAJOR version refuses the message rather than guessing
 * — a silently-misparsed delivery event is worse than a rejected one, because
 * the first corrupts an order and the second pages somebody.
 */

/** Bumped MAJOR on any breaking change; both repos must agree byte-for-byte. */
export const CONTRACT_VERSION = "1.0.0" as const;
export const CONTRACT_MAJOR = 1 as const;

/** Header names used on every service-to-service call and every event. */
export const HEADERS = {
  apiKey: "x-rf-api-key",
  signature: "x-rf-signature",
  timestamp: "x-rf-timestamp",
  correlationId: "x-rf-correlation-id",
  idempotencyKey: "x-rf-idempotency-key",
  contractVersion: "x-rf-contract-version",
  eventId: "x-rf-event-id",
  attempt: "x-rf-attempt",
} as const;

// ── Canonical delivery state machine ────────────────────────────────────────
//
// This is the CONTRACT vocabulary, not either database's vocabulary. Dispatcher
// stores free-form status strings (`pending`, `accepted`, `in_progress`, …) and
// RestoFlow stores its own order lifecycle; both map into these names at the
// boundary and neither adopts the other's terms. Adding a state here is a MINOR
// version bump; removing or renaming one is MAJOR.

export const DELIVERY_STATES = [
  "REQUESTED",              // job reserved, riders cannot see it yet
  "SEARCHING_FOR_DRIVER",   // released to riders
  "DRIVER_ASSIGNED",        // a rider claimed it
  "DRIVER_TO_PICKUP",       // rider travelling to the restaurant
  "ARRIVED_AT_PICKUP",      // rider is at the restaurant
  "WAITING_FOR_ORDER",      // rider is there, food is not ready
  "PICKED_UP",              // rider has the food
  "EN_ROUTE_TO_CUSTOMER",
  "ARRIVING",               // close to the customer
  "DELIVERED",              // terminal, success
  "REASSIGNING",            // lost its rider, looking again
  "DRIVER_CANCELLED",       // rider withdrew (transitional → REASSIGNING)
  "CUSTOMER_UNREACHABLE",   // exception, not terminal on its own
  "RESTAURANT_DELAY",       // exception, not terminal on its own
  "DELIVERY_FAILED",        // terminal, failure
  "CANCELLED",              // terminal, cancelled by either side
] as const;

export type DeliveryState = (typeof DELIVERY_STATES)[number];

/** States after which nothing further can happen and tracking must stop. */
export const TERMINAL_STATES: readonly DeliveryState[] = [
  "DELIVERED",
  "DELIVERY_FAILED",
  "CANCELLED",
] as const;

export function isTerminal(state: DeliveryState): boolean {
  return TERMINAL_STATES.includes(state);
}

/**
 * Monotonic rank used to reject out-of-order events.
 *
 * Webhooks retry, and a retried DRIVER_ASSIGNED can land after PICKED_UP. Rank
 * is the second line of defence behind the per-delivery `sequence` number: even
 * a correctly-sequenced stream is checked against progress so a genuinely
 * backwards transition is visible rather than silently applied.
 *
 * Exception states share a rank with the phase they interrupt, because they do
 * not advance the delivery — they annotate it. `REASSIGNING` deliberately ranks
 * BELOW `DRIVER_ASSIGNED`: losing a rider really is a step backwards, and it is
 * the one backwards move the reducer must accept.
 */
const STATE_RANK: Record<DeliveryState, number> = {
  REQUESTED: 0,
  SEARCHING_FOR_DRIVER: 1,
  REASSIGNING: 1,
  DRIVER_CANCELLED: 1,
  DRIVER_ASSIGNED: 2,
  DRIVER_TO_PICKUP: 3,
  ARRIVED_AT_PICKUP: 4,
  WAITING_FOR_ORDER: 4,
  RESTAURANT_DELAY: 4,
  PICKED_UP: 5,
  EN_ROUTE_TO_CUSTOMER: 6,
  CUSTOMER_UNREACHABLE: 6,
  ARRIVING: 7,
  DELIVERED: 8,
  DELIVERY_FAILED: 8,
  CANCELLED: 8,
};

export function stateRank(state: DeliveryState): number {
  return STATE_RANK[state];
}

export function isDeliveryState(v: unknown): v is DeliveryState {
  return typeof v === "string" && (DELIVERY_STATES as readonly string[]).includes(v);
}

// ── Shared value objects ────────────────────────────────────────────────────

export type LatLng = { lat: number; lng: number };

/** Reason a quote came back unserviceable. Customer-facing copy lives in status.ts. */
export const UNSERVICEABLE_REASONS = [
  "OUT_OF_RANGE",
  "NO_COVERAGE",       // outside every service zone
  "NO_RIDERS",         // supply, not geography — retryable
  "OUTSIDE_HOURS",
  "INVALID_ADDRESS",
  "PROVIDER_ERROR",
] as const;
export type UnserviceableReason = (typeof UNSERVICEABLE_REASONS)[number];

export const FAILURE_REASONS = [
  "CUSTOMER_UNREACHABLE",
  "CUSTOMER_REFUSED",
  "ADDRESS_NOT_FOUND",
  "RESTAURANT_NOT_READY",
  "NO_DRIVER_FOUND",
  "DRIVER_ACCIDENT",
  "PACKAGE_DAMAGED",
  "OTHER",
] as const;
export type FailureReason = (typeof FAILURE_REASONS)[number];

export const CANCELLED_BY = ["CUSTOMER", "RESTAURANT", "PLATFORM", "DRIVER", "SYSTEM"] as const;
export type CancelledBy = (typeof CANCELLED_BY)[number];

/**
 * The ONLY rider information that crosses to RestoFlow.
 *
 * Deliberately excludes the rider's id, surname, phone, rating history and
 * every other delivery they are on. RestoFlow stores exactly this and nothing
 * more, so there is no path by which a customer-facing surface can leak a
 * worker's identity beyond what they need to recognise someone at their door.
 */
export type DriverPublicProfile = {
  firstName: string;
  photoUrl: string | null;
  vehicle: string | null;
  /** Opaque, per-delivery handle used to address messages and masked calls. */
  contactHandle: string | null;
};

// ── 1. Quote ────────────────────────────────────────────────────────────────

export type ServiceType = "FOOD_STANDARD";

export type DeliveryQuoteRequest = {
  contractVersion: string;
  correlationId: string;
  /** Marketplace order id when one exists; a cart id pre-order. Never a customer id. */
  externalRef: string;
  serviceType: ServiceType;
  pickup: LatLng;
  dropoff: LatLng;
  /** ISO-8601. When the food is expected ready, so the ETA can be honest. */
  readyAt?: string | null;
};

export type DeliveryQuoteResponse = {
  contractVersion: string;
  correlationId: string;
  serviceable: boolean;
  /** Present only when serviceable. Must be quoted back on create. */
  quoteId: string | null;
  /** Minor units (kobo). What Dispatcher charges for the job — NOT what the customer pays. */
  feeMinor: number | null;
  currency: "NGN";
  distanceKm: number | null;
  etaToPickupMins: number | null;
  etaToDropoffMins: number | null;
  /** ISO-8601. After this the quote must be re-requested, never assumed. */
  expiresAt: string | null;
  reason: UnserviceableReason | null;
};

// ── 2. Create delivery ──────────────────────────────────────────────────────

export type PickupSpec = {
  /** Restaurant display name — Dispatcher shows it to the rider. */
  name: string;
  address: string;
  location: LatLng;
  contactPhone: string;
  instructions?: string;
};

export type DropoffSpec = {
  /** Customer FIRST NAME only. Never the full name. */
  name: string;
  address: string;
  location: LatLng;
  /** Masked or real per deployment config — see DELIVERY_INTEGRATION.md. */
  contactPhone: string;
  instructions?: string;
};

export type CreateDeliveryRequest = {
  contractVersion: string;
  correlationId: string;
  /** RestoFlow marketplaceOrderId. THE idempotency anchor. */
  externalOrderId: string;
  quoteId: string | null;
  serviceType: ServiceType;
  pickup: PickupSpec;
  dropoff: DropoffSpec;
  /** ISO-8601 estimate of when the food will be ready. Drives dispatch timing. */
  readyAt: string;
  /** Minor units. The DELIVERY charge only — never the food subtotal. */
  deliveryFeeMinor: number;
  /** Prepaid: the rider collects nothing from the customer. */
  paymentCollection: "NONE";
  /** Free text shown to the rider. Never item names. */
  packageDescription: string;
};

export type CreateDeliveryResponse = {
  contractVersion: string;
  correlationId: string;
  deliveryJobId: string;
  externalOrderId: string;
  state: DeliveryState;
  /** True when this request replayed an existing job rather than creating one. */
  replayed: boolean;
  driver: DriverPublicProfile | null;
  etaToPickupMins: number | null;
  etaToDropoffMins: number | null;
  createdAt: string;
  /** Shown to restaurant staff; the rider must quote it to collect the food. */
  pickupCode: string | null;
  /** Shown to the customer; the rider must collect it to complete. */
  receivingCode: string | null;
};

// ── 3. Cancellation ─────────────────────────────────────────────────────────

export type DeliveryCancellationRequest = {
  contractVersion: string;
  correlationId: string;
  externalOrderId: string;
  cancelledBy: CancelledBy;
  reason: string;
};

export type DeliveryCancellationResponse = {
  contractVersion: string;
  correlationId: string;
  deliveryJobId: string;
  state: DeliveryState;
  /** True when the job was already cancelled — a replay, not a failure. */
  alreadyCancelled: boolean;
};

// ── 4. Events (Dispatcher → RestoFlow) ──────────────────────────────────────

export const EVENT_TYPES = [
  "delivery.state_changed",
  "delivery.driver_assigned",
  "delivery.failed",
  "delivery.cancelled",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

type EventBase = {
  contractVersion: string;
  /** Unique per event. The receiver's deduplication key. */
  eventId: string;
  type: EventType;
  /** ISO-8601 — when it HAPPENED, not when it was sent. Retries reuse it. */
  occurredAt: string;
  /** Monotonic per delivery, starting at 1. Gaps are tolerated; regressions are not. */
  sequence: number;
  deliveryJobId: string;
  externalOrderId: string;
  correlationId: string;
  state: DeliveryState;
};

export type DeliveryStatusEvent = EventBase & {
  type: "delivery.state_changed";
  etaToPickupMins?: number | null;
  etaToDropoffMins?: number | null;
};

export type DriverAssignmentEvent = EventBase & {
  type: "delivery.driver_assigned";
  state: "DRIVER_ASSIGNED";
  driver: DriverPublicProfile;
  etaToPickupMins: number | null;
};

export type DeliveryFailureEvent = EventBase & {
  type: "delivery.failed";
  state: "DELIVERY_FAILED";
  failureReason: FailureReason;
  /** Operator-facing detail. NEVER shown to a customer verbatim. */
  detail?: string | null;
};

export type DeliveryCancellationEvent = EventBase & {
  type: "delivery.cancelled";
  state: "CANCELLED";
  cancelledBy: CancelledBy;
  detail?: string | null;
};

export type DeliveryEvent =
  | DeliveryStatusEvent
  | DriverAssignmentEvent
  | DeliveryFailureEvent
  | DeliveryCancellationEvent;

// ── 5. Tracking (RestoFlow pulls; never pushed) ─────────────────────────────

export type DeliveryTrackingResponse = {
  contractVersion: string;
  correlationId: string;
  deliveryJobId: string;
  state: DeliveryState;
  /**
   * Null whenever tracking is not permitted: before a rider is assigned, after
   * a terminal state, or when the last fix is too old to be honest.
   */
  location: (LatLng & { recordedAt: string; stale: boolean }) | null;
  driver: DriverPublicProfile | null;
  etaToDropoffMins: number | null;
};

// ── Validation ──────────────────────────────────────────────────────────────
//
// Deliberately hand-written rather than schema-library-driven: the contract is
// mirrored into a JavaScript codebase with a different dependency set, and two
// hand-written validators that agree are easier to keep in step than two
// different schema libraries that nearly agree.

export type ValidationResult = { ok: true } | { ok: false; error: string };

const ok: ValidationResult = { ok: true };
const bad = (error: string): ValidationResult => ({ ok: false, error });

/** Accepts a same-MAJOR version. A different major is refused, never coerced. */
export function checkContractVersion(v: unknown): ValidationResult {
  if (typeof v !== "string" || !/^\d+\.\d+\.\d+$/.test(v)) return bad("contractVersion malformed");
  const major = Number(v.split(".")[0]);
  if (major !== CONTRACT_MAJOR) return bad(`contractVersion major ${major} unsupported (expected ${CONTRACT_MAJOR})`);
  return ok;
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function isValidLatLng(v: unknown): v is LatLng {
  if (!v || typeof v !== "object") return false;
  const p = v as LatLng;
  if (!isFiniteNum(p.lat) || !isFiniteNum(p.lng)) return false;
  if (Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180) return false;
  // Null island is an unset default far more often than a real position.
  return !(p.lat === 0 && p.lng === 0);
}

function nonEmpty(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * External ids travel in URLs, log lines and document keys on both sides, so
 * the safe set is deliberately narrow. `__` is not special here, but keeping the
 * set tight means a composite key built from these can never be ambiguous.
 */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export function isValidExternalId(v: unknown): v is string {
  return typeof v === "string" && SAFE_ID.test(v);
}

export function validateQuoteRequest(body: unknown): ValidationResult {
  if (!body || typeof body !== "object") return bad("body must be an object");
  const b = body as DeliveryQuoteRequest;
  const ver = checkContractVersion(b.contractVersion);
  if (!ver.ok) return ver;
  if (!isValidExternalId(b.correlationId)) return bad("correlationId invalid");
  if (!isValidExternalId(b.externalRef)) return bad("externalRef invalid");
  if (b.serviceType !== "FOOD_STANDARD") return bad("serviceType unsupported");
  if (!isValidLatLng(b.pickup)) return bad("pickup coordinates invalid");
  if (!isValidLatLng(b.dropoff)) return bad("dropoff coordinates invalid");
  if (b.readyAt != null && !nonEmpty(b.readyAt)) return bad("readyAt malformed");
  return ok;
}

export function validateCreateRequest(body: unknown): ValidationResult {
  if (!body || typeof body !== "object") return bad("body must be an object");
  const b = body as CreateDeliveryRequest;
  const ver = checkContractVersion(b.contractVersion);
  if (!ver.ok) return ver;
  if (!isValidExternalId(b.correlationId)) return bad("correlationId invalid");
  if (!isValidExternalId(b.externalOrderId)) return bad("externalOrderId invalid");
  if (b.serviceType !== "FOOD_STANDARD") return bad("serviceType unsupported");
  if (!b.pickup || !nonEmpty(b.pickup.name) || !nonEmpty(b.pickup.address)) return bad("pickup incomplete");
  if (!isValidLatLng(b.pickup.location)) return bad("pickup coordinates invalid");
  if (!nonEmpty(b.pickup.contactPhone)) return bad("pickup contactPhone required");
  if (!b.dropoff || !nonEmpty(b.dropoff.name) || !nonEmpty(b.dropoff.address)) return bad("dropoff incomplete");
  if (!isValidLatLng(b.dropoff.location)) return bad("dropoff coordinates invalid");
  if (!nonEmpty(b.dropoff.contactPhone)) return bad("dropoff contactPhone required");
  if (!nonEmpty(b.readyAt)) return bad("readyAt required");
  if (!isFiniteNum(b.deliveryFeeMinor) || b.deliveryFeeMinor < 0) return bad("deliveryFeeMinor invalid");
  if (!Number.isInteger(b.deliveryFeeMinor)) return bad("deliveryFeeMinor must be an integer (minor units)");
  if (b.paymentCollection !== "NONE") return bad("paymentCollection must be NONE for marketplace orders");
  return ok;
}

export function validateEvent(body: unknown): ValidationResult {
  if (!body || typeof body !== "object") return bad("body must be an object");
  const b = body as DeliveryEvent;
  const ver = checkContractVersion(b.contractVersion);
  if (!ver.ok) return ver;
  if (!isValidExternalId(b.eventId)) return bad("eventId invalid");
  if (!(EVENT_TYPES as readonly string[]).includes(b.type)) return bad("type unknown");
  if (!nonEmpty(b.occurredAt)) return bad("occurredAt required");
  if (!Number.isInteger(b.sequence) || b.sequence < 1) return bad("sequence must be a positive integer");
  if (!isValidExternalId(b.deliveryJobId)) return bad("deliveryJobId invalid");
  if (!isValidExternalId(b.externalOrderId)) return bad("externalOrderId invalid");
  if (!isValidExternalId(b.correlationId)) return bad("correlationId invalid");
  if (!isDeliveryState(b.state)) return bad("state unknown");
  if (b.type === "delivery.driver_assigned") {
    const d = (b as DriverAssignmentEvent).driver;
    if (!d || !nonEmpty(d.firstName)) return bad("driver.firstName required");
  }
  if (b.type === "delivery.failed") {
    const r = (b as DeliveryFailureEvent).failureReason;
    if (!(FAILURE_REASONS as readonly string[]).includes(r)) return bad("failureReason unknown");
  }
  if (b.type === "delivery.cancelled") {
    const c = (b as DeliveryCancellationEvent).cancelledBy;
    if (!(CANCELLED_BY as readonly string[]).includes(c)) return bad("cancelledBy unknown");
  }
  return ok;
}

/**
 * Fields that must NEVER appear in anything sent to Dispatcher.
 *
 * Asserted in tests against the serialised request body rather than trusted to
 * review. Dispatcher computes its rider commission from the fee we send it, so
 * a food subtotal leaking into a money field would silently pay commission on
 * the food — invisible until a restaurant queried its payout.
 */
export const FORBIDDEN_OUTBOUND_KEYS: readonly string[] = [
  "foodSubtotal", "itemsTotal", "customerSubtotal", "restaurantSubtotal",
  "markup", "markupTotal", "marketplaceMarkup", "platformGross", "platformMargin",
  "restaurantPayable", "settlement", "settlementId", "processorFee",
  "customerId", "customerEmail", "customerUid", "paymentReference", "items",
  "orderCost", "total",
] as const;

/** Deep scan. Returns the offending key paths, empty when clean. */
export function findForbiddenKeys(payload: unknown, path = "$"): string[] {
  if (payload === null || typeof payload !== "object") return [];
  if (Array.isArray(payload)) {
    return payload.flatMap((v, i) => findForbiddenKeys(v, `${path}[${i}]`));
  }
  const out: string[] = [];
  for (const [k, v] of Object.entries(payload)) {
    if (FORBIDDEN_OUTBOUND_KEYS.includes(k)) out.push(`${path}.${k}`);
    out.push(...findForbiddenKeys(v, `${path}.${k}`));
  }
  return out;
}
