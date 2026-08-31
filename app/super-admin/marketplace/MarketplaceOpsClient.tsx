"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, RefreshCw, ExternalLink } from "lucide-react";

/**
 * The operations board.
 *
 * Deliberately small: a list, a detail drawer, and a combined timeline. The
 * point of this screen is that support can answer "where is this order?"
 * without opening Dispatcher — not that it replaces Dispatcher's own logistics
 * administration, which stays where it is.
 *
 * Every action goes through an API. Nothing here writes to a database directly,
 * and nothing here writes to Dispatcher at all.
 */

type Row = {
  orderId: string; orderCode: string; restaurantId: string; customerFirstName: string;
  totalChargedMinor: number; restaurantPayableMinor: number; platformGrossMinor: number;
  paymentState: string; restaurantState: string; deliveryState: string | null;
  deliveryJobId: string | null; courierFirstName: string | null; etaToDropoffMins: number | null;
  issue: string | null; needsAttention: boolean; settlementState: string;
  createdAtMs: number; ageMins: number; actions: string[];
};

type TimelineEntry = { at: number; lane: string; label: string; detail: string | null };

const naira = (minor: number) => `₦${(minor / 100).toLocaleString("en-NG")}`;

const LANE_COLOUR: Record<string, string> = {
  payment: "bg-emerald-100 text-emerald-700",
  restaurant: "bg-orange-100 text-orange-700",
  preparation: "bg-amber-100 text-amber-700",
  dispatcher: "bg-slate-100 text-slate-600",
  delivery: "bg-sky-100 text-sky-700",
};

