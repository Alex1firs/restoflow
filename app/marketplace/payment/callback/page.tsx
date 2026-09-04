import { getAdminDb } from "@/lib/firebase-admin";
import { readFlags } from "@/lib/marketplace/config";
import { verifyAndSettle } from "@/lib/marketplace/reconcile";

type Props = {
  searchParams: Promise<{ reference?: string; trxref?: string }>;
};

export const revalidate = 0;
export const dynamic = "force-dynamic";

/**
 * Where Paystack sends a marketplace customer after they pay.
 *
 * Until now this route did not exist and every successful marketplace payment
 * landed on a 404 — the money was taken, the webhook created the order, and
 * the customer was shown a broken page.
 *
 * It settles rather than merely reporting: `verifyAndSettle` asks Paystack
 * directly and creates the order if the webhook has not yet arrived. That is
 * the same call the mobile app's confirm route and the reconciliation sweep
 * make, so all three can race and exactly one order results.
 *
 * The page shows one of three honest states. "Processing" is not a failure —
 * it is Paystack not having reached a verdict yet, and the customer is told to
 * check their orders rather than to pay again.
 */
export default async function MarketplacePaymentCallback({ searchParams }: Props) {
  const { reference: ref, trxref } = await searchParams;
  const reference = (ref ?? trxref ?? "").trim();

  if (!reference) return <Result state="failed" message="No payment reference was provided." />;
  if (!readFlags().paymentsEnabled) {
    return <Result state="processing" reference={reference} />;
  }

  let outcome: string;
  try {
    outcome = (await verifyAndSettle({ db: getAdminDb(), reference, nowMs: Date.now() })).outcome;
  } catch {
    // Never tell somebody who has paid that their payment failed because our
    // own verification threw. The webhook and the sweep are still coming.
    return <Result state="processing" reference={reference} />;
  }

  switch (outcome) {
    case "created":
    case "replayed":
      return <Result state="paid" reference={reference} />;
    case "failed":
      return <Result state="failed" reference={reference} message="That payment was not completed. You have not been charged." />;
    case "amount_mismatch":
    case "no_intent":
      return <Result state="failed" reference={reference} message="We could not match that payment to a basket. Please contact support with the reference below." />;
    default:
      // pending / unknown
      return <Result state="processing" reference={reference} />;
  }
}

function Result({
  state, reference, message,
}: { state: "paid" | "processing" | "failed"; reference?: string; message?: string }) {
  const copy = {
    paid: {
      title: "Payment successful",
      body: "Your order has been sent to the restaurant. You'll see it in the app as soon as they accept it.",
      accent: "bg-orange-600",
    },
    processing: {
      title: "Confirming your payment",
      body: "This usually takes a few seconds. Your payment is safe — if it went through, your order will appear in the app shortly. Please don't pay again.",
      accent: "bg-amber-600",
    },
    failed: {
      title: "Payment not completed",
      body: message ?? "That payment did not go through. Your basket is still in the app.",
      accent: "bg-gray-700",
    },
  }[state];

  return (
    <div className="min-h-screen bg-gray-900 text-white flex items-start justify-center px-4 py-16">
      <div className="max-w-md w-full text-center">
        <div className={`w-20 h-20 ${copy.accent} rounded-[2rem] flex items-center justify-center mx-auto mb-8 shadow-2xl`}>
          {state === "paid" ? (
            <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3}
                d={state === "processing" ? "M12 6v6l4 2" : "M6 18L18 6M6 6l12 12"} />
            </svg>
          )}
        </div>

        <h1 className="text-4xl font-black italic tracking-tighter uppercase mb-4">{copy.title}</h1>
        <p className="text-gray-400 text-lg">{copy.body}</p>

        <p className="mt-10 text-gray-400">You can close this page and return to the RestoFlow app.</p>

        {reference && (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 mt-8 text-left">
            <p className="text-xs font-black text-gray-500 uppercase tracking-widest mb-2">Payment reference</p>
            <p className="font-mono font-bold text-orange-500 text-sm break-all">{reference}</p>
          </div>
        )}
      </div>
    </div>
  );
}
