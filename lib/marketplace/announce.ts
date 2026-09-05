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
}

function summarise(items: unknown): string {
  if (!Array.isArray(items)) return "";
  return items
    .map((i) => `${(i as { quantity?: number }).quantity ?? 1}× ${(i as { name?: string }).name ?? "item"}`)
    .join(", ");
}
