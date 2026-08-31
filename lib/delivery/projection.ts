/**
 * The RestoFlow-side delivery projection, and the pure rules that maintain it.
 *
 * ── Not a source of truth ────────────────────────────────────────────────────
 * Dispatcher owns the delivery. This is a read-model: enough to render a
 * customer's tracking screen, a restaurant's order card and an operations row
 * WITHOUT calling Dispatcher on every page load, and nothing more. When the two
 * disagree, Dispatcher wins and the reconciler repairs this.
 *
 * Deliberately absent: rider id, rider phone, rider wallet, Dispatcher's own
 * status strings, its internal ids, its pricing internals, its other jobs.
 *
 * ── Why the apply rules are pure ─────────────────────────────────────────────
 * Webhooks arrive duplicated, out of order, and occasionally after the delivery
 * has finished. All three are normal. Making the decision "does this event
 * change anything?" a pure function of (projection, event) means it can be
 * exhaustively tested without Firestore, and means the transaction that writes
 * it has nothing to decide.
 */

import {
  type DeliveryEvent,
  type DeliveryState,
  type DriverPublicProfile,
  type FailureReason,
  type CancelledBy,
  isTerminal,
  stateRank,
} from "./contract";

/** Stored at `orders/{orderId}.delivery`. Every field optional on read: an order
 *  created before this feature — or one that never needed delivery — has none. */
export type DeliveryProjection = {
  provider: "dispatcher";
  /** Null between "we decided to deliver" and "Dispatcher confirmed the job". */
  deliveryJobId: string | null;
  quoteId: string | null;
  state: DeliveryState;
  /** Highest event sequence applied. Guards against out-of-order replay. */
  sequence: number;
  /** Display projection only — never the rider's identity. */
  driver: DriverPublicProfile | null;
  etaToPickupMins: number | null;
  etaToDropoffMins: number | null;
  requestedAt: number | null;
  assignedAt: number | null;
  pickedUpAt: number | null;
  deliveredAt: number | null;
  /** Epoch ms of the last event we accepted. Drives the reconciler's staleness. */
  lastEventAt: number;
  /** Operator-facing. Never rendered to a customer verbatim. */
  issue: { kind: "failed" | "cancelled" | "unreachable" | "delay"; reason: string; detail: string | null } | null;
  /** Correlation for support. One per order, stable across every call. */
  correlationId: string;
  reconcileState: "ok" | "stale" | "attention";
};

export function initialProjection(args: {
  correlationId: string;
  quoteId: string | null;
  nowMs: number;
}): DeliveryProjection {
  return {
    provider: "dispatcher",
    deliveryJobId: null,
    quoteId: args.quoteId,
    state: "REQUESTED",
    sequence: 0,
    driver: null,
    etaToPickupMins: null,
    etaToDropoffMins: null,
    requestedAt: args.nowMs,
    assignedAt: null,
    pickedUpAt: null,
    deliveredAt: null,
    lastEventAt: args.nowMs,
    issue: null,
    correlationId: args.correlationId,
    reconcileState: "ok",
  };
}

// ── Applying an event ───────────────────────────────────────────────────────

export type ApplyOutcome =
  | { kind: "applied"; next: DeliveryProjection }
  /** Already seen, or superseded. Not an error — the correct response is 200. */
  | { kind: "ignored"; reason: IgnoreReason }
  /** Structurally wrong for THIS projection. The caller must log loudly. */
  | { kind: "rejected"; reason: string };

export type IgnoreReason =
  | "duplicate_sequence"
  | "stale_sequence"
  | "already_terminal"
  | "no_state_progress";

/**
 * Decide what an incoming event does to a projection.
 *
 * Four independent guards, in order of cheapness:
 *
 *   1. Job identity — an event for a different job on this order is a routing
 *      bug, never something to apply.
 *   2. Sequence — Dispatcher numbers events per delivery. Lower or equal means
 *      we have already moved past it.
 *   3. Terminality — once DELIVERED / FAILED / CANCELLED, nothing reopens the
 *      delivery. A late in-flight event after completion is common under retry
 *      and must not resurrect a finished order.
 *   4. Progress — a correctly-sequenced event that moves backwards is accepted
 *      ONLY for REASSIGNING, which is a genuine backwards move. Anything else
 *      going backwards is a Dispatcher bug we refuse to mirror.
 */
