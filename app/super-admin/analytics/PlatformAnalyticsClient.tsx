"use client";

import { useEffect, useState, useCallback } from "react";

type Row = {
  slug: string; name: string; subscriptionStatus: string;
  visits: number; addToCart: number; checkoutStarted: number; orderSubmitted: number;
  paymentFailed: number; completedOrders: number; revenue: number;
  abandonedCheckout: number; conversionRate: number; statusLabel: string;
};

type Insights = {
  bestPerforming: Row[]; visitsButNoOrders: Row[]; highAbandonment: Row[];
  paymentFailures: Row[]; strongConversion: Row[]; noActivity: Row[];
  subscribedPoorPerformance: Row[]; expiredWithActivity: Row[];
};

type Data = {
  enabled: boolean; hasData: boolean;
  range?: { key: string; from: string; to: string };
  totals?: {
    funnel: Record<string, number>;
    abandonedCheckout: number;
    conversions: { visitToAddToCart: number; addToCartToCheckout: number; checkoutToOrder: number; orderToPaymentSuccess: number };
    completedOrders: number; revenue: number;
  };
  restaurants?: Row[];
  insights?: Insights;
};

const RANGES = [
  { key: "today", label: "Today" },
  { key: "week", label: "Last 7 days" },
  { key: "month", label: "This month" },
  { key: "custom", label: "Custom" },
];

const n = (v?: number) => (v ?? 0).toLocaleString("en-NG");
const pct = (v?: number) => `${Math.round((v ?? 0) * 100)}%`;
const naira = (v?: number) => `₦${(v ?? 0).toLocaleString("en-NG")}`;

const SUB_COLOR: Record<string, string> = {
  active: "bg-green-100 text-green-700",
  trialing: "bg-amber-100 text-amber-700",
  expired: "bg-red-100 text-red-700",
  suspended: "bg-gray-200 text-gray-600",
};
const LABEL_COLOR: Record<string, string> = {
  "No activity": "bg-gray-100 text-gray-500",
  "Visits, no orders": "bg-red-100 text-red-700",
  "Payment failures": "bg-rose-100 text-rose-700",
  "High abandonment": "bg-amber-100 text-amber-700",
  Strong: "bg-green-100 text-green-700",
  OK: "bg-blue-50 text-blue-600",
};

