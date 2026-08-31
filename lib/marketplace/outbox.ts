/**
 * The notification sender.
 *
 * The outbox is written by whoever changes an order; this drains it. Splitting
 * them is what stops a slow push provider from failing a payment webhook, and
 * what makes "did the customer get told?" a queryable question rather than a
 * hope.
 *
 * ── At-least-once, deduplicated at the key ───────────────────────────────────
 * The queue guarantees at-least-once delivery, so this worker WILL occasionally
 * process the same entry twice. Duplicate suppression is not attempted here at
 * send time — it is already impossible upstream, because the outbox document id
 * is deterministic in (orderId, audience, event). A duplicate delivery event
 * enqueues the same id, `create` fails, and no second message exists to send.
 *
 * Pure over ports.
 */

import type { CustomerEvent, PushMessage, RestaurantMessage } from "./notifications";

export type OutboxState = "queued" | "sending" | "sent" | "failed" | "dead";

export type OutboxEntry = {
  id: string;
  orderId: string;
  audience: "customer" | "restaurant";
  event: string;
  payload: Record<string, unknown>;
  state: OutboxState;
  attempts: number;
  createdAt: number;
  nextAttemptAt: number | null;
  lastError: string | null;
};

/** 30s, 2min, 10min, 1h, 6h — bounded, then dead-lettered for a human. */
export const BACKOFF_MS = [30_000, 120_000, 600_000, 3_600_000, 21_600_000];
export const MAX_ATTEMPTS = 5;
export const BATCH_SIZE = 50;

export type SendOutcome =
  | { status: "sent" }
  /** Retryable: the provider was unreachable or busy. */
  | { status: "transient"; reason: string }
  /** Not retryable: the message will never be deliverable as it stands. */
  | { status: "permanent"; reason: string }
  /** The device token is gone. Prune it and stop. */
  | { status: "token_invalid"; token: string };

export type OutboxPorts = {
  claimDue(nowMs: number, limit: number): Promise<OutboxEntry[]>;
  markSending(entry: OutboxEntry, nowMs: number): Promise<boolean>;
  markSent(entry: OutboxEntry, nowMs: number): Promise<void>;
  scheduleRetry(entry: OutboxEntry, nextAttemptAt: number, error: string): Promise<void>;
  markDead(entry: OutboxEntry, error: string, nowMs: number): Promise<void>;
  /** A token the provider rejected must not be tried again for anyone. */
  invalidateToken(token: string, nowMs: number): Promise<void>;
  sendCustomerPush(entry: OutboxEntry, message: PushMessage): Promise<SendOutcome>;
  sendRestaurantAlert(entry: OutboxEntry, message: RestaurantMessage): Promise<SendOutcome>;
  log: (event: string, fields: Record<string, unknown>) => void;
};

export type OutboxRun = {
  claimed: number;
  sent: number;
  retried: number;
  dead: number;
  skipped: number;
  tokensInvalidated: number;
};

export function backoffFor(attempt: number): number {
  return BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
}

export async function drainOutbox(ports: OutboxPorts, nowMs: number): Promise<OutboxRun> {
  const run: OutboxRun = { claimed: 0, sent: 0, retried: 0, dead: 0, skipped: 0, tokensInvalidated: 0 };
  const due = await ports.claimDue(nowMs, BATCH_SIZE);
  run.claimed = due.length;

  for (const entry of due) {
    // Compare-and-set into `sending`. Two workers running at once — a cron
    // overlapping its own previous run — must not both send the same entry.
    const mine = await ports.markSending(entry, nowMs);
    if (!mine) { run.skipped++; continue; }

    let outcome: SendOutcome;
    try {
      outcome = entry.audience === "customer"
        ? await ports.sendCustomerPush(entry, entry.payload as unknown as PushMessage)
        : await ports.sendRestaurantAlert(entry, entry.payload as unknown as RestaurantMessage);
    } catch (err) {
      outcome = { status: "transient", reason: err instanceof Error ? err.message : String(err) };
    }

    switch (outcome.status) {
      case "sent":
        await ports.markSent(entry, nowMs);
        run.sent++;
        break;

      case "token_invalid":
        // Not a failure of the message — a failure of the address. Prune the
        // token and stop; retrying against a dead token forever is how a queue
        // silently fills with work that can never succeed.
        await ports.invalidateToken(outcome.token, nowMs);
        await ports.markDead(entry, `token invalid: ${outcome.token}`, nowMs);
        run.tokensInvalidated++;
        run.dead++;
        break;

      case "permanent":
        await ports.markDead(entry, outcome.reason, nowMs);
        run.dead++;
        ports.log("outbox_permanent_failure", { id: entry.id, orderId: entry.orderId, reason: outcome.reason });
        break;

      case "transient": {
        const attempts = entry.attempts + 1;
        if (attempts >= MAX_ATTEMPTS) {
          // Dead-lettered, not dropped. Somebody can see it and decide.
          await ports.markDead(entry, `exhausted after ${attempts}: ${outcome.reason}`, nowMs);
          run.dead++;
          ports.log("outbox_exhausted", { id: entry.id, orderId: entry.orderId, attempts });
        } else {
          // `entry.attempts` is the count BEFORE this one, so the first failure
          // schedules BACKOFF_MS[0]. Using the incremented count here skipped
          // the first step and made the first retry four times slower than
          // intended.
          await ports.scheduleRetry(entry, nowMs + backoffFor(entry.attempts), outcome.reason);
          run.retried++;
        }
        break;
      }
    }
  }

  ports.log("outbox_drain", { ...run });
  return run;
}

/**
 * Which customer events are worth a push at all.
 *
 * Mirrors the delivery-side list deliberately: the two must agree, or a
 * customer receives a notification for a state the tracking screen calls quiet.
 */
export const PUSHABLE_CUSTOMER_EVENTS: readonly CustomerEvent[] = [
  "payment_successful", "restaurant_accepted", "courier_assigned",
  "picked_up", "arriving", "delivered", "delivery_issue", "order_rejected",
] as const;

export function isPushable(event: string): boolean {
  return (PUSHABLE_CUSTOMER_EVENTS as readonly string[]).includes(event);
}
