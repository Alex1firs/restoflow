"use client";

import { useState } from "react";
import { PLANS } from "@/lib/plans";
import { CheckCircle2 } from "lucide-react";

const PLAN = PLANS[0];

export default function GetStartedClient() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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
      planId: PLAN.id,
    };

    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      const json = await res.json().catch(() => ({ error: `Server error (${res.status})` }));

      if (!res.ok) {
        setError(json.error ?? "Something went wrong. Please try again.");
        setLoading(false);
        return;
      }

      // Free trial — direct activation (no payment required)
      if (json.directActivation) {
        const params = new URLSearchParams({
          direct: "1",
          slug: json.slug,
          email: json.email,
          resetLink: json.resetLink,
        });
        window.location.href = `/get-started/callback?${params.toString()}`;
        return;
      }

      // Paid flow — redirect to Paystack
      if (json.authorizationUrl) {
        window.location.href = json.authorizationUrl;
        return;
      }

      setError("Unexpected response. Please try again.");
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-black text-white flex items-start justify-center px-4 pt-28 pb-16">
      <div className="w-full max-w-lg">
        <div className="mb-8">
          <h1 className="text-4xl font-black italic uppercase tracking-tighter mb-2">
            Start your <span className="text-orange-500">free trial</span>
          </h1>
          <p className="text-gray-400 text-sm">
            7 days free. No credit card required. Set up in minutes.
          </p>
        </div>

        {/* Plan summary */}
        <div className="bg-orange-500/10 border border-orange-500/30 rounded-2xl p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="font-black text-white text-base">{PLAN.name}</p>
              <p className="text-orange-400 text-sm font-bold">
                ₦{PLAN.monthlyPrice.toLocaleString()}/month after trial
              </p>
            </div>
            <span className="bg-orange-500 text-white text-[10px] font-black uppercase px-2 py-1 rounded-full">
              7 days free
            </span>
          </div>
          <ul className="grid grid-cols-2 gap-1.5">
            {PLAN.features.map((f) => (
              <li key={f} className="flex items-center gap-1.5 text-xs text-gray-300">
                <CheckCircle2 size={12} className="text-orange-500 shrink-0" />
                {f}
              </li>
            ))}
          </ul>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
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
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 !text-white placeholder-gray-600 text-sm focus:outline-none focus:border-orange-500 transition"
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
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 !text-white placeholder-gray-600 text-sm focus:outline-none focus:border-orange-500 transition"
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
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 !text-white placeholder-gray-600 text-sm focus:outline-none focus:border-orange-500 transition"
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
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 !text-white placeholder-gray-600 text-sm focus:outline-none focus:border-orange-500 transition"
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
            {loading ? "Setting up your account…" : "Start Free Trial →"}
          </button>

          <p className="text-center text-xs text-gray-600">
            No credit card required. Cancel anytime.
          </p>
        </form>
      </div>
    </div>
  );
}
