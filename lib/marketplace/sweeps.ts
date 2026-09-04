import "server-only";
import { getAdminDb } from "@/lib/firebase-admin";
import { readDeliveryConfig } from "@/lib/delivery/config";
import { DispatcherClient } from "@/lib/delivery/dispatcher-client";
import { FirestoreDeliveryStore } from "@/lib/delivery/firestore-store";
import { STALE_AFTER_MS } from "@/lib/delivery/projection";
import { FirestoreMarketplaceStore } from "./store";
import {
  confirmSweep, reconcileSweep, intentSweep, BATCH_SIZE,
  type ConfirmPorts, type ReconcilePorts, type IntentPorts, type DueOrder, type WorkerResult,
} from "./workers";
import { discardIntent, findExpiredIntents, verifyAndSettle, verifyWithPaystack } from "./reconcile";

/**
 * Wires the pure sweeps to the real database and the real Dispatcher client.
 *
 * The workers themselves know nothing about firebase or HTTP — that is what
 * makes their bounding, retry and escalation behaviour testable. This file is
 * the only place those ports meet production.
 */

const log = (event: string, fields: Record<string, unknown>) =>
  console.log(JSON.stringify({ scope: "marketplace_sweeps", event, ...fields }));

export type SweepRun = {
  confirm: WorkerResult;
  reconcile: WorkerResult;
  /** Payments Paystack accepted but no webhook ever told us about. */
  intents: WorkerResult;
  /** Orders the restaurant accepted that never got a courier requested. */
  handoffs: WorkerResult;
  durationMs: number;
};

/** Long enough that a slow-but-succeeding handoff is not raced by a retry. */
const HANDOFF_RETRY_AFTER_MS = 60_000;

/**
 * Retry the accept → Dispatcher handoff.
 *
 * Acceptance deliberately does not fail when Dispatcher is unreachable — the
 * restaurant IS committed and must not see an error, nor have the acceptance
 * rolled back. That trade needs this on the other side of it, or an order
 * accepted during a Dispatcher blip would wait for a rider forever.
 *
 * Safe to run against an order that already has a job: `requestDeliveryForOrder`
 * returns `already_attached` without calling Dispatcher, and `externalOrderId`
 * means even a genuine double-call yields the same job.
 */
async function handoffSweep(
  db: ReturnType<typeof getAdminDb>,
  store: FirestoreMarketplaceStore,
  nowMs: number
): Promise<WorkerResult> {
  const r: WorkerResult = { scanned: 0, actioned: 0, skipped: 0, failed: 0, attention: [] };
  const { requestDeliveryForOrder } = await import("./delivery-handoff");

  const pending = await store.findPendingHandoffs(nowMs - HANDOFF_RETRY_AFTER_MS, BATCH_SIZE);
  r.scanned = pending.length;

  for (const orderId of pending) {
    try {
      const outcome = await requestDeliveryForOrder({ db, orderId, nowMs });
      if (outcome.outcome === "created" || outcome.outcome === "already_attached") {
        r.actioned++;
        log("handoff_retry_succeeded", { orderId, deliveryJobId: outcome.deliveryJobId });
      } else if (outcome.outcome === "skipped") {
        // Rejected, cancelled or refunded since. Stop asking.
        await store.clearHandoffPending(orderId);
        r.skipped++;
        log("handoff_retry_abandoned", { orderId, reason: outcome.reason });
      } else {
        r.failed++;
        if (!outcome.retryable) {
          r.attention.push(orderId);
          await store.markAttention(orderId, `handoff_failed:${outcome.reason}`, nowMs).catch(() => {});
        }
      }
    } catch (err) {
      r.failed++;
      log("handoff_retry_threw", { orderId, error: String(err) });
    }
  }

  log("handoff_sweep", { ...r, attention: r.attention.length });
  return r;
}

/**
 * The payment-reconciliation sweep's ports.
 *
 * Split out because it runs even when the delivery integration is off: a
 * customer who has been charged must get their order whether or not Dispatcher
 * is configured. Delivery is a later, separately-recoverable step.
 */
