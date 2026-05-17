"use client";

import { useState } from "react";
import type { SubscriptionStatus } from "@/lib/subscription";

type Props = {
  restaurantSlug: string;
  planId: string;
  planName: string;
  monthlyPrice: number;
  subscriptionStatus: SubscriptionStatus;
};

export default function BillingSection({
  restaurantSlug,
  planId,
  planName,
  monthlyPrice,
  subscriptionStatus,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleRenew() {
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/payments/initialize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          restaurantId: restaurantSlug,
          planId,
          paymentType: "subscription",
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.authorizationUrl) {
        setError(data.error ?? "Failed to initialize payment.");
        setLoading(false);
        return;
      }

      window.location.href = data.authorizationUrl;
    } catch {
      setError("Network error. Please try again.");
      setLoading(false);
    }
  }

  const badgeConfig = {
    expired: { bg: "bg-red-100", text: "text-red-700", label: "Expired" },
    grace_period: { bg: "bg-orange-100", text: "text-orange-700", label: "Grace Period" },
    trialing: { bg: "bg-amber-100", text: "text-amber-700", label: "Free Trial" },
    active: { bg: "bg-green-100", text: "text-green-700", label: "Active" },
  }[subscriptionStatus];

  const isExpiredOrGrace = subscriptionStatus === "expired" || subscriptionStatus === "grace_period";

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6">
      <h2 className="text-base font-black text-gray-900 uppercase tracking-tight mb-4">
        Billing
      </h2>

      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-sm font-semibold text-gray-700">{planName} Plan</p>
          <p className="text-xs text-gray-400">
            ₦{monthlyPrice.toLocaleString()}/month
          </p>
        </div>
        <span
          className={`text-[10px] font-black uppercase px-2 py-1 rounded ${badgeConfig.bg} ${badgeConfig.text}`}
        >
          {badgeConfig.label}
        </span>
      </div>

      {error && (
        <p className="text-sm text-red-600 mb-4">{error}</p>
      )}

      <button
        onClick={handleRenew}
        disabled={loading}
        className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white font-black text-sm py-3 rounded-xl transition"
      >
        {loading
          ? "Redirecting…"
          : isExpiredOrGrace
          ? "Renew Subscription"
          : subscriptionStatus === "trialing"
          ? "Subscribe Now"
          : "Extend Subscription"}
      </button>
    </div>
  );
}
