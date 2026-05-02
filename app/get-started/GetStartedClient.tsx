"use client";

import { useState } from "react";
import { PLANS } from "@/lib/plans";

export default function GetStartedClient({ defaultPlanId }: { defaultPlanId: string }) {
  const [planId, setPlanId] = useState(defaultPlanId || "growth");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const selectedPlan = PLANS.find((p) => p.id === planId) ?? PLANS[1];

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const form = e.currentTarget;
    const data = {
      restaurantName: (form.elements.namedItem("restaurantName") as HTMLInputElement).value.trim(),
      email: (form.elements.namedItem("email") as HTMLInputElement).value.trim(),
      phone: (form.elements.namedItem("phone") as HTMLInputElement).value.trim(),
      address: (form.elements.namedItem("address") as HTMLInputElement).value.trim(),
      planId,
    };

    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      const json = await res.json();

      if (!res.ok || !json.authorizationUrl) {
        setError(json.error ?? "Something went wrong. Please try again.");
        setLoading(false);
        return;
      }

      window.location.href = json.authorizationUrl;
    } catch {
      setError("Network error. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-black text-white flex items-start justify-center px-4 pt-28 pb-16">
      <div className="w-full max-w-lg">
        <div className="mb-8">
          <h1 className="text-4xl font-black italic uppercase tracking-tighter mb-2">
            Set up your <span className="text-orange-500">restaurant</span>
          </h1>
          <p className="text-gray-400 text-sm">
            Fill in your details below. You&apos;ll pay the setup fee via Paystack to activate your account.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Plan selector */}
          <div>
            <label className="block text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">
              Select Plan
            </label>
            <div className="grid grid-cols-3 gap-2">
              {PLANS.map((plan) => (
                <button
                  key={plan.id}
                  type="button"
                  onClick={() => setPlanId(plan.id)}
                  className={`relative rounded-xl border p-3 text-left transition ${
                    planId === plan.id
                      ? "border-orange-500 bg-orange-500/10"
                      : "border-white/10 bg-white/5 hover:border-white/30"
                  }`}
                >
                  {plan.popular && (
                    <span className="absolute -top-2 left-2 bg-orange-500 text-white text-[9px] font-black uppercase px-1.5 py-0.5 rounded">
                      Popular
                    </span>
                  )}
                  <p className="font-black text-sm text-white">{plan.name}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    ₦{plan.monthlyPrice.toLocaleString()}/mo
                  </p>
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Setup fee:{" "}
              <span className="text-gray-300 font-bold">
                ₦{selectedPlan.setupFee.toLocaleString()}
              </span>{" "}
              (charged today)
            </p>
          </div>

          <div>
            <label htmlFor="restaurantName" className="block text-xs font-bold text-gray-400 uppercase tracking-wide mb-1.5">
              Restaurant Name
            </label>
            <input
              id="restaurantName"
              name="restaurantName"
              type="text"
              required
              placeholder="e.g. Mama's Kitchen"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 text-sm focus:outline-none focus:border-orange-500 transition"
            />
          </div>

          <div>
            <label htmlFor="email" className="block text-xs font-bold text-gray-400 uppercase tracking-wide mb-1.5">
              Owner Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              placeholder="you@restaurant.com"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 text-sm focus:outline-none focus:border-orange-500 transition"
            />
          </div>

          <div>
            <label htmlFor="phone" className="block text-xs font-bold text-gray-400 uppercase tracking-wide mb-1.5">
              Phone Number
            </label>
            <input
              id="phone"
              name="phone"
              type="tel"
              required
              placeholder="08012345678"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 text-sm focus:outline-none focus:border-orange-500 transition"
            />
          </div>

          <div>
            <label htmlFor="address" className="block text-xs font-bold text-gray-400 uppercase tracking-wide mb-1.5">
              Restaurant Address
            </label>
            <input
              id="address"
              name="address"
              type="text"
              required
              placeholder="15 Allen Avenue, Lagos"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 text-sm focus:outline-none focus:border-orange-500 transition"
            />
          </div>

          {error && (
            <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white font-black text-base py-4 rounded-xl transition mt-2"
          >
            {loading
              ? "Redirecting to payment…"
              : `Pay ₦${selectedPlan.setupFee.toLocaleString()} Setup Fee →`}
          </button>

          <p className="text-center text-xs text-gray-600">
            Secure payment via Paystack. You&apos;ll be redirected to complete payment.
          </p>
        </form>
      </div>
    </div>
  );
}
