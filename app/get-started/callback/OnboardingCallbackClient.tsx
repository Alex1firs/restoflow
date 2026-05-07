"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

type State = "verifying" | "success" | "error";

type SuccessData = {
  slug: string;
  email: string;
  resetLink: string;
};

export default function OnboardingCallbackClient() {
  const searchParams = useSearchParams();
  const reference = searchParams.get("reference") ?? searchParams.get("trxref") ?? "";

  const [state, setState] = useState<State>("verifying");
  const [result, setResult] = useState<SuccessData | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (!reference) {
      setTimeout(() => {
        setState("error");
        setErrorMsg("No payment reference found.");
      }, 0);
      return;
    }

    fetch("/api/onboarding/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reference }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setResult(data);
          setState("success");
        } else {
          setState("error");
          setErrorMsg(data.error ?? "Payment verification failed.");
        }
      })
      .catch(() => {
        setState("error");
        setErrorMsg("Network error. Please contact support.");
      });
  }, [reference]);

  if (state === "verifying") {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto mb-6" />
          <p className="text-gray-400 font-medium">Setting up your restaurant…</p>
        </div>
      </div>
    );
  }

  if (state === "success" && result) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center">
          <div className="w-16 h-16 bg-orange-500/10 border border-orange-500/30 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-8 h-8 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>

          <h1 className="text-3xl font-black italic uppercase tracking-tighter mb-2">
            Your restaurant is <span className="text-orange-500">live!</span>
          </h1>
          <p className="text-gray-400 text-sm mb-8">
            Payment confirmed. Your account is ready.
          </p>

          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 text-left mb-6 space-y-4">
            <div>
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Login Email</p>
              <p className="text-sm font-medium text-white">{result.email}</p>
            </div>
            <div>
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Next Step</p>
              <p className="text-sm text-gray-300">
                Click the button below to set your password and access your dashboard.
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <a
              href={result.resetLink}
              className="block w-full bg-orange-500 hover:bg-orange-600 text-white font-black text-sm py-4 rounded-xl transition"
            >
              Set My Password & Login →
            </a>
            <Link
              href={`/admin/${result.slug}/orders`}
              className="block w-full border border-white/20 hover:border-white/40 text-white font-bold text-sm py-3.5 rounded-xl transition"
            >
              Go to Dashboard
            </Link>
          </div>

          <div className="mt-8 text-left space-y-3">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">What to do next</p>
            {[
              "Set your password using the link above",
              "Log in to your dashboard",
              "Add your menu items",
              "Share your QR code with customers",
            ].map((step, i) => (
              <div key={step} className="flex items-center gap-3 text-sm text-gray-400">
                <span className="w-5 h-5 rounded-full bg-orange-500/20 text-orange-400 text-xs font-black flex items-center justify-center shrink-0">
                  {i + 1}
                </span>
                {step}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center px-4">
      <div className="max-w-sm w-full text-center">
        <div className="w-14 h-14 bg-red-500/10 border border-red-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg className="w-7 h-7 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
        <h2 className="text-xl font-black text-white mb-2">Something went wrong</h2>
        <p className="text-gray-400 text-sm mb-6">{errorMsg}</p>
        <Link
          href="/get-started"
          className="inline-block bg-orange-500 hover:bg-orange-600 text-white font-bold text-sm px-6 py-3 rounded-xl transition"
        >
          Try Again
        </Link>
      </div>
    </div>
  );
}