function intentPorts(db: ReturnType<typeof getAdminDb>, nowMs: number): IntentPorts {
  return {
    findExpiredIntents: (now, limit) => findExpiredIntents(db, now, limit),
    verifyWithProvider: async (reference) => (await verifyWithPaystack(reference)).status,
    settle: async (reference) => { await verifyAndSettle({ db, reference, nowMs }); },
    discard: (reference) => discardIntent(db, reference),
    log,
  };
}

export async function runMarketplaceSweeps(nowMs: number): Promise<SweepRun> {
  const started = Date.now();
  const cfg = readDeliveryConfig();

  // With the delivery integration off there is nothing to confirm or
  // reconcile — and no credentials to do it with. Report, do not throw.
  const db = getAdminDb();

  if (!cfg.ok || !cfg.config.enabled) {
    const empty: WorkerResult = { scanned: 0, actioned: 0, skipped: 0, failed: 0, attention: [] };
    log("delivery_sweeps_skipped", {
      reason: cfg.ok ? "delivery integration disabled" : `misconfigured: ${cfg.missing.join(",")}`,
    });
    // Money is still reconciled: a charged customer gets their order even with
    // the delivery integration switched off.
    const intents = await intentSweep(intentPorts(db, nowMs), nowMs);
    return { confirm: empty, reconcile: empty, intents, handoffs: empty, durationMs: Date.now() - started };
  }

  const deliveryStore = new FirestoreDeliveryStore(db);
  const marketplaceStore = new FirestoreMarketplaceStore(db);
  const client = new DispatcherClient({
    baseUrl: cfg.config.baseUrl,
    apiKey: cfg.config.apiKey,
    signingSecret: cfg.config.signingSecret,
    log,
  });

  const toDue = (o: { orderId: string; restaurantId: string; delivery: NonNullable<DueOrder["delivery"]> }): DueOrder => ({
    orderId: o.orderId,
    restaurantId: o.restaurantId,
    correlationId: o.delivery.correlationId,
    delivery: o.delivery,
    confirmAt: null,
  });

  const confirmPorts: ConfirmPorts = {
    findDueForConfirm: async (now, limit) => {
      const rows = await deliveryStore.findDueForConfirm(now, limit);
      return rows.filter((r) => r.delivery).map((r) => ({ ...toDue(r as never), confirmAt: r.confirmAt }));
    },
    confirmDelivery: async ({ orderId, correlationId }) => {
      const r = await client.confirmDelivery({ externalOrderId: orderId, correlationId });
      // The client has already classified the failure by certainty. A retryable
      // one leaves the order due; a definite one escalates.
      return r.ok ? { ok: true, retryable: false } : { ok: false, retryable: r.failure.retryable };
    },
    markAttention: (orderId, reason) => marketplaceStore.markAttention(orderId, reason, nowMs),
    log,
  };

  const reconcilePorts: ReconcilePorts = {
    findStale: async (olderThanMs, limit) => {
      const rows = await deliveryStore.findStaleDeliveries(olderThanMs, limit);
      return rows.filter((r) => r.delivery).map((r) => toDue(r as never));
    },
    fetchAuthoritative: async ({ orderId, correlationId }) => {
      const r = await client.getDelivery({ externalOrderId: orderId, correlationId });
      if (!r.ok) return { ok: false, retryable: r.failure.retryable };
      return {
        ok: true,
        state: r.value.state,
        deliveryJobId: r.value.deliveryJobId,
        driver: r.value.driver,
        etaToDropoffMins: r.value.etaToDropoffMins,
      };
    },
    writeProjection: (orderId, expectedSequence, next) =>
      deliveryStore.writeProjection(orderId, expectedSequence, next),
    markAttention: (orderId, reason) => marketplaceStore.markAttention(orderId, reason, nowMs),
    log,
  };

  // Confirm first: releasing a courier for food that is nearly ready is more
  // time-critical than repairing a projection that is already late.
  const confirm = await confirmSweep(confirmPorts, nowMs);
  const reconcile = await reconcileSweep(reconcilePorts, nowMs, STALE_AFTER_MS);
  // Last, and independent of the two above: it repairs money, not logistics.
  const intents = await intentSweep(intentPorts(db, nowMs), nowMs);
  const handoffs = await handoffSweep(db, marketplaceStore, nowMs);

  return { confirm, reconcile, intents, handoffs, durationMs: Date.now() - started };
}

export { BATCH_SIZE };
