import "server-only";
import type { Firestore } from "firebase-admin/firestore";
import { FirestoreMarketplaceStore } from "./store";
import { customerMessage, restaurantMessage } from "./notifications";

/**
 * Tell the customer and the restaurant that an order now exists.
 *
 * ── Why this is shared rather than living in the webhook ─────────────────────
 * A payment becomes an order by whichever of three paths notices first: the
 * Paystack webhook, the customer's return from checkout, or the reconciliation
 * sweep. Only the webhook used to announce it, so an order recovered by
 * reconciliation — exactly the case that happens when a webhook is lost, which
 * is when a customer is *most* anxious — arrived in silence.
 *
 * One settlement, one order, one announcement, whichever path got there first.
 *
 * ── Why calling it twice is safe ─────────────────────────────────────────────
 * The outbox keys on `<orderId>__<audience>__<event>` and inserts with
 * `create`, so a second attempt is refused by the database rather than by this
 * code remembering. A delayed webhook arriving after reconciliation therefore
 * adds nothing.
 *
 * Never throws: the order is paid and real, and a notification problem belongs
 * to the outbox worker, not to the caller that happened to settle the payment.
 */
/**
 * Send what was just queued, without letting it touch the caller.
 *
 * The queue exists so a slow provider can never fail an order write, and that
 * still holds: this runs after the order is committed, and it swallows
 * everything. What it buys is immediacy — the hosting plan allows only a daily
 * cron, and "your order was received" arriving tomorrow morning is not a
 * notification. The cron remains the guaranteed backstop for anything this
 * best-effort pass does not get to, including retries with backoff.
 */
async function deliverQueuedNow(db: Firestore, orderId: string): Promise<void> {
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
      scope: "marketplace_announce", event: "delivered_inline", orderId, ...run,
    }));
  } catch (err) {
    // The messages are already queued and the cron will find them. Nothing here
    // is allowed to reach the payment path.
    console.error(JSON.stringify({
      scope: "marketplace_announce", event: "inline_delivery_failed", orderId,
      error: err instanceof Error ? err.message : String(err),
    }));
  }
}

export async function announceOrderCreated(db: Firestore, orderId: string): Promise<void> {
  try {
    const snap = await db.collection("orders").doc(orderId).get();
    const order = snap.data();
    if (!order || order.orderSource !== "marketplace") return;

    const store = new FirestoreMarketplaceStore(db);
    const orderCode = String(order.marketplaceOrderCode ?? "");
    const nowMs = Date.now();

    // Frozen on the order since checkout; the lookup is only for orders that
    // predate the field.
    const restaurantName = typeof order.restaurantName === "string" && order.restaurantName.trim()
      ? order.restaurantName
      : String(
          (await db.collection("restaurants").doc(String(order.restaurantId)).get()).data()?.name
            ?? order.restaurantId
        );

    await store.enqueueNotification({
      orderId, audience: "customer", event: "payment_successful",
      payload: customerMessage({
        event: "payment_successful", orderId, orderCode, restaurantName,
      }) as unknown as Record<string, unknown>,
      nowMs,
    });

    await store.enqueueNotification({
      orderId, audience: "restaurant", event: "new_marketplace_order",
      payload: restaurantMessage({
        event: "new_marketplace_order",
        orderCode,
        itemsSummary: summarise(order.items),
        restaurantSubtotalMinor: Number(order.pricing?.restaurantSubtotalMinor ?? 0),
      }) as unknown as Record<string, unknown>,
      nowMs,
    });
  } catch (err) {
    console.error(JSON.stringify({
      scope: "marketplace_announce", event: "enqueue_failed",
      orderId, error: err instanceof Error ? err.message : String(err),
    }));
  }

  // Outside the try: whatever was queued above should go out now rather than
  // waiting for the next cron. Cannot throw, by construction.
  await deliverQueuedNow(db, orderId);
}

function summarise(items: unknown): string {
  if (!Array.isArray(items)) return "";
  return items
    .map((i) => `${(i as { quantity?: number }).quantity ?? 1}× ${(i as { name?: string }).name ?? "item"}`)
    .join(", ");
}
