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
  const [selectedPreset, setSelectedPreset] = useState<number | "custom">(1);
  const [customValue, setCustomValue] = useState<string>("2");

  const handleCustomValueChange = (val: string) => {
    // Only allow digits
    const cleaned = val.replace(/\D/g, "");
    if (cleaned === "") {
      setCustomValue("");
      return;
    }
    const num = parseInt(cleaned, 10);
    // Clamp to 1 - 36 months range
    const clamped = Math.min(36, Math.max(1, num));
    setCustomValue(clamped.toString());
  };

  const effectiveMonths =
    selectedPreset === "custom"
      ? customValue === ""
        ? 1
        : parseInt(customValue, 10)
      : selectedPreset;

  const isInvalidCustom =
    selectedPreset === "custom" &&
    (customValue === "" || parseInt(customValue, 10) < 1 || parseInt(customValue, 10) > 36);

  async function handleRenew() {
    if (isInvalidCustom) return;

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
          months: effectiveMonths,
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
  }[subscriptionStatus] ?? { bg: "bg-gray-100", text: "text-gray-700", label: "Unknown" };

  const isExpiredOrGrace = subscriptionStatus === "expired" || subscriptionStatus === "grace_period";

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
      <h2 className="text-sm font-black text-gray-900 uppercase tracking-wider mb-4">
        Subscription & Billing
      </h2>

      {/* Plan Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <p className="text-sm font-bold text-gray-800">{planName} Plan</p>
          <p className="text-xs text-gray-400">
            ₦{monthlyPrice.toLocaleString()}/month
          </p>
        </div>
        <span
          className={`text-[10px] font-black uppercase px-2.5 py-1 rounded-md tracking-wider ${badgeConfig.bg} ${badgeConfig.text}`}
        >
          {badgeConfig.label}
        </span>
      </div>

      {/* Selector Heading */}
      <div className="mb-3">
        <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest">
          Choose Subscription Period
        </label>
      </div>

      {/* Presets Grid */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        {[1, 3, 6, 12].map((m) => (
          <button
            key={m}
            type="button"
            disabled={loading}
            onClick={() => setSelectedPreset(m)}
            className={`py-2.5 px-3 text-xs font-bold rounded-xl border transition-all duration-250 ${
              selectedPreset === m
                ? "border-orange-500 bg-orange-50/50 text-orange-600 shadow-sm"
                : "border-gray-200 text-gray-600 bg-white hover:border-gray-300 hover:bg-gray-50/50"
            }`}
          >
            {m} {m === 1 ? "Month" : "Months"}
          </button>
        ))}
        <button
          type="button"
          disabled={loading}
          onClick={() => setSelectedPreset("custom")}
          className={`col-span-2 py-2.5 px-3 text-xs font-bold rounded-xl border transition-all duration-250 ${
            selectedPreset === "custom"
              ? "border-orange-500 bg-orange-50/50 text-orange-600 shadow-sm"
              : "border-gray-200 text-gray-600 bg-white hover:border-gray-300 hover:bg-gray-50/50"
          }`}
        >
          Custom Duration
        </button>
      </div>

      {/* Custom Input */}
      {selectedPreset === "custom" && (
        <div className="mb-4 animate-in fade-in slide-in-from-top-1 duration-200">
          <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1.5">
            Enter Duration (1 to 36 months)
          </label>
          <div className="relative flex items-center">
            <input
              type="text"
              inputMode="numeric"
              disabled={loading}
              value={customValue}
              onChange={(e) => handleCustomValueChange(e.target.value)}
              className="w-full border border-gray-200 rounded-xl pl-4 pr-16 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-orange-500 transition-colors bg-white font-medium"
              placeholder="e.g. 5"
            />
            <span className="absolute right-4 text-xs font-bold text-gray-400 select-none pointer-events-none">
              Months
            </span>
          </div>
        </div>
      )}

      {/* Cost Breakdown */}
      <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100 mb-5 space-y-2 text-xs text-gray-500">
        <div className="flex justify-between">
          <span>Subscription Price</span>
          <span className="font-semibold text-gray-700">₦{monthlyPrice.toLocaleString()} / mo</span>
        </div>
        <div className="flex justify-between">
          <span>Chosen Duration</span>
          <span className="font-semibold text-gray-700">
            {effectiveMonths} {effectiveMonths === 1 ? "month" : "months"}
          </span>
        </div>
        <div className="border-t border-gray-200/80 my-1.5 pt-2 flex justify-between font-black text-sm text-gray-800">
          <span>Total Price</span>
          <span className="text-orange-600 text-base">₦{(monthlyPrice * effectiveMonths).toLocaleString()}</span>
        </div>
      </div>

      {error && (
        <p className="text-xs font-semibold text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2.5 mb-4 animate-in fade-in duration-200">
          {error}
        </p>
      )}

      <button
        onClick={handleRenew}
        disabled={loading || isInvalidCustom}
        className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white font-black text-sm py-3.5 rounded-xl shadow-sm shadow-orange-500/10 transition-all duration-200 active:scale-[0.98]"
      >
        {loading
          ? "Redirecting…"
          : isExpiredOrGrace
          ? `Renew for ₦${(monthlyPrice * effectiveMonths).toLocaleString()}`
          : `Extend for ₦${(monthlyPrice * effectiveMonths).toLocaleString()}`}
      </button>
    </div>
  );
}
