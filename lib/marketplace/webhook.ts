import "server-only";
import { getAdminDb } from "@/lib/firebase-admin";
import { readFlags } from "./config";
import { settlePayment, type ProviderVerification } from "./payment";
import { FirestoreMarketplaceStore } from "./store";
import { announceOrderCreated } from "./announce";

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

  // ── No rider is requested here ────────────────────────────────────────────
  //
  // Paying is the customer's decision; accepting is the restaurant's. The order
  // now exists in `placed` and waits for the kitchen. `requestDeliveryForOrder`
  // is called from the restaurant's accept action, and refuses outright for an
  // order that has not been accepted, so a webhook — first delivery or replay —
  // can no longer book a rider for food nobody has agreed to cook.

  // One settlement, one order, one announcement — shared with the callback and
  // the reconciliation sweep so an order recovered without a webhook is not
  // announced in silence. Enqueueing twice is refused by the outbox's own key.
  await announceOrderCreated(db, result.orderId);
}

