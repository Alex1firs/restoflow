import { getAdminDb } from "@/lib/firebase-admin";
import { withCustomer, badRequest, notFound } from "@/lib/marketplace/mobile-api";
import { verifyAndSettle } from "@/lib/marketplace/reconcile";
import { toCustomerOrderSummary } from "@/lib/marketplace/customer-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "I have just paid — where is my order?"
 *
 * The customer returns from Paystack's hosted page with a reference and no way
 * of knowing whether the webhook has landed. Rather than poll an order that may
 * not exist yet, the app asks here and this route asks Paystack directly.
 *
 * This is a settlement path in its own right, not a read: if the webhook never
 * arrives, this is what turns the payment into an order. It shares
 * `settlePayment` with the webhook and the sweep, so all three can race and
 * exactly one order results.
 *
 * Safe to call repeatedly — that is the point. A double-tapped "I've paid",
 * a retry after a dropped connection and a webhook arriving mid-flight all
 * converge on the same order.
 */
export const POST = withCustomer(async ({ customer, req }) => {
  const body = await req.json().catch(() => null);
  const reference = String((body as { reference?: unknown } | null)?.reference ?? "").trim();
  if (!reference) return badRequest("A payment reference is required.");

  const db = getAdminDb();
  const result = await verifyAndSettle({ db, reference, nowMs: Date.now() });

  switch (result.outcome) {
    case "created":
    case "replayed": {
      const snap = await db.collection("orders").doc(result.orderId).get();
      const d = snap.data();
      // Ownership is checked on the ORDER, not on the reference the caller
      // supplied: knowing a reference must not be enough to read somebody
      // else's order. "Not yours" and "not there" are the same 404.
      if (!d || d.customerId !== customer.id) return notFound();
      return { state: "paid" as const, order: toCustomerOrderSummary(result.orderId, d) };
    }

    // Paystack has not reached a verdict, or we could not reach Paystack. Both
    // mean "ask again", never "your payment failed".
    case "pending":
    case "unknown":
      return { state: "pending" as const, order: null };

    case "failed":
      return { state: "failed" as const, order: null, reason: result.reason };

    case "amount_mismatch":
      // Deliberately vague to the customer, loud in the logs: an amount that
      // does not match the intent is either a bug or an attempt.
      console.error(JSON.stringify({
        scope: "marketplace_reconcile", event: "amount_mismatch",
        reference, expectedMinor: result.expectedMinor, actualMinor: result.actualMinor,
      }));
      return { state: "failed" as const, order: null, reason: "We could not confirm that payment." };

    case "no_intent":
    default:
      return { state: "failed" as const, order: null, reason: "We could not find that checkout." };
  }
});
