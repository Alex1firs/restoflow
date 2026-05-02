"use client";

import { useEffect, useRef, useState } from "react";
import { db } from "@/lib/firebase";
import { collection, query, where, onSnapshot, Timestamp } from "firebase/firestore";

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

export default function DashboardClient({ slug }: Props) {
  const [allOrders, setAllOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
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
