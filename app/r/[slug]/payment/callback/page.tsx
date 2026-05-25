import Link from "next/link";
import { createOrderFromPaymentReference, getOrderByReference } from "@/lib/order-payments";
import { getAdminDb } from "@/lib/firebase-admin";
import { awardLoyaltyTick } from "@/lib/loyalty";
import LoyaltyCard from "@/app/components/LoyaltyCard";
import { serverEnv } from "@/lib/env";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ reference?: string; trxref?: string }>;
};

export const revalidate = 0;

export default async function PaymentCallbackPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { reference: ref, trxref } = await searchParams;
  const reference = ref ?? trxref ?? "";

  if (!reference) {
    return <ResultPage slug={slug} success={false} message="No payment reference found." />;
  }

  let success = false;
  let orderId: string | null = null;
  let trackingToken: string | null = null;
  let message = "";
  let loyaltyResult: Awaited<ReturnType<typeof awardLoyaltyTick>> = null;
  let orderPhone = "";
  let restaurantName = "";

  try {
    const verifyRes = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${serverEnv.PAYSTACK_SECRET_KEY}` } }
    );

    if (!verifyRes.ok) {
      message = "Payment could not be verified. Please contact the restaurant.";
    } else {
      const { data: txData } = await verifyRes.json();

      if (txData.status !== "success") {
        message = `Payment was not completed (status: ${txData.status}). No charge was made.`;
      } else {
        // createOrderFromPaymentReference runs a Firestore transaction that deletes
        // pending_payments/{reference} atomically — only the first concurrent caller
        // gets a non-null return. Use that as the idempotency signal.
        const createdOrderId = await createOrderFromPaymentReference(reference);
        const isCreator = createdOrderId !== null;
        orderId = createdOrderId ?? await getOrderByReference(reference);
        if (orderId) {
          success = true;

          // Only award loyalty once — the caller that actually created the order
          if (isCreator) {
            try {
              const orderSnap = await getAdminDb().collection("orders").doc(orderId).get();
              if (orderSnap.exists) {
                const d = orderSnap.data()!;
                orderPhone = (d.phone as string) ?? "";
                trackingToken = (d.trackingToken as string) ?? null;
                const rSnap = await getAdminDb().collection("restaurants").doc(slug).get();
                restaurantName = (rSnap.data()?.name as string) ?? "";

                if (orderPhone) {
                  loyaltyResult = await awardLoyaltyTick({
                    orderId,
                    restaurantSlug: slug,
                    phone: orderPhone,
                    customerName: (d.customerName as string) ?? "",
                    orderTotal: (d.total as number) ?? 0,
                  }).catch(() => null);
                }
              }
            } catch {
              // Non-fatal — never block the success page
            }
          }
        } else {
          message = "Payment received but order could not be created. Please show this page to the restaurant.";
        }
      }
    }
  } catch {
    message = "An error occurred verifying your payment. Please contact the restaurant.";
  }

  return (
    <ResultPage
      slug={slug}
      success={success}
      orderId={orderId}
      trackingToken={trackingToken}
      message={message}
      loyaltyResult={loyaltyResult}
      orderPhone={orderPhone}
      restaurantName={restaurantName}
    />
  );
}

function ResultPage({
  slug,
  success,
  orderId,
  trackingToken,
  message,
  loyaltyResult,
  orderPhone,
  restaurantName,
}: {
  slug: string;
  success: boolean;
  orderId?: string | null;
  trackingToken?: string | null;
  message?: string;
  loyaltyResult?: Awaited<ReturnType<typeof awardLoyaltyTick>>;
  orderPhone?: string;
  restaurantName?: string;
}) {
  return (
    <div className="min-h-screen bg-gray-900 text-white flex items-start justify-center px-4 py-10">
      <div className="max-w-md w-full">
        {success ? (
          <>
            <div className="text-center mb-8">
              <div className="w-20 h-20 bg-orange-600 rounded-[2rem] flex items-center justify-center mx-auto mb-8 shadow-2xl">
                <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h1 className="text-5xl font-black italic tracking-tighter uppercase mb-4">Payment Successful!</h1>
              <p className="text-gray-400 text-lg">Your order has been placed and is being prepared.</p>
            </div>

            {orderId && (
              <div className="bg-white/5 border border-white/10 rounded-2xl p-6 mb-6">
                <p className="text-xs font-black text-gray-500 uppercase tracking-widest mb-2">Order Reference</p>
                <p className="font-mono font-bold text-orange-500 text-sm">{orderId}</p>
              </div>
            )}

            {/* Loyalty card — only shown when loyalty is active and tick was awarded */}
            {loyaltyResult?.awarded && orderPhone && (
              <div className="mb-6 space-y-3">
                <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/20 rounded-2xl px-4 py-3">
                  <span className="text-xl">🎉</span>
                  <div>
                    <p className="font-black text-green-400 text-sm">You earned a loyalty tick!</p>
                    <p className="text-xs text-green-500/80">
                      {loyaltyResult.rewardUnlocked
                        ? `You unlocked: ${loyaltyResult.reward} 🎁`
                        : `${loyaltyResult.newCurrentTicks}/${loyaltyResult.tickGoal} — ${Math.max(0, loyaltyResult.tickGoal - loyaltyResult.newCurrentTicks)} more ${loyaltyResult.tickGoal - loyaltyResult.newCurrentTicks === 1 ? "order" : "orders"} until your ${loyaltyResult.reward}`}
                    </p>
                  </div>
                </div>

                <LoyaltyCard
                  restaurantSlug={slug}
                  phone={orderPhone}
                  restaurantName={restaurantName}
                  preloaded={{
                    tickGoal: loyaltyResult.tickGoal,
                    reward: loyaltyResult.reward,
                    currentTicks: loyaltyResult.newCurrentTicks,
                    rewardUnlocked: loyaltyResult.rewardUnlocked,
                    unredeemedRewards: loyaltyResult.unredeemedRewards,
                  }}
                />
              </div>
            )}

            <Link
              href={orderId ? `/track/${orderId}${trackingToken ? `?t=${trackingToken}` : ""}` : `/r/${slug}`}
              className="block w-full text-center bg-orange-600 hover:bg-orange-500 text-white font-black py-4 px-10 rounded-2xl uppercase tracking-widest transition-all mb-3"
            >
              {orderId ? "Track Order" : "Back to Menu"}
            </Link>
            <Link
              href={`/r/${slug}`}
              className="block w-full text-center bg-white/10 hover:bg-white/20 text-white font-black py-4 px-10 rounded-2xl uppercase tracking-widest transition-all"
            >
              Order More
            </Link>
          </>
        ) : (
          <div className="text-center">
            <div className="w-20 h-20 bg-red-900/50 border border-red-500/30 rounded-[2rem] flex items-center justify-center mx-auto mb-8">
              <svg className="w-10 h-10 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h1 className="text-4xl font-black italic tracking-tighter uppercase mb-4">Payment Issue</h1>
            <p className="text-gray-400 mb-10">{message}</p>
            <Link
              href={`/r/${slug}`}
              className="inline-block bg-white/10 hover:bg-white/20 text-white font-black py-4 px-10 rounded-2xl uppercase tracking-widest transition-all"
            >
              Try Again
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
