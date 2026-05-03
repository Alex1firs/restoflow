"use client";

import { useState } from "react";

type Restaurant = {
  slug: string;
  name: string;
  email: string;
  phone: string;
  planId: string;
  planName: string;
  status: string;
  endDate: string | null;
  createdAt: string | null;
  ownerUid: string;
};

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-700",
  trialing: "bg-amber-100 text-amber-700",
  expired: "bg-red-100 text-red-700",
  suspended: "bg-gray-200 text-gray-600",
};

const FILTERS = ["all", "active", "trialing", "expired", "suspended"] as const;

export default function RestaurantsClient({ restaurants }: { restaurants: Restaurant[] }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<typeof FILTERS[number]>("all");
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedSlug, setExpandedSlug] = useState<string | null>(null);
  const [extendDays, setExtendDays] = useState(30);

  const filtered = restaurants.filter((r) => {
    const matchSearch =
      !search ||
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      r.slug.toLowerCase().includes(search.toLowerCase()) ||
      r.email.toLowerCase().includes(search.toLowerCase());
    const matchFilter = filter === "all" || r.status === filter;
    return matchSearch && matchFilter;
  });

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

  function fmtDate(iso: string | null) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-black text-gray-900">Restaurants ({restaurants.length})</h1>
        <div className="flex gap-2 flex-wrap">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, slug, email…"
            className="border border-gray-200 rounded-xl px-4 py-2 text-sm outline-none focus:border-orange-500 w-64"
          />
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as typeof FILTERS[number])}
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-orange-500 bg-white"
          >
            {FILTERS.map((f) => (
              <option key={f} value={f}>{f.charAt(0).toUpperCase() + f.slice(1)}</option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 text-sm px-4 py-3 rounded-xl">{error}</div>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              {["Restaurant", "Plan", "Status", "End Date", "Joined", "Actions"].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-widest">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filtered.map((r) => (
              <>
                <tr key={r.slug} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-bold text-gray-900">{r.name}</p>
                    <p className="text-xs text-gray-400">{r.slug}</p>
                    {r.email && <p className="text-xs text-gray-400">{r.email}</p>}
                  </td>
                  <td className="px-4 py-3 text-gray-600 font-medium">{r.planName}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] font-bold uppercase px-2 py-1 rounded-full ${STATUS_COLORS[r.status] ?? "bg-gray-100 text-gray-600"}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{fmtDate(r.endDate)}</td>
                  <td className="px-4 py-3 text-gray-500">{fmtDate(r.createdAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1 flex-wrap">
                      <button
                        onClick={() => setExpandedSlug(expandedSlug === r.slug ? null : r.slug)}
                        className="text-xs font-bold px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                      >
                        {expandedSlug === r.slug ? "Close" : "Manage"}
                      </button>
                      <a
                        href={`/r/${r.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-bold px-2 py-1 bg-orange-50 hover:bg-orange-100 text-orange-600 rounded-lg transition-colors"
                      >
                        View ↗
                      </a>
                      <a
                        href={`/admin/${r.slug}/dashboard`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-bold px-2 py-1 bg-blue-50 hover:bg-blue-100 text-blue-600 rounded-lg transition-colors"
                      >
                        Admin ↗
                      </a>
                    </div>
                  </td>
                </tr>
                {expandedSlug === r.slug && (
                  <tr key={`${r.slug}-expanded`}>
                    <td colSpan={6} className="px-4 py-4 bg-gray-50 border-b border-gray-100">
                      <div className="flex flex-wrap gap-3 items-center">
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            value={extendDays}
                            onChange={(e) => setExtendDays(Number(e.target.value))}
                            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm w-20 outline-none"
                            min={1}
                            max={365}
                          />
                          <button
                            disabled={!!loading}
                            onClick={() => doAction(r.slug, "extend", { days: extendDays })}
                            className="text-xs font-bold px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-500 disabled:opacity-50 transition-colors"
                          >
                            {loading === `${r.slug}-extend` ? "…" : "Extend"}
                          </button>
                        </div>
                        <button
                          disabled={!!loading}
                          onClick={() => doAction(r.slug, "activate")}
                          className="text-xs font-bold px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-500 disabled:opacity-50 transition-colors"
                        >
                          {loading === `${r.slug}-activate` ? "…" : "Set Active"}
                        </button>
                        <button
                          disabled={!!loading}
                          onClick={() => doAction(r.slug, "suspend")}
                          className="text-xs font-bold px-3 py-1.5 bg-gray-700 text-white rounded-lg hover:bg-gray-600 disabled:opacity-50 transition-colors"
                        >
                          {loading === `${r.slug}-suspend` ? "…" : "Suspend"}
                        </button>
                        <button
                          disabled={!!loading}
                          onClick={() => doAction(r.slug, "expire")}
                          className="text-xs font-bold px-3 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-500 disabled:opacity-50 transition-colors"
                        >
                          {loading === `${r.slug}-expire` ? "…" : "Mark Expired"}
                        </button>
                        <select
                          defaultValue={r.planId}
                          onChange={(e) => doAction(r.slug, "changePlan", { planId: e.target.value })}
                          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white outline-none text-xs font-bold"
                        >
                          <option value="" disabled>Change plan…</option>
                          <option value="starter">Starter</option>
                          <option value="growth">Growth</option>
                          <option value="premium">Premium</option>
                        </select>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="py-16 text-center text-gray-400 text-sm font-medium">No restaurants match your filters.</div>
        )}
      </div>
    </div>
  );
}