export function applyEvent(
  current: DeliveryProjection,
  event: DeliveryEvent,
  nowMs: number
): ApplyOutcome {
  if (current.deliveryJobId && current.deliveryJobId !== event.deliveryJobId) {
    return { kind: "rejected", reason: `event for job ${event.deliveryJobId} on order holding ${current.deliveryJobId}` };
  }

  if (event.sequence === current.sequence) return { kind: "ignored", reason: "duplicate_sequence" };
  if (event.sequence < current.sequence) return { kind: "ignored", reason: "stale_sequence" };

  if (isTerminal(current.state)) return { kind: "ignored", reason: "already_terminal" };

  const movingBackwards = stateRank(event.state) < stateRank(current.state);
  const legitimateBackwards = event.state === "REASSIGNING" || event.state === "DRIVER_CANCELLED";
  if (movingBackwards && !legitimateBackwards) {
    return { kind: "ignored", reason: "no_state_progress" };
  }

  const next: DeliveryProjection = {
    ...current,
    deliveryJobId: event.deliveryJobId,
    state: event.state,
    sequence: event.sequence,
    lastEventAt: nowMs,
    reconcileState: "ok",
  };

  switch (event.type) {
    case "delivery.driver_assigned":
      next.driver = event.driver;
      next.assignedAt = next.assignedAt ?? nowMs;
      next.etaToPickupMins = event.etaToPickupMins;
      // A newly assigned rider clears a previous rider's abandonment.
      next.issue = null;
      break;

    case "delivery.state_changed":
      if (event.etaToPickupMins !== undefined) next.etaToPickupMins = event.etaToPickupMins ?? null;
      if (event.etaToDropoffMins !== undefined) next.etaToDropoffMins = event.etaToDropoffMins ?? null;
      if (event.state === "PICKED_UP") next.pickedUpAt = next.pickedUpAt ?? nowMs;
      if (event.state === "DELIVERED") next.deliveredAt = nowMs;
      if (event.state === "CUSTOMER_UNREACHABLE") {
        next.issue = { kind: "unreachable", reason: "CUSTOMER_UNREACHABLE", detail: null };
      }
      if (event.state === "RESTAURANT_DELAY") {
        next.issue = { kind: "delay", reason: "RESTAURANT_DELAY", detail: null };
      }
      if (event.state === "REASSIGNING" || event.state === "DRIVER_CANCELLED") {
        // The rider is gone: their details must stop being shown immediately,
        // or the customer keeps seeing a courier who is no longer coming.
        next.driver = null;
        next.assignedAt = null;
        next.etaToPickupMins = null;
      }
      break;

    case "delivery.failed":
      next.issue = { kind: "failed", reason: event.failureReason, detail: event.detail ?? null };
      next.reconcileState = "attention";
      break;

    case "delivery.cancelled":
      next.issue = { kind: "cancelled", reason: event.cancelledBy, detail: event.detail ?? null };
      break;
  }

  return { kind: "applied", next };
}

// ── Reconciliation ──────────────────────────────────────────────────────────

/** How long a live delivery may go without an event before we go and look. */
export const STALE_AFTER_MS = 6 * 60_000;
/** How long before an unrepaired projection becomes a human's problem. */
export const ATTENTION_AFTER_MS = 20 * 60_000;

export type ReconcileVerdict = "ok" | "stale" | "attention";

/**
 * Whether a projection has gone quiet.
 *
 * Terminal deliveries are never stale — they are finished, and continuing to
 * poll them would be both wasteful and a privacy problem, since it would keep
 * pulling a rider's position after the job ended.
 */
export function reconcileVerdict(p: DeliveryProjection, nowMs: number): ReconcileVerdict {
  if (isTerminal(p.state)) return "ok";
  const quietFor = nowMs - p.lastEventAt;
  if (quietFor >= ATTENTION_AFTER_MS) return "attention";
  if (quietFor >= STALE_AFTER_MS) return "stale";
  return "ok";
}

/**
 * Repair from an authoritative read of Dispatcher.
 *
 * Used by the reconciler after a missed webhook. It bypasses the sequence guard
 * on purpose — a polled read IS the current truth, and the whole reason we are
 * polling is that the sequence stream has a hole in it. It still refuses to
 * reopen a terminal delivery, because a stale poll racing a final webhook must
 * not undo completion.
 */
export function reconcileFrom(
  current: DeliveryProjection,
  authoritative: { deliveryJobId: string; state: DeliveryState; driver: DriverPublicProfile | null; etaToDropoffMins: number | null },
  nowMs: number
): ApplyOutcome {
  if (isTerminal(current.state)) return { kind: "ignored", reason: "already_terminal" };

  if (current.state === authoritative.state && current.deliveryJobId === authoritative.deliveryJobId) {
    // Nothing changed, but we DID hear from Dispatcher — so the projection is
    // no longer stale even though its state did not move. Without this, a
    // legitimately slow delivery would escalate to `attention` forever.
    return {
      kind: "applied",
      next: { ...current, lastEventAt: nowMs, reconcileState: "ok" },
    };
  }

  return {
    kind: "applied",
    next: {
      ...current,
      deliveryJobId: authoritative.deliveryJobId,
      state: authoritative.state,
      driver: authoritative.driver,
      etaToDropoffMins: authoritative.etaToDropoffMins,
      assignedAt: authoritative.driver ? (current.assignedAt ?? nowMs) : null,
      pickedUpAt: stateRank(authoritative.state) >= stateRank("PICKED_UP") ? (current.pickedUpAt ?? nowMs) : current.pickedUpAt,
      deliveredAt: authoritative.state === "DELIVERED" ? nowMs : current.deliveredAt,
      lastEventAt: nowMs,
      reconcileState: "ok",
    },
  };
}

// ── Dispatch timing ─────────────────────────────────────────────────────────

/** Measured, and deliberately pessimistic to start. Tune from real data. */
export const DEFAULT_SEARCH_BUFFER_MINS = 4;
/** Bias early: a rider waiting two minutes beats food going cold. */
export const DISPATCH_SAFETY_MINS = 2;

/**
 * When to release the job to riders.
 *
 * The whole point of the draft/confirm split: a job created at payment sits
 * invisible, and we choose the moment riders start being offered it. Too early
 * and a rider stands in a kitchen for twenty minutes; too late and hot food
 * waits on a pass.
 *
 * Never returns a time in the past — a short prep, or an order accepted late,
 * means "confirm now" rather than "confirm at a moment that has gone".
 */
export function computeConfirmAt(args: {
  acceptedAtMs: number;
  prepMins: number;
  etaToPickupMins: number | null;
  nowMs: number;
  searchBufferMins?: number;
}): number {
  const searchBuffer = args.searchBufferMins ?? DEFAULT_SEARCH_BUFFER_MINS;
  const travel = args.etaToPickupMins ?? DEFAULT_SEARCH_BUFFER_MINS;
  const readyAtMs = args.acceptedAtMs + args.prepMins * 60_000;
  const leadMs = (searchBuffer + travel + DISPATCH_SAFETY_MINS) * 60_000;
  return Math.max(readyAtMs - leadMs, args.nowMs);
}
