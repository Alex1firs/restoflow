"use client";

import { useState } from "react";

type OnboardingRequest = {
  id: string;
  restaurantName: string;
  slug: string;
  email: string;
  phone: string;
  planId: string;
  status: string;
  paystackReference: string | null;
  ownerUid: string | null;
  resetLink: string | null;
  createdAt: string;
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  complete: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
};

export default function OnboardingClient({ onboardings }: { onboardings: OnboardingRequest[] }) {
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "pending" | "complete" | "rejected">("all");

  const filtered = filter === "all" ? onboardings : onboardings.filter((o) => o.status === filter);

  async function doAction(id: string, action: string) {
    setLoading(`${id}-${action}`);
    setError(null);
    try {
      const res = await fetch(`/api/super-admin/onboarding/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error ?? "Action failed");
      } else {
        setSuccess(`Done: ${action}`);
        setTimeout(() => { setSuccess(null); window.location.reload(); }, 1000);
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-2xl font-black text-gray-900">Onboarding Requests ({onboardings.length})</h1>
        <div className="flex gap-2">
          {(["all", "pending", "complete", "rejected"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-xs font-bold px-3 py-1.5 rounded-full transition-all ${filter === f ? "bg-orange-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-600 text-sm px-4 py-3 rounded-xl">{error}</div>}
      {success && <div className="bg-green-50 border border-green-200 text-green-700 text-sm px-4 py-3 rounded-xl">{success}</div>}

      <div className="space-y-4">
        {filtered.map((o) => (
          <div key={o.id} className="bg-white rounded-2xl border border-gray-100 p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-black text-gray-900">{o.restaurantName}</h3>
                  <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${STATUS_COLORS[o.status] ?? "bg-gray-100 text-gray-600"}`}>
                    {o.status}
                  </span>
                </div>
                <p className="text-sm text-gray-500">/{o.slug} · {o.email} · {o.phone}</p>
                <p className="text-xs text-gray-400 mt-1">Plan: {o.planId} · Submitted: {o.createdAt}</p>
                {o.paystackReference && (
                  <p className="text-xs text-gray-400 font-mono mt-0.5">Ref: {o.paystackReference}</p>
                )}
                {o.ownerUid && (
                  <p className="text-xs text-gray-400 mt-0.5">UID: {o.ownerUid}</p>
                )}
                {o.resetLink && (
                  <a href={o.resetLink} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline mt-0.5 block">
                    Password reset link ↗
                  </a>
                )}
              </div>
              <div className="flex gap-2 flex-wrap">
                {o.status === "pending" && (
                  <>
                    <button
                      disabled={!!loading}
                      onClick={() => doAction(o.id, "approve")}
                      className="text-xs font-bold px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-500 disabled:opacity-50"
                    >
                      {loading === `${o.id}-approve` ? "…" : "Approve"}
                    </button>
                    <button
                      disabled={!!loading}
                      onClick={() => doAction(o.id, "reject")}
                      className="text-xs font-bold px-3 py-1.5 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 disabled:opacity-50"
                    >
                      {loading === `${o.id}-reject` ? "…" : "Reject"}
                    </button>
                  </>
                )}
                {o.status !== "pending" && (
                  <button
                    disabled={!!loading}
                    onClick={() => doAction(o.id, "reset")}
                    className="text-xs font-bold px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-50"
                  >
                    Reset to Pending
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 py-16 text-center text-gray-400 text-sm">
            No {filter === "all" ? "" : filter} onboarding requests.
          </div>
        )}
      </div>
    </div>
  );
}
