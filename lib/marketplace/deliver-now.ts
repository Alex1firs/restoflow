import "server-only";
import type { Firestore } from "firebase-admin/firestore";

/**
 * Send whatever is queued, right now, without letting it touch the caller.
 *
 * ── Why this exists at all ───────────────────────────────────────────────────
 * The outbox is deliberately write-then-drain so a slow SMS provider can never
 * fail an order write. That property is preserved here: this runs after the
 * write has committed and swallows everything it touches.
 *
 * What it buys is timeliness. The hosting plan permits only a daily cron, and a
 * customer learning tomorrow morning that their courier has arrived is not a
 * notification. So every place that enqueues also nudges the queue, and the
 * cron stays as the backstop that handles retries and anything a nudge missed.
 *
 * Call it from every enqueue site. A message queued by a path that does not
 * call this still sends — just up to a day later, which for "your food is on
 * the way" is the same as not at all.
 */
export async function deliverQueuedNow(db: Firestore, orderId: string): Promise<void> {
  try {
    const { drainOutbox } = await import("./outbox");
    const { sendCustomerPush, sendRestaurantAlert } = await import("./outbox-adapters");
    const { FirestoreMarketplaceStore } = await import("./store");

    const store = new FirestoreMarketplaceStore(db);
    const run = await drainOutbox({
      claimDue: (now, limit) => store.claimDueNotifications(now, limit),
      markSending: (entry, now) => store.markSending(entry, now),
      markSent: (entry, now) => store.markNotificationSent(entry, now),
      scheduleRetry: (entry, next, error) => store.scheduleNotificationRetry(entry, next, error),
      markDead: (entry, error, now) => store.markNotificationDead(entry, error, now),
      invalidateToken: (token, now) => store.invalidateDeviceToken(token, now),
      sendCustomerPush,
      sendRestaurantAlert,
      log: (event, fields) =>
        console.log(JSON.stringify({ scope: "marketplace_outbox", event, ...fields })),
    }, Date.now());

    console.log(JSON.stringify({
      scope: "marketplace_outbox", event: "delivered_inline", orderId, ...run,
    }));
  } catch (err) {
    // Already queued; the cron will find it. Nothing here may reach the caller.
    console.error(JSON.stringify({
      scope: "marketplace_outbox", event: "inline_delivery_failed", orderId,
      error: err instanceof Error ? err.message : String(err),
    }));
  }
}
