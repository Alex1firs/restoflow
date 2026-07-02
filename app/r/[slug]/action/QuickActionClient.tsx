"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";

export default function QuickActionClient({ slug, name }: { slug: string; name: string }) {
  const searchParams = useSearchParams();
  const orderId = searchParams.get("orderId");
  
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState<"accept" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  if (!isClient) return null;

  if (!orderId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50 px-4">
        <div className="text-center p-6 bg-white border border-stone-200 rounded-2xl shadow-sm max-w-sm w-full">
          <p className="text-rose-500 font-medium">Invalid or missing Order ID.</p>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50 px-4">
        <div className="text-center p-8 bg-white border border-stone-200 rounded-2xl shadow-sm max-w-sm w-full">
          <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-stone-800 mb-2">{success}</h2>
          <p className="text-stone-500 text-sm">You can close this window now.</p>
        </div>
      </div>
    );
  }

  const handleAction = async (action: "accept" | "reject") => {
    if (pin.length !== 4) {
      setError("Please enter a 4-digit PIN.");
      return;
    }
    setError(null);
    setLoading(action);

    try {
      const res = await fetch(`/api/orders/${orderId}/quick-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionType: action, pin, slug }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Action failed");
      
      setSuccess(action === "accept" ? "Order Accepted & Paid!" : "Order Rejected.");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-stone-50 px-4 py-12">
      <div className="w-full max-w-sm bg-white rounded-3xl shadow-xl border border-stone-100 p-8 space-y-8">
        <div className="text-center">
          <h1 className="text-2xl font-black text-stone-900 tracking-tight">{name}</h1>
          <p className="text-sm font-medium text-stone-500 mt-1 uppercase tracking-widest">Order Action</p>
          <div className="mt-4 py-2 px-4 bg-stone-100 rounded-xl inline-block">
            <p className="text-xs text-stone-400 font-bold uppercase tracking-wider mb-1">Order ID</p>
            <p className="font-mono text-sm text-stone-800 font-semibold">{orderId}</p>
          </div>
        </div>

        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 text-rose-600 rounded-xl text-sm font-medium text-center">
            {error}
          </div>
        )}

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-bold text-stone-500 uppercase tracking-widest pl-1">Admin PIN</label>
            <input
              type="tel"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
              className="w-full text-center text-3xl tracking-[1em] font-mono py-4 border-2 border-stone-200 focus:border-stone-800 rounded-2xl outline-none transition-colors"
              placeholder="••••"
              maxLength={4}
            />
          </div>

          <div className="grid grid-cols-2 gap-3 pt-4">
            <button
              onClick={() => handleAction("reject")}
              disabled={!!loading || pin.length !== 4}
              className="w-full py-4 bg-rose-50 hover:bg-rose-100 text-rose-600 font-bold rounded-2xl transition-colors disabled:opacity-50"
            >
              {loading === "reject" ? "..." : "Reject"}
            </button>
            <button
              onClick={() => handleAction("accept")}
              disabled={!!loading || pin.length !== 4}
              className="w-full py-4 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-2xl transition-colors disabled:opacity-50 shadow-md shadow-emerald-500/20"
            >
              {loading === "accept" ? "..." : "Accept"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
