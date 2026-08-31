/**
 * The background work that keeps a two-system order from getting stuck.
 *
 * Three jobs, all pure over ports so their scheduling, bounding and failure
 * behaviour is testable without a cron, a clock, or a database:
 *
 *   confirmSweep       release a delivery job to riders when the prep clock says so
 *   reconcileSweep     repair a delivery projection that stopped hearing events
 *   intentSweep        expire abandoned checkouts
 *
 * ── Properties every one of them holds ───────────────────────────────────────
 * Idempotent — running twice does what running once did. Bounded — a fixed
 * batch size, so a backlog degrades throughput and never memory. Retry-safe —
 * a failure on one order cannot abort the batch. Restart-safe — all state is in
 * the database, nothing in process memory. Observable — every run returns a
 * counted result, and nothing is ever dropped without a record.
 */

import type { DeliveryProjection } from "../delivery/projection";
import { reconcileVerdict, reconcileFrom } from "../delivery/projection";
import type { DeliveryState, DriverPublicProfile } from "../delivery/contract";

/** One order's worth of work. Deliberately the narrowest possible view. */
export type DueOrder = {
  orderId: string;
  restaurantId: string;
  correlationId: string;
  delivery: DeliveryProjection;
  confirmAt: number | null;
};

export type WorkerResult = {
  scanned: number;
  actioned: number;
  skipped: number;
  failed: number;
  /** Names the orders that need a human, so the run is not silently lossy. */
  attention: string[];
};

const emptyResult = (): WorkerResult => ({ scanned: 0, actioned: 0, skipped: 0, failed: 0, attention: [] });

/** A batch, not a backlog. A stuck sweep must not grow without bound. */
export const BATCH_SIZE = 50;

// ── 1. Release the delivery job when the kitchen is nearly done ─────────────

export type ConfirmPorts = {
  findDueForConfirm(nowMs: number, limit: number): Promise<DueOrder[]>;
  /** Idempotent on the Dispatcher side; a double confirm is harmless. */
  confirmDelivery(args: { orderId: string; correlationId: string }): Promise<{ ok: boolean; retryable: boolean }>;
  markAttention(orderId: string, reason: string): Promise<void>;
  log: (event: string, fields: Record<string, unknown>) => void;
};

/**
 * The other half of the draft/confirm split.
 *
 * A job created at payment sits invisible until this releases it. Missing a
 * minute costs a minute — which is why a cron sweep is the right mechanism and
 * an in-process timer is not: a deploy in the middle of a 25-minute prep must
 * not lose the release.
 */
export async function confirmSweep(ports: ConfirmPorts, nowMs: number): Promise<WorkerResult> {
  const r = emptyResult();
  const due = await ports.findDueForConfirm(nowMs, BATCH_SIZE);
  r.scanned = due.length;

  for (const order of due) {
    // Re-check under the current state rather than trusting the query: the
    // restaurant may have signalled ready (and confirmed early) since.
    if (order.delivery.state !== "REQUESTED") {
      r.skipped++;
      continue;
    }

    try {
      const res = await ports.confirmDelivery({ orderId: order.orderId, correlationId: order.correlationId });
      if (res.ok) {
        r.actioned++;
      } else if (res.retryable) {
        // Left alone deliberately: the next sweep retries it, and `confirmAt`
        // is already in the past so it stays due.
        r.failed++;
        ports.log("confirm_sweep_retryable", { orderId: order.orderId, correlationId: order.correlationId });
      } else {
        // A definite refusal will not fix itself. Food is cooking with no
        // courier requested, which is the loudest failure this system has.
        r.failed++;
        r.attention.push(order.orderId);
        await ports.markAttention(order.orderId, "delivery could not be released to riders");
      }
    } catch (err) {
      // One bad order must never abort the batch.
      r.failed++;
      ports.log("confirm_sweep_error", { orderId: order.orderId, error: String(err) });
    }
  }

  ports.log("confirm_sweep", { ...r, attention: r.attention.length });
  return r;
}

// ── 2. Repair a projection that stopped hearing events ─────────────────────

export type ReconcilePorts = {
  findStale(olderThanMs: number, limit: number): Promise<DueOrder[]>;
  /** Authoritative read from Dispatcher. */
  fetchAuthoritative(args: { orderId: string; correlationId: string }): Promise<
    { ok: true; state: DeliveryState; deliveryJobId: string; driver: DriverPublicProfile | null; etaToDropoffMins: number | null }
    | { ok: false; retryable: boolean }
  >;
  writeProjection(orderId: string, expectedSequence: number, next: DeliveryProjection): Promise<boolean>;
  markAttention(orderId: string, reason: string): Promise<void>;
  log: (event: string, fields: Record<string, unknown>) => void;
};

