"use client";

import { useEffect, useRef, useState } from "react";
import { db } from "@/lib/firebase";
import { collection, query, where, onSnapshot, Timestamp } from "firebase/firestore";
import type { SetupChecklist } from "@/lib/setup-checklist";

type OrderStatus = "pending" | "preparing" | "ready" | "completed" | "rejected";

interface Order {
  id: string;
  customerName: string;
  phone: string;
  address: string;
  items: { name: string; price: number; quantity: number }[];
  itemsTotal: number;
  deliveryFee?: number;
  total: number;
  status: OrderStatus;
  paymentMethod: "online" | "cash";
  paymentStatus?: string;
  paymentReference?: string;
  createdAt: Timestamp | null;
  restaurantId: string;
}

interface Props {
  slug: string;
  status?: string;
  rejectionReason?: string;
  setupChecklist?: SetupChecklist;
}

function getLagosStartOfDay(): Date {
  const lagosNow = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Africa/Lagos" })
  );
  lagosNow.setHours(0, 0, 0, 0);
  return lagosNow;
}

function formatCurrency(n: number) {
  return "₦" + n.toLocaleString("en-NG");
}

function formatTime(ts: Timestamp | null): string {
  if (!ts) return "—";
  return ts.toDate().toLocaleTimeString("en-NG", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Lagos",
  });
}

const STATUS_CONFIG: Record<OrderStatus, { label: string; dot: string; badge: string }> = {
  pending:   { label: "Pending",    dot: "bg-orange-500", badge: "bg-orange-100 text-orange-700" },
  preparing: { label: "Preparing",  dot: "bg-blue-500",   badge: "bg-blue-100 text-blue-700" },
  ready:     { label: "Ready",      dot: "bg-green-500",  badge: "bg-green-100 text-green-700" },
  completed: { label: "Completed",  dot: "bg-gray-400",   badge: "bg-gray-100 text-gray-600" },
  rejected:  { label: "Rejected",   dot: "bg-red-500",    badge: "bg-red-100 text-red-700" },
};

const ACTIVE_STATUSES: OrderStatus[] = ["pending", "preparing", "ready"];

