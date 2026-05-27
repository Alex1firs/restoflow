"use client";

import { useState } from "react";

type Sub = {
  slug: string;
  name: string;
  planId: string;
  planName: string;
  monthlyPrice: number;
  status: string;
  startDate: string | null;
  endDate: string | null;
  daysRemaining: number | null;
};

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-700",
  trialing: "bg-amber-100 text-amber-700",
  expired: "bg-red-100 text-red-700",
  suspended: "bg-gray-200 text-gray-600",
};

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
}

export default function SubscriptionsClient({ subscriptions }: { subscriptions: Sub[] }) {
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [extendDays, setExtendDays] = useState<Record<string, number>>({});

  async function doAction(slug: string, action: string, extra?: Record<string, unknown>) {
    setLoading(`${slug}-${action}`);
    setError(null);
    try {
      const res = await fetch(`/api/super-admin/restaurants/${slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error ?? "Action failed");
      } else {
        window.location.reload();
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-black text-gray-900">Subscriptions ({subscriptions.length})</h1>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 text-sm px-4 py-3 rounded-xl">{error}</div>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                {["Restaurant", "Plan", "Status", "Start", "End", "Days Left", "Actions"].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-widest">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {subscriptions.map((s) => (
                <tr key={s.slug} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <p className="font-bold text-gray-900">{s.name}</p>
                    <p className="text-xs text-gray-400">{s.slug}</p>
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-700">{s.planName}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-bold uppercase px-2 py-1 rounded-full ${STATUS_COLORS[s.status] ?? "bg-gray-100 text-gray-600"}`}>
                      {s.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{fmtDate(s.startDate)}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{fmtDate(s.endDate)}</td>
                  <td className="px-4 py-3">
                    {s.daysRemaining !== null ? (
                      <span className={`font-bold text-sm ${s.daysRemaining <= 7 ? "text-red-600" : s.daysRemaining <= 30 ? "text-amber-600" : "text-green-600"}`}>
                        {s.daysRemaining}d
                      </span>
                    ) : (
                      <span className="text-gray-400 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <input
                        type="number"
                        value={extendDays[s.slug] ?? 30}
                        onChange={(e) => setExtendDays({ ...extendDays, [s.slug]: Number(e.target.value) })}
                        className="border border-gray-200 rounded-lg px-2 py-1 text-xs w-16 outline-none"
                        min={1}
                      />
                      <button
                        disabled={!!loading}
                        onClick={() => doAction(s.slug, "extend", { days: extendDays[s.slug] ?? 30 })}
                        className="text-xs font-bold px-2 py-1 bg-green-600 text-white rounded-lg hover:bg-green-500 disabled:opacity-50"
                      >
                        {loading === `${s.slug}-extend` ? "…" : "Extend"}
                      </button>
                      <button
                        disabled={!!loading}
                        onClick={() => doAction(s.slug, "activate")}
                        className="text-xs font-bold px-2 py-1 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 disabled:opacity-50"
                      >
                        Activate
                      </button>
                      <button
                        disabled={!!loading}
                        onClick={() => doAction(s.slug, "expire")}
                        className="text-xs font-bold px-2 py-1 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 disabled:opacity-50"
                      >
                        Expire
                      </button>
                      <button
                        disabled={!!loading}
                        onClick={() => doAction(s.slug, "suspend")}
                        className="text-xs font-bold px-2 py-1 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-50"
                      >
                        Suspend
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Mobile cards */}
        <div className="md:hidden divide-y divide-gray-100">
          {subscriptions.map((s) => (
            <div key={s.slug} className="p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-gray-900">{s.name}</p>
                  <p className="text-xs text-gray-400">{s.slug}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {s.daysRemaining !== null && (
                    <span className={`font-bold text-sm ${s.daysRemaining <= 7 ? "text-red-600" : s.daysRemaining <= 30 ? "text-amber-600" : "text-green-600"}`}>
                      {s.daysRemaining}d
                    </span>
                  )}
                  <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded-full ${STATUS_COLORS[s.status] ?? "bg-gray-100 text-gray-600"}`}>
                    {s.status}
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                <span>Plan: <span className="font-medium text-gray-700">{s.planName}</span></span>
                <span>Start: <span className="font-medium text-gray-700">{fmtDate(s.startDate)}</span></span>
                <span>End: <span className="font-medium text-gray-700">{fmtDate(s.endDate)}</span></span>
              </div>
              <div className="flex flex-wrap gap-2 items-center">
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={extendDays[s.slug] ?? 30}
                    onChange={(e) => setExtendDays({ ...extendDays, [s.slug]: Number(e.target.value) })}
                    className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs w-16 outline-none"
                    min={1}
                  />
                  <button
                    disabled={!!loading}
                    onClick={() => doAction(s.slug, "extend", { days: extendDays[s.slug] ?? 30 })}
                    className="text-xs font-bold px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-500 disabled:opacity-50"
                  >
                    {loading === `${s.slug}-extend` ? "…" : "Extend"}
                  </button>
                </div>
                <button
                  disabled={!!loading}
                  onClick={() => doAction(s.slug, "activate")}
                  className="text-xs font-bold px-3 py-1.5 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 disabled:opacity-50"
                >
                  Activate
                </button>
                <button
                  disabled={!!loading}
                  onClick={() => doAction(s.slug, "expire")}
                  className="text-xs font-bold px-3 py-1.5 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 disabled:opacity-50"
                >
                  Expire
                </button>
                <button
                  disabled={!!loading}
                  onClick={() => doAction(s.slug, "suspend")}
                  className="text-xs font-bold px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-50"
                >
                  Suspend
                </button>
              </div>
            </div>
          ))}
        </div>
        {subscriptions.length === 0 && (
          <div className="py-16 text-center text-gray-400 text-sm">No subscriptions.</div>
        )}
      </div>
    </div>
  );
}
