"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Search, RotateCcw, Loader2, AlertTriangle, Gift } from "lucide-react";
import type { SuperAdminOrderRow } from "@/lib/orders/admin-view";
import { buildOrdersQuery, dayRangeMs, filterRowsByOrderId, formatAmount, formatWhen, type OrdersUiFilters } from "./orders-ui-lib";

type Restaurant = { slug: string; name: string };

const STATUS_OPTIONS = ["pending", "accepted", "preparing", "ready", "completed", "rejected", "voided", "scheduled"];
const PAYMENT_STATUS_OPTIONS = ["paid", "pending", "unpaid"];
const PAYMENT_METHOD_OPTIONS = ["cash", "whatsapp", "online", "bank_transfer"];
const PAGE = 50;

function badge(kind: "pay" | "status", value: string) {
  const v = value.toLowerCase();
  const paid = kind === "pay" && v === "paid";
  const good = ["completed", "ready", "accepted", "preparing"].includes(v);
  const bad = ["rejected", "voided", "unpaid"].includes(v);
  const cls = paid || good
    ? "bg-emerald-100 text-emerald-700"
    : bad
    ? "bg-red-100 text-red-600"
    : "bg-gray-100 text-gray-600";
  return <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full ${cls}`}>{value || "—"}</span>;
}

export default function OrdersClient({ restaurants }: { restaurants: Restaurant[] }) {
  const [restaurantId, setRestaurantId] = useState("");
  const [status, setStatus] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [searchMode, setSearchMode] = useState<"phone" | "orderId">("phone");
  const [search, setSearch] = useState("");

  const [rows, setRows] = useState<SuperAdminOrderRow[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [queryKey, setQueryKey] = useState(0);

  const appliedFilters = useCallback((cursorVal: number | null): OrdersUiFilters => {
    const { fromMs, toMs } = dayRangeMs(fromDate, toDate);
    return {
      restaurantId: restaurantId || undefined,
      status: status || undefined,
      paymentStatus: paymentStatus || undefined,
      paymentMethod: paymentMethod || undefined,
      fromMs, toMs,
      phone: searchMode === "phone" ? (search || undefined) : undefined,
      limit: PAGE,
      cursor: cursorVal,
    };
  }, [restaurantId, status, paymentStatus, paymentMethod, fromDate, toDate, searchMode, search]);

  const load = useCallback(async (reset: boolean, cursorVal: number | null) => {
    setLoading(true);
    if (reset) setError(false);
    try {
      const qs = buildOrdersQuery(appliedFilters(reset ? null : cursorVal));
      const res = await fetch(`/api/super-admin/orders?${qs}`);
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      const incoming: SuperAdminOrderRow[] = Array.isArray(data.orders) ? data.orders : [];
      setRows((prev) => (reset ? incoming : [...prev, ...incoming]));
      setCursor(data.nextCursor ?? null);
      setHasMore(data.nextCursor != null);
      setLoaded(true);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [appliedFilters]);

  // Fetch on mount and whenever the user Applies/Resets (queryKey bump).
  // load is intentionally excluded: we re-fetch only on explicit Apply/Reset.
  useEffect(() => {
    load(true, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey]);

  function apply() { setQueryKey((k) => k + 1); }
  function reset() {
    setRestaurantId(""); setStatus(""); setPaymentStatus(""); setPaymentMethod("");
    setFromDate(""); setToDate(""); setSearchMode("phone"); setSearch("");
    setQueryKey((k) => k + 1);
  }

  // Order-ID search filters the loaded rows client-side (exact match).
  const displayed = searchMode === "orderId" ? filterRowsByOrderId(rows, search) : rows;

  const selectCls = "border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white";

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-black text-gray-900">Live Orders</h1>
        <p className="text-sm text-gray-500 mt-0.5">Monitor customer orders across all restaurant storefronts.</p>
      </div>

      {/* Filters */}
      <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-5 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <select value={restaurantId} onChange={(e) => setRestaurantId(e.target.value)} className={selectCls}>
            <option value="">All restaurants</option>
            {restaurants.map((r) => <option key={r.slug} value={r.slug}>{r.name}</option>)}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={selectCls}>
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value)} className={selectCls}>
            <option value="">All payment statuses</option>
            {PAYMENT_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className={selectCls}>
            <option value="">All methods</option>
            {PAYMENT_METHOD_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <label className="flex items-center gap-2 text-xs text-gray-500">
            From <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className={`${selectCls} flex-1`} />
          </label>
          <label className="flex items-center gap-2 text-xs text-gray-500">
            To <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className={`${selectCls} flex-1`} />
          </label>
        </div>

        <div className="flex flex-col sm:flex-row gap-2 mt-3">
          <div className="flex items-center gap-2 flex-1">
            <select value={searchMode} onChange={(e) => setSearchMode(e.target.value as "phone" | "orderId")} className={selectCls}>
              <option value="phone">Phone</option>
              <option value="orderId">Order ID</option>
            </select>
            <div className="relative flex-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && apply()}
                placeholder={searchMode === "phone" ? "Exact phone (any NG format)" : "Exact order ID"}
                className="w-full border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={apply} className="bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold px-4 py-2 rounded-lg">Apply</button>
            <button onClick={reset} className="inline-flex items-center gap-1.5 text-gray-600 text-sm font-bold px-3 py-2 rounded-lg hover:bg-gray-100">
              <RotateCcw size={14} /> Reset
            </button>
          </div>
        </div>
        {searchMode === "orderId" && (
          <p className="text-[11px] text-gray-400 mt-2">Order-ID search matches within loaded rows. Full order lookup arrives with the detail page.</p>
        )}
      </div>

      {/* States */}
      {error ? (
        <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center">
          <AlertTriangle className="mx-auto text-red-400 mb-2" size={22} />
          <p className="text-sm text-gray-600 font-medium">Could not load orders.</p>
          <button onClick={() => load(true, null)} className="mt-3 text-sm font-bold text-orange-600 hover:underline">Retry</button>
        </div>
      ) : !loaded && loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400"><Loader2 className="animate-spin mr-2" size={18} /> Loading orders…</div>
      ) : displayed.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-2xl p-10 text-center text-sm text-gray-400">
          No orders match these filters.
        </div>
      ) : (
        <>
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[1000px]">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
                  <tr>
                    {["Order", "Restaurant", "Customer", "Phone", "Items", "Total", "Method", "Payment", "Status", "Created", "Campaign", ""].map((h) => (
                      <th key={h} className="text-left font-bold px-3 py-3 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {displayed.map((o) => (
                    <tr key={o.orderId} className="border-t border-gray-100 hover:bg-gray-50/60">
                      <td className="px-3 py-3 whitespace-nowrap">
                        <div className="font-bold text-gray-900">#{o.orderNumber ?? "—"}</div>
                        <div className="font-mono text-[11px] text-gray-400">{o.orderId.slice(0, 8)}…</div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="font-medium text-gray-800">{o.restaurantName ?? o.restaurantId}</div>
                        <div className="text-[11px] text-gray-400">{o.restaurantSlug}</div>
                      </td>
                      <td className="px-3 py-3 text-gray-800">{o.customerName || "—"}</td>
                      <td className="px-3 py-3 font-mono text-gray-800 whitespace-nowrap">{o.phone || "—"}</td>
                      <td className="px-3 py-3 text-gray-600 max-w-[220px] truncate" title={o.itemsSummary}>{o.itemsSummary || "—"}</td>
                      <td className="px-3 py-3 font-semibold text-gray-900 whitespace-nowrap">{formatAmount(o.total)}</td>
                      <td className="px-3 py-3 text-gray-600 whitespace-nowrap">{o.paymentMethod || "—"}</td>
                      <td className="px-3 py-3">{badge("pay", o.paymentStatus)}</td>
                      <td className="px-3 py-3">{badge("status", o.status)}</td>
                      <td className="px-3 py-3 text-gray-500 whitespace-nowrap">{formatWhen(o.createdAtMs)}</td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        {o.campaignId
                          ? <span className="inline-flex items-center gap-1 text-[11px] font-bold text-orange-600"><Gift size={12} /> campaign</span>
                          : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-3">
                        <Link
                          href={`/super-admin/orders/${o.orderId}`}
                          className="text-xs font-bold text-orange-600 hover:bg-orange-50 px-2 py-1 rounded-lg"
                        >
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex items-center justify-between mt-4">
            <p className="text-xs text-gray-400">{displayed.length} shown{searchMode === "orderId" ? " (filtered by ID)" : ""}</p>
            {hasMore && searchMode !== "orderId" && (
              <button
                onClick={() => load(false, cursor)}
                disabled={loading}
                className="inline-flex items-center gap-2 text-sm font-bold text-orange-600 hover:bg-orange-50 disabled:opacity-60 px-4 py-2 rounded-lg"
              >
                {loading ? <Loader2 className="animate-spin" size={14} /> : null} Load more
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