export default function DashboardClient({ slug, status = "draft", rejectionReason, setupChecklist }: Props) {
  const [allOrders, setAllOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);
  const [checklistExpanded, setChecklistExpanded] = useState(!setupChecklist?.canSubmit);
  const startOfDayRef = useRef(getLagosStartOfDay());

  useEffect(() => {
    startOfDayRef.current = getLagosStartOfDay();

    const q = query(
      collection(db, "orders"),
      where("restaurantId", "==", slug)
    );

    const unsub = onSnapshot(q, (snap) => {
      const orders = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Order));
      setAllOrders(orders);
      setLoading(false);
    });

    return unsub;
  }, [slug]);

  const todayOrders = allOrders.filter((o) => {
    if (!o.createdAt) return false;
    return o.createdAt.toDate() >= startOfDayRef.current;
  });

  const activeOrders = allOrders.filter((o) => ACTIVE_STATUSES.includes(o.status));

  const todayRevenue = todayOrders
    .filter((o) => o.status !== "rejected")
    .reduce((sum, o) => sum + o.total, 0);

  const todayOnline = todayOrders.filter(
    (o) => o.paymentMethod === "online" && o.status !== "rejected"
  ).length;

  const todayCash = todayOrders.filter(
    (o) => o.paymentMethod === "cash" && o.status !== "rejected"
  ).length;

  const todayOnlineRevenue = todayOrders
    .filter((o) => o.paymentMethod === "online" && o.status !== "rejected")
    .reduce((sum, o) => sum + o.total, 0);

  const todayCashRevenue = todayOrders
    .filter((o) => o.paymentMethod === "cash" && o.status !== "rejected")
    .reduce((sum, o) => sum + o.total, 0);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-6 h-6 rounded-full border-2 border-orange-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  const submitForReview = async () => {
    if (setupChecklist && !setupChecklist.canSubmit) return;
    setIsSubmittingReview(true);
    try {
      const res = await fetch(`/api/admin/restaurants/${slug}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "pending_review" }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "Failed to submit");
      }
      window.location.reload();
    } catch (e: unknown) {
      alert("Failed to submit for review: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setIsSubmittingReview(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-8">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-black text-gray-900 tracking-tight">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {new Date().toLocaleDateString("en-NG", {
              weekday: "long", year: "numeric", month: "long", day: "numeric",
              timeZone: "Africa/Lagos",
            })}
          </p>
        </div>

        {/* Setup Status Banner */}
        {status !== "live" && (
          <div className={`rounded-2xl border ${
            status === "rejected"      ? "bg-red-50 border-red-200" :
            status === "suspended"     ? "bg-red-50 border-red-200" :
            status === "pending_review" ? "bg-blue-50 border-blue-200" :
            "bg-orange-50 border-orange-200"
          }`}>
            <div className="p-5">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <h3 className={`font-black text-lg ${
                    status === "rejected"      ? "text-red-800" :
                    status === "suspended"     ? "text-red-800" :
                    status === "pending_review" ? "text-blue-800" :
                    "text-orange-800"
                  }`}>
                    {status === "draft"          && "Complete your setup"}
                    {status === "pending_review" && "Pending Review"}
                    {status === "rejected"       && "Review Rejected"}
                    {status === "suspended"      && "Account Suspended"}
                  </h3>
                  <p className={`text-sm mt-1 font-medium ${
                    status === "rejected"      ? "text-red-600" :
                    status === "suspended"     ? "text-red-600" :
                    status === "pending_review" ? "text-blue-600" :
                    "text-orange-600"
                  }`}>
                    {status === "draft"          && "Your restaurant is currently in draft mode. Complete the checklist below, then submit for review."}
                    {status === "pending_review" && "Your restaurant has been submitted and is waiting for administrator approval."}
                    {status === "rejected"       && `Your submission was rejected: ${rejectionReason || "Please contact support."}`}
                    {status === "suspended"      && "Your restaurant has been suspended. Please contact support."}
                  </p>

                  {/* Score bar — shown when draft or rejected */}
                  {setupChecklist && (status === "draft" || status === "rejected") && (
                    <div className="mt-4">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-bold text-gray-600">Setup score</span>
                        <span className={`text-xs font-black ${
                          setupChecklist.score >= 80 ? "text-green-700" :
                          setupChecklist.score >= 50 ? "text-orange-700" : "text-red-600"
                        }`}>{setupChecklist.score}/100</span>
                      </div>
                      <div className="h-2 bg-white/60 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            setupChecklist.score >= 80 ? "bg-green-500" :
                            setupChecklist.score >= 50 ? "bg-orange-400" : "bg-red-400"
                          }`}
                          style={{ width: `${setupChecklist.score}%` }}
                        />
                      </div>
                      {!setupChecklist.canSubmit && (
                        <p className="text-xs font-semibold text-red-600 mt-1.5">
                          Complete all required steps to enable submission.
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <a
                    href={`/admin/${slug}/preview`}
                    target="_blank"
                    className="bg-white border border-gray-200 text-gray-700 px-4 py-2 rounded-xl text-sm font-bold hover:bg-gray-50 transition-colors"
                  >
                    Preview Website
                  </a>
                  {(status === "draft" || status === "rejected") && (
                    <button
                      onClick={submitForReview}
                      disabled={isSubmittingReview || (setupChecklist != null && !setupChecklist.canSubmit)}
                      title={setupChecklist && !setupChecklist.canSubmit ? "Complete all required steps first" : undefined}
                      className="bg-gray-900 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-gray-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {isSubmittingReview ? "Submitting…" : status === "rejected" ? "Resubmit for Review" : "Submit for Review"}
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Collapsible checklist — shown when draft or rejected */}
            {setupChecklist && (status === "draft" || status === "rejected") && (
              <div className={`border-t ${
                status === "rejected" ? "border-red-200" : "border-orange-200"
              }`}>
                <button
                  onClick={() => setChecklistExpanded((v) => !v)}
                  className={`w-full flex items-center justify-between px-5 py-3 text-xs font-bold uppercase tracking-wide transition-colors ${
                    status === "rejected"
                      ? "text-red-700 hover:bg-red-100/50"
                      : "text-orange-700 hover:bg-orange-100/50"
                  }`}
                >
                  <span>Setup checklist</span>
                  <svg
                    className={`w-4 h-4 transition-transform ${checklistExpanded ? "rotate-180" : ""}`}
                    fill="none" stroke="currentColor" viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {checklistExpanded && (
                  <div className="px-5 pb-5 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {setupChecklist.items.map((item) => (
                      <div
                        key={item.key}
                        className={`flex items-start gap-3 p-3 rounded-xl border ${
                          item.passed
                            ? "bg-white/70 border-gray-100"
                            : item.required
                            ? "bg-red-50 border-red-200"
                            : "bg-white/50 border-gray-100"
                        }`}
                      >
                        <div className={`mt-0.5 shrink-0 w-5 h-5 rounded-full flex items-center justify-center ${
                          item.passed ? "bg-green-100" : item.required ? "bg-red-100" : "bg-gray-100"
                        }`}>
                          {item.passed ? (
                            <svg className="w-3 h-3 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                            </svg>
                          ) : (
                            <svg className={`w-3 h-3 ${item.required ? "text-red-500" : "text-gray-400"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className={`text-xs font-bold ${
                            item.passed ? "text-gray-700" : item.required ? "text-red-700" : "text-gray-500"
                          }`}>
                            {item.label}
                            {item.required && !item.passed && (
                              <span className="ml-1 text-[10px] font-black text-red-500 uppercase tracking-wide">Required</span>
                            )}
                          </p>
                          {!item.passed && (
                            <p className="text-[11px] text-gray-500 mt-0.5 leading-snug">{item.hint}</p>
                          )}
                        </div>
                        <span className={`ml-auto shrink-0 text-[10px] font-black ${
                          item.passed ? "text-green-600" : "text-gray-400"
                        }`}>
                          +{item.points}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Stats grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Today's Orders"
            value={String(todayOrders.filter((o) => o.status !== "rejected").length)}
            sub={`${todayOrders.filter((o) => o.status === "rejected").length} rejected`}
            accent="orange"
          />
          <StatCard
            label="Today's Revenue"
            value={formatCurrency(todayRevenue)}
            sub="excl. rejected"
            accent="green"
          />
          <StatCard
            label="Online Paid"
            value={String(todayOnline)}
            sub={formatCurrency(todayOnlineRevenue)}
            accent="blue"
          />
          <StatCard
            label="Cash Orders"
            value={String(todayCash)}
            sub={formatCurrency(todayCashRevenue)}
            accent="gray"
          />
        </div>

        {/* Active orders */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-black text-gray-900 tracking-tight">
              Active Orders
              {activeOrders.length > 0 && (
                <span className="ml-2 text-sm font-bold text-orange-600 bg-orange-100 px-2 py-0.5 rounded-full">
                  {activeOrders.length}
                </span>
              )}
            </h2>
            <a
              href={`/admin/${slug}/orders`}
              className="text-xs font-bold text-orange-600 hover:underline"
            >
              Manage orders →
            </a>
          </div>

          {activeOrders.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center">
              <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                    d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </div>
              <p className="text-gray-500 font-medium text-sm">No active orders right now</p>
              <p className="text-gray-400 text-xs mt-1">New orders will appear here instantly</p>
            </div>
          ) : (
            <div className="space-y-3">
              {activeOrders
                .sort((a, b) => {
                  const statusOrder = { pending: 0, preparing: 1, ready: 2 };
                  return (statusOrder[a.status as keyof typeof statusOrder] ?? 9) -
                    (statusOrder[b.status as keyof typeof statusOrder] ?? 9);
                })
                .map((order) => {
                  const cfg = STATUS_CONFIG[order.status];
                  return (
                    <div
                      key={order.id}
                      className="bg-white rounded-2xl border border-gray-100 p-5 flex flex-col sm:flex-row sm:items-center gap-4"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full ${cfg.badge}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                            {cfg.label}
                          </span>
                          <span className="text-xs text-gray-400 font-medium">
                            {formatTime(order.createdAt)}
                          </span>
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                            order.paymentMethod === "online"
                              ? "bg-blue-50 text-blue-600"
                              : "bg-gray-100 text-gray-500"
                          }`}>
                            {order.paymentMethod === "online" ? "Online" : "Cash"}
                          </span>
                        </div>
                        <p className="font-bold text-gray-900 text-sm">{order.customerName}</p>
                        <p className="text-xs text-gray-500 truncate">{order.address}</p>
                        <p className="text-xs text-gray-400 mt-1">
                          {order.items.map((i) => `${i.name} ×${i.quantity}`).join(", ")}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-lg font-black text-gray-900">{formatCurrency(order.total)}</p>
                        <p className="text-xs text-gray-400">{order.items.length} item{order.items.length !== 1 ? "s" : ""}</p>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>

        {/* Today's order history */}
        {todayOrders.length > 0 && (
          <div>
            <h2 className="text-lg font-black text-gray-900 tracking-tight mb-4">Today's History</h2>
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left text-xs font-bold text-gray-400 uppercase tracking-wide px-5 py-3">Customer</th>
                    <th className="text-left text-xs font-bold text-gray-400 uppercase tracking-wide px-3 py-3 hidden sm:table-cell">Time</th>
                    <th className="text-left text-xs font-bold text-gray-400 uppercase tracking-wide px-3 py-3 hidden md:table-cell">Payment</th>
                    <th className="text-left text-xs font-bold text-gray-400 uppercase tracking-wide px-3 py-3">Status</th>
                    <th className="text-right text-xs font-bold text-gray-400 uppercase tracking-wide px-5 py-3">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {todayOrders
                    .sort((a, b) => {
                      const at = a.createdAt?.toDate().getTime() ?? 0;
                      const bt = b.createdAt?.toDate().getTime() ?? 0;
                      return bt - at;
                    })
                    .map((order) => {
                      const cfg = STATUS_CONFIG[order.status];
                      return (
                        <tr key={order.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-5 py-3 font-medium text-gray-900">{order.customerName}</td>
                          <td className="px-3 py-3 text-gray-500 hidden sm:table-cell">{formatTime(order.createdAt)}</td>
                          <td className="px-3 py-3 hidden md:table-cell">
                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                              order.paymentMethod === "online"
                                ? "bg-blue-50 text-blue-600"
                                : "bg-gray-100 text-gray-500"
                            }`}>
                              {order.paymentMethod === "online" ? "Online" : "Cash"}
                            </span>
                          </td>
                          <td className="px-3 py-3">
                            <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full ${cfg.badge}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                              {cfg.label}
                            </span>
                          </td>
                          <td className="px-5 py-3 text-right font-bold text-gray-900">{formatCurrency(order.total)}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent: "orange" | "green" | "blue" | "gray";
}) {
  const accentMap = {
    orange: "bg-orange-50 text-orange-600",
    green:  "bg-green-50 text-green-600",
    blue:   "bg-blue-50 text-blue-600",
    gray:   "bg-gray-100 text-gray-500",
  };
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5">
      <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">{label}</p>
      <p className={`text-2xl font-black tracking-tight ${accentMap[accent].split(" ")[1]}`}>
        {value}
      </p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}