export default function PlatformAnalyticsClient() {
  const [range, setRange] = useState("week");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ range });
      if (range === "custom") {
        if (!from || !to) { setLoading(false); return; }
        qs.set("from", from); qs.set("to", to);
      }
      const res = await fetch(`/api/super-admin/analytics?${qs.toString()}`);
      if (!res.ok) throw new Error("failed");
      setData(await res.json());
    } catch {
      setError("Could not load analytics. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [range, from, to]);

  useEffect(() => { if (range !== "custom") load(); }, [range, load]);

  const t = data?.totals;
  const f = t?.funnel ?? {};
  const showEmpty = data && (!data.enabled || !data.hasData);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-black text-gray-900">Storefront Analytics</h1>
        <p className="text-gray-500 font-medium mt-1">Platform-wide customer behaviour across all restaurants.</p>
      </div>

      {/* Range selector */}
      <div className="flex flex-wrap items-center gap-2">
        {RANGES.map((r) => (
          <button
            key={r.key}
            onClick={() => setRange(r.key)}
            className={`px-4 py-2 rounded-xl text-sm font-bold transition ${
              range === r.key ? "bg-orange-600 text-white" : "bg-white text-gray-600 border border-gray-200 hover:border-gray-300"
            }`}
          >
            {r.label}
          </button>
        ))}
        {range === "custom" && (
          <div className="flex items-center gap-2">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="px-3 py-2 rounded-xl border border-gray-200 text-sm" />
            <span className="text-gray-400">–</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="px-3 py-2 rounded-xl border border-gray-200 text-sm" />
            <button onClick={load} className="px-4 py-2 rounded-xl bg-gray-900 text-white text-sm font-bold">Apply</button>
          </div>
        )}
      </div>

      {loading && <div className="text-gray-400 font-medium py-20 text-center">Loading…</div>}
      {error && !loading && <div className="text-red-500 font-medium py-20 text-center">{error}</div>}

      {!loading && !error && showEmpty && (
        <div className="bg-white border border-gray-100 rounded-2xl p-12 text-center">
          <div className="text-4xl mb-4">📊</div>
          <h2 className="text-lg font-black text-gray-900 mb-2">No analytics yet</h2>
          <p className="text-gray-500 font-medium max-w-md mx-auto">
            Platform analytics will appear here once customers start visiting restaurant storefronts.
          </p>
        </div>
      )}

      {!loading && !error && data && data.enabled && data.hasData && t && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card label="Total Visits" value={n(f.visits)} color="text-blue-600" />
            <Card label="Added to Cart" value={n(f.add_to_cart)} color="text-amber-600" />
            <Card label="Checkouts Started" value={n(f.checkout_started)} color="text-purple-600" />
            <Card label="Orders Submitted" value={n(f.order_submitted)} color="text-orange-600" />
            <Card label="Completed Orders" value={n(t.completedOrders)} color="text-green-600" hint="from orders" />
            <Card label="Revenue" value={naira(t.revenue)} color="text-green-700" hint="from orders" />
            <Card label="Abandoned Checkouts" value={n(t.abandonedCheckout)} color="text-red-500" />
            <Card label="Payments Failed" value={n(f.payment_failed)} color="text-rose-600" />
          </div>

          {/* Platform funnel */}
          <Panel title="Platform Funnel">
            <div className="space-y-2">
              <FunnelRow label="Storefront visits" value={f.visits} max={f.visits} />
              <FunnelRow label="Added to cart" value={f.add_to_cart} max={f.visits} rate={t.conversions.visitToAddToCart} rateLabel="of visits" />
              <FunnelRow label="Checkout started" value={f.checkout_started} max={f.visits} rate={t.conversions.addToCartToCheckout} rateLabel="of add-to-carts" />
              <FunnelRow label="Order submitted" value={f.order_submitted} max={f.visits} rate={t.conversions.checkoutToOrder} rateLabel="of checkouts" />
              <FunnelRow label="Payment successful" value={f.payment_successful} max={f.visits} rate={t.conversions.orderToPaymentSuccess} rateLabel="of orders (online)" />
            </div>
          </Panel>

          {/* Attention cards */}
          {data.insights && (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              <IssueCard title="Best performing" tone="good" rows={data.insights.bestPerforming} render={(r) => `${naira(r.revenue)} · ${n(r.completedOrders)} orders`} />
              <IssueCard title="Strong conversion" tone="good" rows={data.insights.strongConversion} render={(r) => `${pct(r.conversionRate)} conversion`} />
              <IssueCard title="Visits but no orders" tone="warn" rows={data.insights.visitsButNoOrders} render={(r) => `${n(r.visits)} visits · 0 orders`} />
              <IssueCard title="High checkout abandonment" tone="warn" rows={data.insights.highAbandonment} render={(r) => `${n(r.abandonedCheckout)} abandoned`} />
              <IssueCard title="Payment failures" tone="warn" rows={data.insights.paymentFailures} render={(r) => `${n(r.paymentFailed)} failed`} />
              <IssueCard title="Subscribed but not converting" tone="warn" rows={data.insights.subscribedPoorPerformance} render={(r) => `${n(r.visits)} visits · 0 orders`} />
              <IssueCard title="Expired/suspended with activity" tone="warn" rows={data.insights.expiredWithActivity} render={(r) => `${n(r.visits)} visits · ${r.subscriptionStatus}`} />
              <IssueCard title="No storefront activity" tone="muted" rows={data.insights.noActivity} render={() => "—"} />
            </div>
          )}

          {/* Per-restaurant table */}
          <Panel title="Per-Restaurant Performance">
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-sm min-w-[860px]">
                <thead>
                  <tr className="text-left text-[11px] font-black text-gray-400 uppercase tracking-tight border-b border-gray-100">
                    <th className="py-2 pr-3">Restaurant</th>
                    <th className="py-2 px-2">Subscription</th>
                    <th className="py-2 px-2 text-right">Visits</th>
                    <th className="py-2 px-2 text-right">Add-to-cart</th>
                    <th className="py-2 px-2 text-right">Checkout</th>
                    <th className="py-2 px-2 text-right">Submitted</th>
                    <th className="py-2 px-2 text-right">Completed</th>
                    <th className="py-2 px-2 text-right">Revenue</th>
                    <th className="py-2 px-2 text-right">Abandoned</th>
                    <th className="py-2 px-2 text-right">Conv.</th>
                    <th className="py-2 pl-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.restaurants ?? []).map((r) => (
                    <tr key={r.slug} className="border-b border-gray-50 last:border-0">
                      <td className="py-2.5 pr-3">
                        <div className="font-bold text-gray-800">{r.name}</div>
                        <div className="text-[11px] text-gray-400 font-mono">{r.slug}</div>
                      </td>
                      <td className="py-2.5 px-2">
                        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-lg ${SUB_COLOR[r.subscriptionStatus] ?? "bg-gray-100 text-gray-500"}`}>{r.subscriptionStatus}</span>
                      </td>
                      <td className="py-2.5 px-2 text-right font-bold text-gray-800">{n(r.visits)}</td>
                      <td className="py-2.5 px-2 text-right text-gray-600">{n(r.addToCart)}</td>
                      <td className="py-2.5 px-2 text-right text-gray-600">{n(r.checkoutStarted)}</td>
                      <td className="py-2.5 px-2 text-right text-gray-600">{n(r.orderSubmitted)}</td>
                      <td className="py-2.5 px-2 text-right font-bold text-green-700">{n(r.completedOrders)}</td>
                      <td className="py-2.5 px-2 text-right font-bold text-gray-800">{naira(r.revenue)}</td>
                      <td className="py-2.5 px-2 text-right text-red-500">{n(r.abandonedCheckout)}</td>
                      <td className="py-2.5 px-2 text-right font-bold text-gray-800">{pct(r.conversionRate)}</td>
                      <td className="py-2.5 pl-2">
                        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-lg ${LABEL_COLOR[r.statusLabel] ?? "bg-gray-100 text-gray-500"}`}>{r.statusLabel}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}

function Card({ label, value, color, hint }: { label: string; value: string; color: string; hint?: string }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5">
      <p className="text-[11px] font-black text-gray-400 uppercase tracking-widest mb-1">{label}</p>
      <p className={`text-2xl font-black ${color}`}>{value}</p>
      {hint && <p className="text-[10px] text-gray-400 font-medium mt-0.5">{hint}</p>}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5">
      <h2 className="text-sm font-black text-gray-900 uppercase tracking-tight mb-4">{title}</h2>
      {children}
    </div>
  );
}

