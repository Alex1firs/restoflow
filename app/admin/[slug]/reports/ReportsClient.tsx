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
  cancelledTotal: number;
};

type Order = {
  orderId: string;
  date: string;
  customerName: string;
  phone: string;
  items: string;
  itemsRaw?: Array<{ name: string; quantity: number; price: number; indoorPrice?: number }>;
  waiterName?: string;
  settlementNote?: string;
  settledByStaffName?: string;
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
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

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
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3">
            {[
              { label: "Online Paid", value: fmt(summary.onlineTotal), accent: "text-blue-600" },
              { label: "Cash Sales", value: fmt(summary.cashTotal), accent: "text-green-600" },
              { label: "Counter Total", value: fmt(summary.counterTotal), accent: "text-orange-600" },
              { label: "Bank Transfer", value: fmt(summary.bankTransferTotal), accent: "text-purple-600" },
              { label: "Card / POS", value: fmt(summary.cardTotal), accent: "text-indigo-600" },
              { label: "Unpaid", value: fmt(summary.unpaidTotal), accent: "text-red-500" },
              { label: "Cancelled Total", value: fmt(summary.cancelledTotal), accent: "text-red-600" },
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
                  <p className="text-xs text-gray-400 mt-0.5">received → preparing</p>
                </div>
              )}
              {summary.avgReadyMinutes !== null && (
                <div className="bg-white rounded-2xl border border-gray-100 p-4">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-1">Avg. Prep Time</p>
                  <p className="text-xl font-black text-green-600">{summary.avgReadyMinutes}m</p>
                  <p className="text-xs text-gray-400 mt-0.5">received → ready</p>
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
              <>
                <div className="hidden md:block overflow-x-auto">
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
                        <tr
                          key={o.orderId}
                          className="hover:bg-gray-50 cursor-pointer transition-colors"
                          onClick={() => setSelectedOrder(o)}
                        >
                          <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{o.date}</td>
                          <td className="px-4 py-3">
                            <p className="font-bold text-gray-900">{o.customerName || "—"}</p>
                            {o.phone && <p className="text-xs text-gray-400">{o.phone}</p>}
                          </td>
                          <td className="px-4 py-3 text-gray-600 text-xs max-w-[200px] truncate" title={o.items}>{o.items || "—"}</td>
                          <td className="px-4 py-3 font-bold text-gray-900 whitespace-nowrap">{fmt(o.total)}</td>
                          <td className="px-4 py-3">
                            <span className={`text-xs font-bold uppercase px-2 py-1 rounded-full ${o.paymentMethod === "online" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"}`}>
                              {o.paymentMethod}
                            </span>
                            {o.paymentMethod === "online" && (
                              <span className={`ml-1 text-xs font-bold uppercase px-2 py-1 rounded-full ${o.paymentStatus === "paid" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"}`}>
                                {o.paymentStatus}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {o.status === "rejected" ? (
                              <span className="text-xs font-bold uppercase px-2 py-1 rounded-full bg-red-100 text-red-700">
                                Voided
                              </span>
                            ) : (
                              <span className={`text-xs font-bold uppercase px-2 py-1 rounded-full ${
                                o.paymentStatus === "paid"
                                  ? "bg-green-100 text-green-700"
                                  : o.paymentStatus === "part_paid"
                                  ? "bg-yellow-100 text-yellow-700"
                                  : "bg-red-100 text-red-700"
                              }`}>
                                {o.paymentStatus || "unpaid"}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-500 capitalize">{o.deliveryType || "—"}</td>
                          <td className="px-4 py-3">
                            <span className={`text-xs font-bold uppercase px-2 py-1 rounded-full ${o.orderSource === "counter" ? "bg-orange-100 text-orange-700" : "bg-blue-100 text-blue-700"}`}>
                              {o.orderSource === "counter" ? "Counter" : "Online"}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            {o.serviceMode === "dine_in" && o.tableLabel ? (
                              <span className="text-xs font-bold px-2 py-1 rounded-full bg-teal-100 text-teal-700">
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
                <div className="md:hidden divide-y divide-gray-50">
                  {orders.map((o) => (
                    <div
                      key={o.orderId}
                      className="p-4 space-y-2 cursor-pointer hover:bg-gray-50 transition-colors"
                      onClick={() => setSelectedOrder(o)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-gray-900">{o.customerName || "—"}</p>
                          {o.phone && <p className="text-xs text-gray-400">{o.phone}</p>}
                        </div>
                        <p className="text-xs text-gray-400 shrink-0">{o.date}</p>
                      </div>
                      {o.items && (
                        <p className="text-xs text-gray-500 line-clamp-2">{o.items}</p>
                      )}
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-bold text-gray-900">{fmt(o.total)}</p>
                        <div className="flex flex-wrap gap-1 justify-end">
                          <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded-full ${o.paymentMethod === "online" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"}`}>
                            {o.paymentMethod}
                          </span>
                          {o.paymentMethod === "online" && (
                            <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded-full ${o.paymentStatus === "paid" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"}`}>
                              {o.paymentStatus}
                            </span>
                          )}
                          {o.status === "rejected" ? (
                            <span className="text-xs font-bold uppercase px-2 py-0.5 rounded-full bg-red-100 text-red-700">
                              Voided
                            </span>
                          ) : (
                            <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded-full ${
                              o.paymentStatus === "paid"
                                ? "bg-green-100 text-green-700"
                                : o.paymentStatus === "part_paid"
                                ? "bg-yellow-100 text-yellow-700"
                                : "bg-red-100 text-red-700"
                            }`}>
                              {o.paymentStatus || "unpaid"}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5 items-center">
                        {o.deliveryType && <span className="text-xs text-gray-400 capitalize">{o.deliveryType}</span>}
                        <span className={`text-xs font-bold uppercase px-1.5 py-0.5 rounded ${o.orderSource === "counter" ? "bg-orange-50 text-orange-600" : "bg-blue-50 text-blue-600"}`}>
                          {o.orderSource === "counter" ? "Counter" : "Online"}
                        </span>
                        {o.serviceMode === "dine_in" && o.tableLabel && (
                          <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-teal-50 text-teal-700">{o.tableLabel}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </>
      ) : (
        <div className="py-24 text-center text-gray-400 text-sm">No data available.</div>
      )}
      {selectedOrder && (
        <div className="fixed inset-0 backdrop-blur-sm bg-black/60 z-50 flex items-center justify-center p-4 overflow-y-auto no-print">
          <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl border border-gray-100 overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-black text-gray-900 text-sm uppercase tracking-wider">Past Order Receipt</h3>
              <button
                onClick={() => setSelectedOrder(null)}
                className="text-gray-400 hover:text-gray-600 transition-colors p-1"
              >
                ✕
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1 bg-gray-100 flex justify-center">
              {/* Virtual Receipt Sheet */}
              <div
                id="print-receipt-area"
                className="bg-white w-full max-w-sm shadow-md rounded-lg p-6 font-mono text-xs text-gray-800 border border-gray-200"
                style={{ fontFamily: "Courier New, Courier, monospace" }}
              >
                <div className="text-center space-y-1 mb-4">
                  <h4 className="font-extrabold text-sm text-gray-900 tracking-wider">
                    {slug === "tricias-kitchen" ? "TRICIA'S KITCHEN" : slug.replace("-", " ").toUpperCase()}
                  </h4>
                  <p className="text-[10px] text-gray-400">Digital POS Sales Receipt</p>
                  <p className="text-[10px] text-gray-400">{selectedOrder.date}</p>
                </div>

                <div className="border-t border-dashed border-gray-300 py-2 space-y-1 text-[11px]">
                  <div className="flex justify-between">
                    <span>Order ID:</span>
                    <span className="font-bold text-gray-900">#{selectedOrder.orderId.slice(-6).toUpperCase()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Source:</span>
                    <span className="font-bold capitalize text-gray-900">{selectedOrder.orderSource}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Service Mode:</span>
                    <span className="font-bold capitalize text-gray-900">{selectedOrder.serviceMode?.replace("_", " ") || "Standard"}</span>
                  </div>
                  {selectedOrder.tableLabel && (
                    <div className="flex justify-between">
                      <span>Table:</span>
                      <span className="font-bold text-gray-900">{selectedOrder.tableLabel}</span>
                    </div>
                  )}
                  {selectedOrder.customerName && (
                    <div className="flex justify-between">
                      <span>Customer:</span>
                      <span className="font-bold text-gray-900">{selectedOrder.customerName}</span>
                    </div>
                  )}
                  {selectedOrder.phone && (
                    <div className="flex justify-between">
                      <span>Phone:</span>
                      <span className="font-bold text-gray-900">{selectedOrder.phone}</span>
                    </div>
                  )}
                </div>

                <div className="border-t border-dashed border-gray-300 my-2"></div>

                {/* Items List */}
                <table className="w-full text-left text-[11px] border-collapse">
                  <thead>
                    <tr className="border-b border-dashed border-gray-200">
                      <th className="py-1 font-bold text-gray-900">ITEM</th>
                      <th className="py-1 font-bold text-gray-900 text-center">QTY</th>
                      <th className="py-1 font-bold text-gray-900 text-right">TOTAL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(selectedOrder.itemsRaw && selectedOrder.itemsRaw.length > 0
                      ? selectedOrder.itemsRaw
                      : selectedOrder.items.split(", ").map((str) => {
                          const match = str.match(/^(\d+)x\s+(.+)$/);
                          return match
                            ? { name: match[2], quantity: parseInt(match[1]), price: 0 }
                            : { name: str, quantity: 1, price: 0 };
                        })
                    ).map((item, idx) => {
                      const itemTotal = item.price ? item.price * item.quantity : 0;
                      return (
                        <tr key={idx} className="border-b border-dotted border-gray-100 last:border-0">
                          <td className="py-1.5 pr-2 align-top">
                            <span className="font-bold text-gray-900 block">{item.name}</span>
                            {item.price > 0 && (
                              <span className="text-[9px] text-gray-400">@ ₦{item.price.toLocaleString("en-NG")}</span>
                            )}
                          </td>
                          <td className="py-1.5 text-center align-top">{item.quantity}</td>
                          <td className="py-1.5 text-right align-top font-bold text-gray-900">
                            {itemTotal > 0 ? `₦${itemTotal.toLocaleString("en-NG")}` : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                <div className="border-t border-dashed border-gray-300 my-2"></div>

                {/* Subtotal, delivery, total */}
                <div className="space-y-1 text-[11px]">
                  {selectedOrder.itemsTotal > 0 && (
                    <div className="flex justify-between">
                      <span>Subtotal:</span>
                      <span>₦{selectedOrder.itemsTotal.toLocaleString("en-NG")}</span>
                    </div>
                  )}
                  {selectedOrder.deliveryFee > 0 && (
                    <div className="flex justify-between">
                      <span>Delivery Fee:</span>
                      <span>₦{selectedOrder.deliveryFee.toLocaleString("en-NG")}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-xs font-extrabold text-gray-900 pt-1">
                    <span>GRAND TOTAL:</span>
                    <span>₦{selectedOrder.total.toLocaleString("en-NG")}</span>
                  </div>
                </div>

                <div className="border-t border-dashed border-gray-300 my-2"></div>

                {/* Payment, Cashier, Waiter details */}
                <div className="space-y-1 text-[10px] text-gray-500">
                  <div className="flex justify-between">
                    <span>Payment Status:</span>
                    <span className="font-bold uppercase text-green-600">{selectedOrder.paymentStatus || "PAID"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Method:</span>
                    <span className="font-bold uppercase">{selectedOrder.paymentMethod?.replace("_", " ")}</span>
                  </div>
                  {selectedOrder.settledByStaffName && (
                    <div className="flex justify-between">
                      <span>Cashier:</span>
                      <span className="font-bold">{selectedOrder.settledByStaffName}</span>
                    </div>
                  )}
                  {selectedOrder.waiterName && (
                    <div className="flex justify-between">
                      <span>Waiter:</span>
                      <span className="font-bold">{selectedOrder.waiterName}</span>
                    </div>
                  )}
                  {selectedOrder.settlementNote && (
                    <div className="mt-2 p-1.5 bg-gray-50 border border-gray-100 rounded text-[9px] text-gray-400 italic">
                      Note: {selectedOrder.settlementNote}
                    </div>
                  )}
                </div>

                <div className="text-center mt-6 pt-4 border-t border-dashed border-gray-200">
                  <p className="text-[10px] uppercase font-bold tracking-wider text-gray-400">Thank You For Your Patronage!</p>
                  <p className="text-[8px] text-gray-300 mt-1">Powered by RestoFlow POS</p>
                </div>
              </div>
            </div>

            <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex gap-3">
              <button
                onClick={() => setSelectedOrder(null)}
                className="flex-1 py-2.5 border border-gray-200 hover:bg-gray-100 transition-colors text-sm font-bold text-gray-600 rounded-xl"
              >
                Close
              </button>
              <button
                onClick={() => window.print()}
                className="flex-1 py-2.5 bg-orange-600 hover:bg-orange-500 transition-colors text-sm font-bold text-white rounded-xl shadow-sm flex items-center justify-center gap-2"
              >
                🖨️ Print Receipt
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Self-contained styling for high precision print media */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @media print {
              /* Hide all application dashboard wrappers, navs, sidebars */
              body * {
                visibility: hidden !important;
                background: none !important;
              }
              /* Expose and isolate ONLY the print receipt slip area */
              #print-receipt-area, #print-receipt-area * {
                visibility: visible !important;
              }
              #print-receipt-area {
                position: fixed !important;
                left: 6mm !important;
                top: 4mm !important;
                width: calc(100% - 8mm) !important;
                max-width: 50mm !important; /* Safe printable width on 58mm rolls */
                padding: 0 !important;
                margin: 0 !important;
                border: none !important;
                box-shadow: none !important;
                background: white !important;
                color: black !important;
                box-sizing: border-box !important;
                line-height: 1.1 !important;
              }
              #print-receipt-area * {
                font-size: 9px !important;
              }
              #print-receipt-area h4 {
                font-size: 11px !important;
                margin-bottom: 2px !important;
              }
              /* Suppress headers, footers, margins */
              @page {
                size: auto;
                margin: 0 !important;
              }
            }
          `,
        }}
      />
    </div>
  );
}
