/**
 * Webhook ingestion: everything that must be true before a Dispatcher event is
 * allowed to change a marketplace order.
 *
 * Pure over the DeliveryStore port, so every ordering, duplication and race
 * case below is exercised in unit tests with an in-memory fake rather than
 * inferred from a staging run.
 *
 * ── Four independent defences ────────────────────────────────────────────────
 *   1. Signature + timestamp   (route layer, before this runs)
 *   2. eventId claim           — the same event delivered twice does nothing
 *   3. sequence + state rank   — an out-of-order event cannot rewind an order
 *   4. compare-and-set write   — two concurrent events cannot interleave badly
 *
 * They overlap on purpose. Any one of them failing open still leaves three.
 */

import type { DeliveryEvent } from "./contract";
import { applyEvent, type DeliveryProjection } from "./projection";
import type { DeliveryStore } from "./store";

export type IngestResult =
  | { outcome: "applied"; orderId: string; state: string; sequence: number }
  | { outcome: "duplicate"; orderId: string | null; reason: string }
  | { outcome: "ignored"; orderId: string; reason: string }
  | { outcome: "unknown_order"; externalOrderId: string }
  | { outcome: "rejected"; orderId: string | null; reason: string };

export type IngestDeps = {
  store: DeliveryStore;
  nowMs: number;
  log?: (event: string, fields: Record<string, unknown>) => void;
  /** Fired only on a genuine, applied state change. Never on a replay. */
  onStateChange?: (args: { orderId: string; projection: DeliveryProjection; event: DeliveryEvent }) => Promise<void>;
};

/** Optimistic-concurrency retries. A third collision on one order is pathological. */
const MAX_CAS_ATTEMPTS = 3;

export async function ingestEvent(event: DeliveryEvent, deps: IngestDeps): Promise<IngestResult> {
  const { store, nowMs } = deps;
  const log = deps.log ?? (() => {});

  const order = await store.getOrder(event.externalOrderId);
  if (!order) {
    // Not an error we can fix by retrying, and not something to 500 over: an
    // event for an order we do not have is either a misrouted webhook or a
    // staging/production credential crossover. Log loudly, accept, move on.
    log("dispatcher_event_unknown_order", { externalOrderId: event.externalOrderId, eventId: event.eventId, correlationId: event.correlationId });
    return { outcome: "unknown_order", externalOrderId: event.externalOrderId };
  }

  if (!order.delivery) {
    return { outcome: "rejected", orderId: order.orderId, reason: "order has no delivery projection" };
  }

  // Claim BEFORE applying. A duplicate that arrives while the first copy is
  // still in flight loses the claim and stops here, so the expensive path runs
  // exactly once even under concurrent delivery.
  const claimed = await store.claimEvent(event.eventId, {
    orderId: order.orderId,
    deliveryJobId: event.deliveryJobId,
    sequence: event.sequence,
    nowMs,
  });
  if (!claimed) {
    log("dispatcher_event_duplicate", { eventId: event.eventId, orderId: order.orderId });
    return { outcome: "duplicate", orderId: order.orderId, reason: "eventId already processed" };
  }

  for (let attempt = 1; attempt <= MAX_CAS_ATTEMPTS; attempt++) {
    // Re-read on every attempt: on a retry the projection has moved, so the
    // decision must be made against what is actually stored now.
    const fresh = attempt === 1 ? order : await store.getOrder(order.orderId);
    if (!fresh?.delivery) {
      return { outcome: "rejected", orderId: order.orderId, reason: "delivery projection vanished mid-write" };
    }

    const decision = applyEvent(fresh.delivery, event, nowMs);

    if (decision.kind === "ignored") {
      log("dispatcher_event_ignored", { eventId: event.eventId, orderId: order.orderId, reason: decision.reason, incoming: event.state, held: fresh.delivery.state });
      await store.appendTimeline(order.orderId, {
        at: nowMs, source: "dispatcher", event: `${event.type}:ignored`,
        state: event.state, correlationId: event.correlationId, detail: decision.reason,
      });
      return { outcome: "ignored", orderId: order.orderId, reason: decision.reason };
    }

    if (decision.kind === "rejected") {
      log("dispatcher_event_rejected", { eventId: event.eventId, orderId: order.orderId, reason: decision.reason });
      await store.appendTimeline(order.orderId, {
        at: nowMs, source: "dispatcher", event: `${event.type}:rejected`,
        state: event.state, correlationId: event.correlationId, detail: decision.reason,
      });
      return { outcome: "rejected", orderId: order.orderId, reason: decision.reason };
    }

    const written = await store.writeProjection(order.orderId, fresh.delivery.sequence, decision.next);
    if (!written) continue; // somebody else moved it; re-read and re-decide

    await store.appendTimeline(order.orderId, {
      at: nowMs, source: "dispatcher", event: event.type,
      state: event.state, correlationId: event.correlationId, detail: null,
    });

    if (deps.onStateChange) {
      // Notifications must never be able to fail an ingest: the state IS
      // changed and returning non-2xx here would make Dispatcher redeliver an
      // event we already applied.
      await deps.onStateChange({ orderId: order.orderId, projection: decision.next, event }).catch((err) => {
        log("dispatcher_event_notify_failed", { orderId: order.orderId, eventId: event.eventId, error: String(err) });
      });
    }

    return { outcome: "applied", orderId: order.orderId, state: decision.next.state, sequence: decision.next.sequence };
  }

  log("dispatcher_event_contention", { eventId: event.eventId, orderId: order.orderId });
  return { outcome: "rejected", orderId: order.orderId, reason: "write contention" };
}
