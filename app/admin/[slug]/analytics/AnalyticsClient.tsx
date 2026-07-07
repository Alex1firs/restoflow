"use client";

import { useEffect, useState, useCallback } from "react";

type RankedItem = { id: string; name: string; count: number };
type Recommendation = { id: string; severity: "info" | "warn"; title: string; detail: string };

type AnalyticsData = {
  enabled: boolean;
  hasData: boolean;
  range?: { key: string; from: string; to: string };
  funnel?: Record<string, number>;
  abandonedCheckout?: number;
  conversions?: {
    visitToAddToCart: number;
    addToCartToCheckout: number;
    checkoutToOrder: number;
    orderToPaymentSuccess: number;
  };
  fulfillmentBreakdown?: Record<string, number>;
  paymentMethodBreakdown?: Record<string, number>;
  topViewed?: RankedItem[];
  topAdded?: RankedItem[];
  orders?: { completedOrders: number; revenue: number };
  recommendations?: Recommendation[];
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

const FULFILLMENT_LABEL: Record<string, string> = { delivery: "Delivery", pickup: "Pickup", dine_in: "Dine-in" };
const METHOD_LABEL: Record<string, string> = { online: "Pay Online", cash: "Cash", whatsapp: "WhatsApp" };

export default function AnalyticsClient() {
  const [range, setRange] = useState("week");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ range });
      if (range === "custom") {
        if (!from || !to) { setLoading(false); return; }
        qs.set("from", from);
        qs.set("to", to);
      }
      const res = await fetch(`/api/admin/analytics?${qs.toString()}`);
      if (!res.ok) throw new Error("Failed to load analytics");
      setData(await res.json());
    } catch {
      setError("Could not load analytics. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [range, from, to]);

  useEffect(() => { if (range !== "custom") load(); }, [range, load]);

  const f = data?.funnel ?? {};
  const showEmpty = data && (!data.enabled || !data.hasData);

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-black text-gray-900">Storefront Analytics</h1>
        <p className="text-gray-500 font-medium mt-1">How customers behave on your online storefront.</p>
      </div>

      {/* Range selector */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
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
        <div className="bg-white border border-gray-200 rounded-2xl p-12 text-center">
          <div className="text-4xl mb-4">📊</div>
          <h2 className="text-lg font-black text-gray-900 mb-2">No analytics yet</h2>
          <p className="text-gray-500 font-medium max-w-md mx-auto">
            Analytics will appear here once customers start visiting your storefront.
          </p>
        </div>
      )}

      {!loading && !error && data && data.enabled && data.hasData && (
        <div className="space-y-8">
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Storefront Visits" value={n(f.visits)} accent="text-blue-600" />
            <StatCard label="Added to Cart" value={n(f.add_to_cart)} accent="text-amber-600" />
            <StatCard label="Checkouts Started" value={n(f.checkout_started)} accent="text-purple-600" />
            <StatCard label="Orders Submitted" value={n(f.order_submitted)} accent="text-orange-600" />
            <StatCard label="Completed Orders" value={n(data.orders?.completedOrders)} accent="text-green-600" hint="from orders" />
            <StatCard label="Revenue" value={naira(data.orders?.revenue)} accent="text-green-700" hint="from orders" />
            <StatCard label="Abandoned Checkouts" value={n(data.abandonedCheckout)} accent="text-red-500" />
            <StatCard label="Payments Failed" value={n(f.payment_failed)} accent="text-rose-600" />
          </div>

          {/* Funnel */}
          <Section title="Conversion Funnel">
            <div className="space-y-2">
              <FunnelRow label="Storefront visits" value={f.visits} max={f.visits} />
              <FunnelRow label="Added to cart" value={f.add_to_cart} max={f.visits} rate={data.conversions?.visitToAddToCart} rateLabel="of visits" />
              <FunnelRow label="Checkout started" value={f.checkout_started} max={f.visits} rate={data.conversions?.addToCartToCheckout} rateLabel="of add-to-carts" />
              <FunnelRow label="Order submitted" value={f.order_submitted} max={f.visits} rate={data.conversions?.checkoutToOrder} rateLabel="of checkouts" />
              <FunnelRow label="Payment successful" value={f.payment_successful} max={f.visits} rate={data.conversions?.orderToPaymentSuccess} rateLabel="of orders (online)" />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
              <MiniStat label="Cart opened" value={n(f.cart_opened)} />
              <MiniStat label="Removed from cart" value={n(f.remove_from_cart)} />
              <MiniStat label="Payment initialized" value={n(f.payment_initialized)} />
              <MiniStat label="Order tracking opened" value={n(f.order_tracking_opened)} />
            </div>
          </Section>

          {/* Breakdowns */}
          <div className="grid md:grid-cols-2 gap-6">
            <Section title="Fulfillment Selected">
              <Breakdown data={data.fulfillmentBreakdown} labels={FULFILLMENT_LABEL} empty="No fulfillment selections yet." />
            </Section>
            <Section title="Payment Method Selected">
              <Breakdown data={data.paymentMethodBreakdown} labels={METHOD_LABEL} empty="No payment selections yet." />
            </Section>
          </div>

          {/* Top items */}
          <div className="grid md:grid-cols-2 gap-6">
            <Section title="Top Viewed Items">
              <ItemList items={data.topViewed} empty="No item views yet." />
            </Section>
            <Section title="Top Added-to-Cart Items">
              <ItemList items={data.topAdded} empty="No add-to-cart activity yet." />
            </Section>
          </div>

          {/* Recommendations */}
          {data.recommendations && data.recommendations.length > 0 && (
            <Section title="Recommendations">
              <div className="space-y-3">
                {data.recommendations.map((r) => (
                  <div
                    key={r.id}
                    className={`rounded-2xl border p-4 ${
                      r.severity === "warn"
                        ? "bg-amber-50 border-amber-200"
                        : "bg-green-50 border-green-200"
                    }`}
                  >
                    <p className="font-black text-gray-900 text-sm flex items-center gap-2">
                      <span>{r.severity === "warn" ? "⚠️" : "✅"}</span> {r.title}
                    </p>
                    <p className="text-sm text-gray-600 mt-1">{r.detail}</p>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, accent, hint }: { label: string; value: string; accent: string; hint?: string }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-4">
      <p className="text-[11px] font-black text-gray-400 uppercase tracking-tight">{label}</p>
      <p className={`text-2xl font-black mt-1 ${accent}`}>{value}</p>
      {hint && <p className="text-[10px] text-gray-400 font-medium mt-0.5">{hint}</p>}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 rounded-xl p-3">
      <p className="text-[10px] font-black text-gray-400 uppercase tracking-tight">{label}</p>
      <p className="text-lg font-black text-gray-800 mt-0.5">{value}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
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

function Breakdown({ data, labels, empty }: { data?: Record<string, number>; labels: Record<string, string>; empty: string }) {
  const entries = Object.entries(data ?? {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  if (entries.length === 0) return <p className="text-sm text-gray-400 font-medium">{empty}</p>;
  return (
    <div className="space-y-2.5">
      {entries.map(([k, v]) => (
        <div key={k}>
          <div className="flex justify-between text-sm mb-1">
            <span className="font-bold text-gray-700">{labels[k] ?? k}</span>
            <span className="font-black text-gray-900">{n(v)} <span className="text-gray-400 font-medium text-xs">({total > 0 ? Math.round((v / total) * 100) : 0}%)</span></span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full" style={{ width: `${total > 0 ? (v / total) * 100 : 0}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ItemList({ items, empty }: { items?: RankedItem[]; empty: string }) {
  if (!items || items.length === 0) return <p className="text-sm text-gray-400 font-medium">{empty}</p>;
  return (
    <div className="space-y-2">
      {items.map((it, i) => (
        <div key={it.id} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
          <span className="text-sm font-bold text-gray-700 flex items-center gap-2">
            <span className="text-gray-300 font-black w-5">{i + 1}</span> {it.name}
          </span>
          <span className="text-sm font-black text-gray-900">{n(it.count)}</span>
        </div>
      ))}
    </div>
  );
}