/**
 * The safety net that makes webhook loss survivable rather than silent.
 *
 * A polled read IS current truth, so it bypasses the sequence guard — the whole
 * reason we are polling is that the event stream has a hole in it. It still
 * refuses to reopen a terminal delivery, so a slow poll racing a final webhook
 * cannot un-deliver an order.
 */
export async function reconcileSweep(
  ports: ReconcilePorts,
  nowMs: number,
  staleAfterMs: number
): Promise<WorkerResult> {
  const r = emptyResult();
  const stale = await ports.findStale(nowMs - staleAfterMs, BATCH_SIZE);
  r.scanned = stale.length;

  for (const order of stale) {
    const verdict = reconcileVerdict(order.delivery, nowMs);
    if (verdict === "ok") { r.skipped++; continue; }

    try {
      const authoritative = await ports.fetchAuthoritative({
        orderId: order.orderId, correlationId: order.correlationId,
      });

      if (!authoritative.ok) {
        r.failed++;
        if (!authoritative.retryable) {
          // Dispatcher does not know about a delivery we think is live. That is
          // a genuine divergence and needs a person, not another poll.
          r.attention.push(order.orderId);
          await ports.markAttention(order.orderId, "Dispatcher does not recognise this delivery");
        }
        continue;
      }

      const decision = reconcileFrom(order.delivery, {
        deliveryJobId: authoritative.deliveryJobId,
        state: authoritative.state,
        driver: authoritative.driver,
        etaToDropoffMins: authoritative.etaToDropoffMins,
      }, nowMs);

      if (decision.kind !== "applied") { r.skipped++; continue; }

      const written = await ports.writeProjection(order.orderId, order.delivery.sequence, decision.next);
      if (written) {
        r.actioned++;
        if (decision.next.state !== order.delivery.state) {
          ports.log("reconcile_repaired", {
            orderId: order.orderId, from: order.delivery.state, to: decision.next.state,
            correlationId: order.correlationId,
          });
        }
      } else {
        // A real event landed while we were polling. It won, correctly.
        r.skipped++;
      }

      if (verdict === "attention") {
        r.attention.push(order.orderId);
        await ports.markAttention(order.orderId, "delivery went quiet and needed reconciliation");
      }
    } catch (err) {
      r.failed++;
      ports.log("reconcile_error", { orderId: order.orderId, error: String(err) });
    }
  }

  ports.log("reconcile_sweep", { ...r, attention: r.attention.length });
  return r;
}

// ── 3. Expire abandoned checkouts ──────────────────────────────────────────

export type IntentPorts = {
  findExpiredIntents(nowMs: number, limit: number): Promise<string[]>;
  /**
   * Verify with the provider before discarding. A customer who paid and then
   * closed their browser must NOT have their order thrown away because a
   * timer expired — the money is real even if the callback never arrived.
   */
  verifyWithProvider(reference: string): Promise<"success" | "failed" | "unknown">;
  settle(reference: string): Promise<void>;
  discard(reference: string): Promise<void>;
  log: (event: string, fields: Record<string, unknown>) => void;
};

export async function intentSweep(ports: IntentPorts, nowMs: number): Promise<WorkerResult> {
  const r = emptyResult();
  const expired = await ports.findExpiredIntents(nowMs, BATCH_SIZE);
  r.scanned = expired.length;

  for (const reference of expired) {
    try {
      const status = await ports.verifyWithProvider(reference);
      if (status === "success") {
        // The most valuable branch in this file: a paid order that would
        // otherwise have been silently dropped.
        await ports.settle(reference);
        r.actioned++;
        ports.log("intent_sweep_rescued_payment", { reference });
      } else if (status === "failed") {
        await ports.discard(reference);
        r.actioned++;
      } else {
        // Unknown is not "no". Leave it for the next sweep rather than
        // discarding an intent that may yet be paid.
        r.skipped++;
      }
    } catch (err) {
      r.failed++;
      ports.log("intent_sweep_error", { reference, error: String(err) });
    }
  }

  ports.log("intent_sweep", { ...r, attention: 0 });
  return r;
}
