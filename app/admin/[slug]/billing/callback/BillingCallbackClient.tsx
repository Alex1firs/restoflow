"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type State = "verifying" | "success" | "error";

export default function BillingCallbackClient({ slug }: { slug: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const reference = searchParams.get("reference") ?? searchParams.get("trxref") ?? "";

  const [state, setState] = useState<State>("verifying");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (!reference) {
      setTimeout(() => {
        setState("error");
        setErrorMsg("No payment reference found.");
      }, 0);
      return;
    }

    fetch("/api/payments/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reference }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setState("success");
          setTimeout(() => router.push(`/admin/${slug}/orders`), 3000);
        } else {
          setState("error");
          setErrorMsg(data.error ?? "Payment verification failed.");
        }
      })
      .catch(() => {
        setState("error");
        setErrorMsg("Network error. Please contact support.");
      });
  }, [reference, slug, router]);

  if (state === "verifying") {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-sm border p-10 text-center max-w-sm w-full">
          <div className="w-12 h-12 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto mb-6" />
          <p className="text-gray-700 font-medium">Confirming your payment…</p>
        </div>
      </div>
    );
  }

  if (state === "success") {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-sm border p-10 text-center max-w-sm w-full">
          <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-black text-gray-900 mb-2">Subscription Activated</h2>
          <p className="text-gray-500 text-sm">Your restaurant is now live. Redirecting you to orders…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-sm border p-10 text-center max-w-sm w-full">
        <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
        <h2 className="text-xl font-black text-gray-900 mb-2">Payment Failed</h2>
        <p className="text-gray-500 text-sm mb-6">{errorMsg}</p>
        <button
          onClick={() => router.push(`/admin/${slug}/orders`)}
          className="bg-gray-900 text-white text-sm font-bold px-6 py-2 rounded-lg hover:bg-gray-700 transition"
        >
          Back to Dashboard
        </button>
      </div>
    </div>
  );
}
