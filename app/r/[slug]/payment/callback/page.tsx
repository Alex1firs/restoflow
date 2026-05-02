import Link from "next/link";
import { createOrderFromPaymentReference, getOrderByReference } from "@/lib/order-payments";

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
  let message = "";

  try {
    const verifyRes = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } }
    );

    if (!verifyRes.ok) {
      message = "Payment could not be verified. Please contact the restaurant.";
    } else {
      const { data: txData } = await verifyRes.json();

      if (txData.status !== "success") {
        message = `Payment was not completed (status: ${txData.status}). No charge was made.`;
      } else {
        orderId = await createOrderFromPaymentReference(reference);
        if (!orderId) {
          orderId = await getOrderByReference(reference);
        }
        if (orderId) {
          success = true;
        } else {
          message = "Payment received but order could not be created. Please show this page to the restaurant.";
        }
      }
    }
  } catch {
    message = "An error occurred verifying your payment. Please contact the restaurant.";
  }

  return <ResultPage slug={slug} success={success} orderId={orderId} message={message} />;
}

function ResultPage({
  slug,
  success,
  orderId,
  message,
}: {
  slug: string;
  success: boolean;
  orderId?: string | null;
  message?: string;
}) {
  return (
    <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        {success ? (
          <>
            <div className="w-20 h-20 bg-orange-600 rounded-[2rem] flex items-center justify-center mx-auto mb-8 shadow-2xl">
              <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-5xl font-black italic tracking-tighter uppercase mb-4">Payment Successful!</h1>
            <p className="text-gray-400 text-lg mb-10">Your order has been placed and is being prepared.</p>
            {orderId && (
              <div className="bg-white/5 border border-white/10 rounded-2xl p-6 mb-10">
                <p className="text-xs font-black text-gray-500 uppercase tracking-widest mb-2">Order Reference</p>
                <p className="font-mono font-bold text-orange-500 text-sm">{orderId}</p>
              </div>
            )}
            <Link
              href={`/r/${slug}`}
              className="inline-block bg-orange-600 hover:bg-orange-500 text-white font-black py-4 px-10 rounded-2xl uppercase tracking-widest transition-all"
            >
              Back to Menu
            </Link>
          </>
        ) : (
          <>
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
          </>
        )}
      </div>
    </div>
  );
}