function FunnelRow({ label, value, max, rate, rateLabel }: { label: string; value?: number; max?: number; rate?: number; rateLabel?: string }) {
  const width = max && max > 0 ? Math.max(3, Math.round(((value ?? 0) / max) * 100)) : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-1">
        <span className="font-bold text-gray-700">{label}</span>
        <span className="font-black text-gray-900">
          {n(value)}
          {rate !== undefined && <span className="text-gray-400 font-medium text-xs ml-2">{pct(rate)} {rateLabel}</span>}
        </span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full bg-orange-500 rounded-full" style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function IssueCard({ title, tone, rows, render }: { title: string; tone: "good" | "warn" | "muted"; rows: Row[]; render: (r: Row) => string }) {
  const toneClass = tone === "good" ? "border-green-200" : tone === "warn" ? "border-amber-200" : "border-gray-200";
  return (
    <div className={`bg-white rounded-2xl border ${toneClass} p-4`}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-black text-gray-900 uppercase tracking-tight">{title}</p>
        <span className="text-xs font-black text-gray-400">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-400 font-medium">None</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.slice(0, 5).map((r) => (
            <li key={r.slug} className="flex items-center justify-between text-sm">
              <span className="font-bold text-gray-700 truncate mr-2">{r.name}</span>
              <span className="text-gray-500 font-medium whitespace-nowrap text-xs">{render(r)}</span>
            </li>
          ))}
          {rows.length > 5 && <li className="text-xs text-gray-400 font-medium">+{rows.length - 5} more</li>}
        </ul>
      )}
    </div>
  );
}
