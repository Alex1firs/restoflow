"use client";

import { useState, useEffect, useCallback } from "react";

type Summary = {
  totalRevenue: number;
  totalOrders: number;
  completed: number;
  cancelled: number;
  onlineTotal: number;
  cashTotal: number;
  counterTotal: number;
  bankTransferTotal: number;
  cardTotal: number;
  unpaidTotal: number;
  onlineOrdersCount: number;
  counterOrdersCount: number;
  dineInOrdersCount: number;
  dineInTotal: number;
  avgPrepMinutes: number | null;
  avgReadyMinutes: number | null;
};

type Order = {
  orderId: string;
  date: string;
  customerName: string;
  phone: string;
  items: string;
  itemsTotal: number;
  deliveryFee: number;
  total: number;
  paymentMethod: string;
  paymentStatus: string;
  status: string;
  deliveryType: string;
  orderSource: string;
  serviceMode: string;
  tableLabel: string;
};

type BestSeller = { name: string; count: number; revenue: number };

type RangeKey = "today" | "week" | "month" | "custom";

const STATUS_COLORS: Record<string, string> = {
  completed: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
  pending: "bg-yellow-100 text-yellow-700",
  preparing: "bg-blue-100 text-blue-700",
  ready: "bg-purple-100 text-purple-700",
};

function fmt(n: number) {
  return `₦${n.toLocaleString("en-NG")}`;
}

