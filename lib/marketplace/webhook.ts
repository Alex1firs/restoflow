import "server-only";
import { getAdminDb } from "@/lib/firebase-admin";
import { readFlags } from "./config";
import { settlePayment, type ProviderVerification } from "./payment";
import { FirestoreMarketplaceStore } from "./store";
import { customerMessage, restaurantMessage } from "./notifications";

/**
 * The marketplace half of the Paystack webhook.
 *
 * Kept out of the route file so the existing handler gains one clearly-bounded
 * branch and nothing else. With `MARKETPLACE_PAYMENTS_ENABLED` off this returns
 * immediately, so the webhook behaves exactly as it did before.
 *
 * ── Why it cannot double-charge or double-create ─────────────────────────────
 * Paystack retries aggressively, the browser callback races the webhook, and
 * the intent sweep polls the same reference. All three land in `settlePayment`,
 * which asks "have I already made an order for this reference?" before anything
 * else. Exactly one order exists afterwards.
 */
export async function handleMarketplacePaymentWebhook(
  data: { reference: string; amount: number; status?: string; fees?: number }
): Promise<void> {
  const flags = readFlags();
  if (!flags.paymentsEnabled) {
    console.warn("[marketplace] payment webhook received while the marketplace is disabled");
    return;
  }

  const db = getAdminDb();
  const store = new FirestoreMarketplaceStore(db);

  const verification: ProviderVerification = {
    reference: data.reference,
    // Paystack only posts charge.success to this branch, but the status is
    // read rather than assumed — a webhook is untrusted input like any other.
    status: data.status === "success" || data.status === undefined ? "success" : "failed",
    amountMinor: data.amount,
    feeMinor: typeof data.fees === "number" ? data.fees : null,
  };

  const result = await settlePayment({
    verification, store, nowMs: Date.now(),
    log: (event, fields) => console.log(JSON.stringify({ scope: "marketplace_payment", event, ...fields })),
  });

  if (result.outcome !== "created") {
    // replayed / pending / no_intent / mismatch are all settled outcomes. The
    // caller returns 200 so Paystack stops retrying something that is done.
    //
    // Note this returns BEFORE the delivery handoff below. A replayed webhook
    // therefore never reaches Dispatcher — the first line of defence against a
    // second delivery job for one order.
    return;
  }

  // ── The order is paid and committed. Now ask for a rider. ──────────────────
  //
  // Deliberately after settlement, not inside it: settlement runs in a
  // transaction, and a Dispatcher timeout inside that transaction would roll
  // back an order the customer has already been charged for. The paid order is
  // the durable record; the delivery is requested against it and retried until
  // it succeeds.
  //
  // Failures here are logged and swallowed. Paystack must still get its 200 —
  // redelivering a payment we have already settled would achieve nothing, and
  // the reconcile sweep picks up an order left without a delivery.
  try {
    const { requestDeliveryForOrder } = await import("./delivery-handoff");
    const handoff = await requestDeliveryForOrder({ db, orderId: result.orderId, nowMs: Date.now() });
    console.log(JSON.stringify({
      scope: "marketplace_payment", event: "delivery_handoff",
      orderId: result.orderId, outcome: handoff.outcome,
      ...("deliveryJobId" in handoff ? { deliveryJobId: handoff.deliveryJobId } : {}),
      ...("reason" in handoff ? { reason: handoff.reason } : {}),
    }));
  } catch (err) {
    console.error(JSON.stringify({
      scope: "marketplace_payment", event: "delivery_handoff_threw",
      orderId: result.orderId, error: err instanceof Error ? err.message : String(err),
    }));
  }

  // Notifications are ENQUEUED, never sent inline: a slow push provider must
  // not delay a webhook Paystack is timing, and the outbox is deduplicated so a
  // retry cannot send the same message twice.
  try {
    const snap = await db.collection("orders").doc(result.orderId).get();
    const order = snap.data();
    if (!order) return;

    const restaurantSnap = await db.collection("restaurants").doc(String(order.restaurantId)).get();
    const restaurantName = String(restaurantSnap.data()?.name ?? order.restaurantId);

    await store.enqueueNotification({
      orderId: result.orderId, audience: "customer", event: "payment_successful",
      payload: customerMessage({
        event: "payment_successful", orderId: result.orderId,
        orderCode: String(order.marketplaceOrderCode), restaurantName,
      }) as unknown as Record<string, unknown>,
      nowMs: Date.now(),
    });

    await store.enqueueNotification({
      orderId: result.orderId, audience: "restaurant", event: "new_marketplace_order",
      payload: restaurantMessage({
        event: "new_marketplace_order",
        orderCode: String(order.marketplaceOrderCode),
        itemsSummary: summarise(order.items),
        restaurantSubtotalMinor: Number(order.pricing?.restaurantSubtotalMinor ?? 0),
      }) as unknown as Record<string, unknown>,
      nowMs: Date.now(),
    });
  } catch (err) {
    // The order is created and paid. A notification failure is a delivery
    // problem for the outbox worker, never a reason to fail the webhook and
    // have Paystack redeliver a payment we have already settled.
    console.error("[marketplace] failed to enqueue notifications", {
      orderId: result.orderId, error: err instanceof Error ? err.message : String(err),
    });
  }
}

function summarise(items: unknown): string {
  if (!Array.isArray(items)) return "";
  return items
    .map((i) => `${(i as { quantity?: number }).quantity ?? 1}× ${(i as { name?: string }).name ?? "item"}`)
    .join(", ");
}