export default function MarketplaceOpsClient({
  restaurants,
}: { restaurants: { slug: string; name: string }[] }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [counts, setCounts] = useState({ total: 0, attention: 0, live: 0 });
  const [restaurantId, setRestaurantId] = useState("");
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ timeline: TimelineEntry[]; financials: Record<string, number> | null } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const qs = new URLSearchParams();
    if (restaurantId) qs.set("restaurantId", restaurantId);
    if (attentionOnly) qs.set("attention", "1");
    try {
      const res = await fetch(`/api/super-admin/marketplace/orders?${qs}`);
      if (res.ok) {
        const body = await res.json();
        setRows(body.rows ?? []);
        setCounts(body.counts ?? { total: 0, attention: 0, live: 0 });
      }
    } finally {
      setLoading(false);
    }
  }, [restaurantId, attentionOnly]);

  useEffect(() => { void load(); }, [load]);

  // A live board that needs a manual refresh is a board nobody trusts.
  useEffect(() => {
    const t = setInterval(() => { void load(); }, 20_000);
    return () => clearInterval(t);
  }, [load]);

  const openDetail = async (orderId: string) => {
    setSelected(orderId);
    setDetail(null);
    const res = await fetch(`/api/super-admin/marketplace/orders/${orderId}`);
    if (res.ok) {
      const b = await res.json();
      setDetail({ timeline: b.timeline ?? [], financials: b.financials ?? null });
    }
  };

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Online Orders</h1>
          <p className="text-sm text-gray-500">Marketplace operations across every restaurant.</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={restaurantId}
            onChange={(e) => setRestaurantId(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">All restaurants</option>
            {restaurants.map((r) => <option key={r.slug} value={r.slug}>{r.name}</option>)}
          </select>
          <button
            onClick={() => setAttentionOnly((v) => !v)}
            className={`px-3 py-2 rounded-lg text-sm border ${
              attentionOnly ? "bg-red-50 border-red-200 text-red-700" : "border-gray-200 text-gray-600"
            }`}
          >
            Needs attention {counts.attention > 0 && `(${counts.attention})`}
          </button>
          <button onClick={() => void load()} className="p-2 rounded-lg border border-gray-200 text-gray-600" aria-label="Refresh">
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-5">
        {[
          ["Orders", counts.total, "text-gray-900"],
          ["In flight", counts.live, "text-sky-700"],
          ["Needs attention", counts.attention, counts.attention > 0 ? "text-red-600" : "text-gray-400"],
        ].map(([label, value, colour]) => (
          <div key={String(label)} className="border border-gray-200 rounded-xl p-4 bg-white">
            <p className="text-xs uppercase tracking-wide text-gray-400">{label}</p>
            <p className={`text-2xl font-semibold ${colour}`}>{value}</p>
          </div>
        ))}
      </div>

      <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
              <tr>
                {["Order", "Restaurant", "Customer", "Charged", "Payment", "Kitchen", "Delivery", "Courier", "Age", ""]
                  .map((h) => <th key={h} className="text-left font-medium px-3 py-2.5 whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !loading && (
                <tr><td colSpan={10} className="px-3 py-10 text-center text-gray-400">No marketplace orders yet.</td></tr>
              )}
              {rows.map((r) => (
                <tr
                  key={r.orderId}
                  onClick={() => void openDetail(r.orderId)}
                  className={`border-t border-gray-100 cursor-pointer hover:bg-gray-50 ${r.needsAttention ? "bg-red-50/40" : ""}`}
                >
                  <td className="px-3 py-2.5 font-medium text-gray-900 whitespace-nowrap">
                    {r.needsAttention && <AlertTriangle size={13} className="inline mr-1.5 text-red-500" />}
                    {r.orderCode}
                  </td>
                  <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{r.restaurantId}</td>
                  <td className="px-3 py-2.5 text-gray-600">{r.customerFirstName}</td>
                  <td className="px-3 py-2.5 tabular-nums whitespace-nowrap">{naira(r.totalChargedMinor)}</td>
                  <td className="px-3 py-2.5"><Pill value={r.paymentState} /></td>
                  <td className="px-3 py-2.5"><Pill value={r.restaurantState} /></td>
                  <td className="px-3 py-2.5"><Pill value={r.deliveryState ?? "—"} /></td>
                  <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">
                    {r.courierFirstName ?? "—"}
                    {r.etaToDropoffMins != null && <span className="text-gray-400"> · {r.etaToDropoffMins}m</span>}
                  </td>
                  <td className="px-3 py-2.5 text-gray-500 tabular-nums">{r.ageMins}m</td>
                  <td className="px-3 py-2.5 text-gray-300">›</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <div className="fixed inset-0 bg-black/30 flex justify-end z-50" onClick={() => setSelected(null)}>
          <div className="bg-white w-full max-w-xl h-full overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <h2 className="text-lg font-semibold">{rows.find((r) => r.orderId === selected)?.orderCode}</h2>
              <button onClick={() => setSelected(null)} className="text-gray-400 text-sm">Close</button>
            </div>

            {!detail && <p className="text-sm text-gray-400">Loading…</p>}

            {detail?.financials && (
              <div className="border border-gray-200 rounded-lg p-4 mb-5">
                <p className="text-xs uppercase tracking-wide text-gray-400 mb-2">Money</p>
                <dl className="grid grid-cols-2 gap-y-1.5 text-sm">
                  {[
                    ["Customer paid", detail.financials.customerPaidMinor],
                    ["Restaurant owed", detail.financials.restaurantOwedMinor],
                    ["Delivery owed", detail.financials.deliveryOwedMinor],
                    ["Processor", detail.financials.processorCostMinor],
                    ["Platform gross", detail.financials.platformGrossMinor],
                    ["Refunded", detail.financials.refundedMinor],
                    ["Settlement outstanding", detail.financials.settlementOutstandingMinor],
                  ].map(([label, v]) => (
                    <div key={String(label)} className="contents">
                      <dt className="text-gray-500">{label}</dt>
                      <dd className="text-right tabular-nums text-gray-900">{naira(Number(v))}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}

            {detail && (
              <>
                <p className="text-xs uppercase tracking-wide text-gray-400 mb-2">Timeline</p>
                <ol className="space-y-2.5">
                  {detail.timeline.map((t, i) => (
                    <li key={i} className="flex gap-3 text-sm">
                      <span className={`shrink-0 h-fit px-2 py-0.5 rounded text-[10px] uppercase tracking-wide font-medium ${LANE_COLOUR[t.lane] ?? "bg-gray-100 text-gray-600"}`}>
                        {t.lane}
                      </span>
                      <div className="min-w-0">
                        <p className="text-gray-900">{t.label}</p>
                        {t.detail && <p className="text-gray-500 text-xs">{t.detail}</p>}
                        <p className="text-gray-400 text-xs tabular-nums">
                          {t.at ? new Date(t.at).toLocaleString("en-NG") : ""}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>

                {rows.find((r) => r.orderId === selected)?.deliveryJobId && (
                  <p className="mt-6 text-xs text-gray-400 flex items-center gap-1.5">
                    <ExternalLink size={12} />
                    Logistics administration stays in Dispatcher — job{" "}
                    <code>{rows.find((r) => r.orderId === selected)?.deliveryJobId}</code>
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Pill({ value }: { value: string }) {
  const v = value.toLowerCase();
  const tone =
    v.includes("fail") || v.includes("reject") || v.includes("cancel") ? "bg-red-100 text-red-700" :
    v === "delivered" || v === "paid" || v === "ready" ? "bg-emerald-100 text-emerald-700" :
    v === "—" ? "bg-gray-100 text-gray-400" :
    "bg-sky-100 text-sky-700";
  return <span className={`px-2 py-0.5 rounded text-[11px] font-medium whitespace-nowrap ${tone}`}>{value}</span>;
}