export default function ReportsClient({ slug }: { slug: string }) {
  const [range, setRange] = useState<RangeKey>("today");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [bestSellers, setBestSellers] = useState<BestSeller[]>([]);
  const [exporting, setExporting] = useState(false);

  const fetchReports = useCallback(async (r: RangeKey, f?: string, t?: string) => {
    setLoading(true);
    try {
      let url = `/api/admin/reports?range=${r}`;
      if (r === "custom" && f && t) url += `&from=${f}&to=${t}`;
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      setSummary(data.summary);
      setOrders(data.orders);
      setBestSellers(data.bestSellers);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (range !== "custom") fetchReports(range);
  }, [range, fetchReports]);

  function handleCustomFetch() {
    if (from && to) fetchReports("custom", from, to);
  }

  async function handleExport() {
    setExporting(true);
    try {
      let url = `/api/admin/reports?range=${range}&export=csv`;
      if (range === "custom" && from && to) url += `&from=${from}&to=${to}`;
      const res = await fetch(url);
      if (!res.ok) return;
      const blob = await res.blob();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `orders-${range}-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(link.href);
    } finally {
      setExporting(false);
    }
  }

  const rangeLabel = { today: "Today", week: "Last 7 Days", month: "This Month", custom: "Custom" };

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-gray-900">Reports</h1>
          <p className="text-sm text-gray-500 mt-1">Track sales, orders, and top items.</p>
        </div>
        <button
          onClick={handleExport}
          disabled={exporting || loading || !summary}
          className="flex items-center gap-2 bg-gray-900 text-white font-bold px-4 py-2.5 rounded-xl hover:bg-gray-700 transition-colors text-sm disabled:opacity-40"
        >
          {exporting ? "Exporting…" : "↓ Export CSV"}
        </button>
      </div>

      {/* Range selector */}
      <div className="flex flex-wrap gap-2 items-center">
        {(["today", "week", "month", "custom"] as RangeKey[]).map((r) => (
          <button
            key={r}
            onClick={() => setRange(r)}
            className={`px-4 py-2 rounded-xl text-sm font-bold transition-colors ${
              range === r ? "bg-orange-600 text-white" : "bg-white text-gray-600 border border-gray-200 hover:border-orange-300"
            }`}
          >
            {rangeLabel[r]}
          </button>
        ))}
        {range === "custom" && (
          <div className="flex gap-2 items-center flex-wrap">
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-orange-500"
            />
            <span className="text-gray-400 text-sm">to</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-orange-500"
            />
            <button
              onClick={handleCustomFetch}
              disabled={!from || !to}
              className="px-4 py-2 bg-orange-600 text-white text-sm font-bold rounded-xl hover:bg-orange-500 disabled:opacity-40"
            >
              Apply
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="py-24 text-center text-gray-400 text-sm">Loading…</div>
      ) : summary ? (
        <>
          {/* Summary cards — top row */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { label: "Revenue", value: fmt(summary.totalRevenue), accent: "text-green-600" },
              { label: "Orders", value: summary.totalOrders.toString(), accent: "text-gray-900" },
              { label: "Completed", value: summary.completed.toString(), accent: "text-green-600" },
              { label: "Cancelled", value: summary.cancelled.toString(), accent: "text-red-600" },
              { label: "Online Orders", value: summary.onlineOrdersCount.toString(), accent: "text-blue-600" },
              { label: "Counter / POS", value: summary.counterOrdersCount.toString(), accent: "text-orange-600" },
            ].map((card) => (
              <div key={card.label} className="bg-white rounded-2xl border border-gray-100 p-4">
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-1">{card.label}</p>
                <p className={`text-xl font-black ${card.accent}`}>{card.value}</p>
              </div>
            ))}
          </div>

          {/* Summary cards — payment breakdown */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { label: "Online Paid", value: fmt(summary.onlineTotal), accent: "text-blue-600" },
              { label: "Cash Sales", value: fmt(summary.cashTotal), accent: "text-green-600" },
              { label: "Counter Total", value: fmt(summary.counterTotal), accent: "text-orange-600" },
              { label: "Bank Transfer", value: fmt(summary.bankTransferTotal), accent: "text-purple-600" },
              { label: "Card / POS", value: fmt(summary.cardTotal), accent: "text-indigo-600" },
              { label: "Unpaid", value: fmt(summary.unpaidTotal), accent: "text-red-500" },
            ].map((card) => (
              <div key={card.label} className="bg-white rounded-2xl border border-gray-100 p-4">
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-1">{card.label}</p>
                <p className={`text-xl font-black ${card.accent}`}>{card.value}</p>
              </div>
            ))}
          </div>

          {/* Dine-in breakdown */}
          {summary.dineInOrdersCount > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-white rounded-2xl border border-gray-100 p-4">
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-1">Dine-In Orders</p>
                <p className="text-xl font-black text-teal-600">{summary.dineInOrdersCount}</p>
              </div>
              <div className="bg-white rounded-2xl border border-gray-100 p-4">
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-1">Dine-In Revenue</p>
                <p className="text-xl font-black text-teal-600">{fmt(summary.dineInTotal)}</p>
              </div>
            </div>
          )}

          {/* Kitchen performance */}
          {(summary.avgPrepMinutes !== null || summary.avgReadyMinutes !== null) && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {summary.avgPrepMinutes !== null && (
                <div className="bg-white rounded-2xl border border-gray-100 p-4">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-1">Avg. Accept Time</p>
                  <p className="text-xl font-black text-blue-600">{summary.avgPrepMinutes}m</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">received → preparing</p>
                </div>
              )}
              {summary.avgReadyMinutes !== null && (
                <div className="bg-white rounded-2xl border border-gray-100 p-4">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-1">Avg. Prep Time</p>
                  <p className="text-xl font-black text-green-600">{summary.avgReadyMinutes}m</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">received → ready</p>
                </div>
              )}
            </div>
          )}

          {/* Best sellers */}
          {bestSellers.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100">
                <h2 className="font-black text-gray-900 text-sm">Best Sellers</h2>
              </div>
              <div className="divide-y divide-gray-50">
                {bestSellers.map((item, i) => (
                  <div key={item.name} className="flex items-center gap-3 px-5 py-3">
                    <span className="w-6 h-6 rounded-full bg-orange-100 text-orange-600 text-xs font-black flex items-center justify-center flex-shrink-0">
                      {i + 1}
                    </span>
                    <p className="font-bold text-gray-800 flex-1 text-sm">{item.name}</p>
                    <p className="text-sm text-gray-500">{item.count} sold</p>
                    <p className="text-sm font-bold text-gray-900 text-right w-28">{fmt(item.revenue)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Orders table */}
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-black text-gray-900 text-sm">Orders ({orders.length})</h2>
            </div>
            {orders.length === 0 ? (
              <div className="py-16 text-center text-gray-400 text-sm">No orders in this period.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      {["Date", "Customer", "Items", "Total", "Payment", "Status", "Type", "Source", "Table"].map((h) => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-widest whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {orders.map((o) => (
                      <tr key={o.orderId} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{o.date}</td>
                        <td className="px-4 py-3">
                          <p className="font-bold text-gray-900">{o.customerName || "—"}</p>
                          {o.phone && <p className="text-xs text-gray-400">{o.phone}</p>}
                        </td>
                        <td className="px-4 py-3 text-gray-600 text-xs max-w-[200px] truncate" title={o.items}>{o.items || "—"}</td>
                        <td className="px-4 py-3 font-bold text-gray-900 whitespace-nowrap">{fmt(o.total)}</td>
                        <td className="px-4 py-3">
                          <span className={`text-[10px] font-bold uppercase px-2 py-1 rounded-full ${o.paymentMethod === "online" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"}`}>
                            {o.paymentMethod}
                          </span>
                          {o.paymentMethod === "online" && (
                            <span className={`ml-1 text-[10px] font-bold uppercase px-2 py-1 rounded-full ${o.paymentStatus === "paid" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"}`}>
                              {o.paymentStatus}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-[10px] font-bold uppercase px-2 py-1 rounded-full ${STATUS_COLORS[o.status] ?? "bg-gray-100 text-gray-600"}`}>
                            {o.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500 capitalize">{o.deliveryType || "—"}</td>
                        <td className="px-4 py-3">
                          <span className={`text-[10px] font-bold uppercase px-2 py-1 rounded-full ${o.orderSource === "counter" ? "bg-orange-100 text-orange-700" : "bg-blue-100 text-blue-700"}`}>
                            {o.orderSource === "counter" ? "Counter" : "Online"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {o.serviceMode === "dine_in" && o.tableLabel ? (
                            <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-teal-100 text-teal-700">
                              {o.tableLabel}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-300">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="py-24 text-center text-gray-400 text-sm">No data available.</div>
      )}
    </div>
  );
}
