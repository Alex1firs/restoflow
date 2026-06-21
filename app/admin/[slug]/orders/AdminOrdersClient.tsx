"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { db } from "@/lib/firebase";
import { collection, query, where, orderBy, onSnapshot, Timestamp } from "firebase/firestore";

type OrderStatus = "scheduled" | "pending" | "preparing" | "ready" | "completed" | "rejected";

type OrderItem = { id: string; name: string; price: number; quantity: number };

type Order = {
  id: string;
  customerName: string;
  phone: string;
  address: string;
  note: string;
  items: OrderItem[];
  itemsTotal?: number;
  deliveryFee?: number;
  total: number;
  status: OrderStatus;
  paymentMethod?: "online" | "cash";
  paymentStatus?: "paid" | "pending";
  paymentReference?: string;
  rejectionReason?: string;
  orderType?: "normal" | "scheduled";
  scheduledFor?: string | Timestamp;
  createdAt: Timestamp;
  orderSource?: string;
  deliveryType?: "delivery" | "pickup";
  cancellationRequested?: boolean;
  cancellationReason?: string;
  cancellationRequestedBy?: string;
  cancellationRequestedAt?: Timestamp;
  orderNumber?: number | null;
  deliveryZoneName?: string | null;
};

type FilterTab = "active" | "completed" | "all";

type Props = {
  restaurant: { id: string; name: string; slug: string };
  role?: string;
};

function playBeep() {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    [0, 0.18, 0.36].forEach((t) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.35, ctx.currentTime + t);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.15);
      osc.start(ctx.currentTime + t);
      osc.stop(ctx.currentTime + t + 0.15);
    });
  } catch { /* silently skip if AudioContext unavailable */ }
}

const STATUS_CONFIG: Record<OrderStatus, { label: string; badge: string; dot: string }> = {
  scheduled: { label: "Scheduled", badge: "bg-cyan-100 text-cyan-800 border-cyan-200", dot: "bg-cyan-500" },
  pending:   { label: "New Order", badge: "bg-amber-100 text-amber-800 border-amber-200", dot: "bg-amber-500" },
  preparing: { label: "Preparing", badge: "bg-blue-100 text-blue-800 border-blue-200",   dot: "bg-blue-500" },
  ready:     { label: "Ready",     badge: "bg-purple-100 text-purple-800 border-purple-200", dot: "bg-purple-500" },
  completed: { label: "Completed", badge: "bg-green-100 text-green-800 border-green-200", dot: "bg-green-500" },
  rejected:  { label: "Rejected",  badge: "bg-red-100 text-red-800 border-red-200",      dot: "bg-red-400" },
};

export default function AdminOrdersClient({ restaurant, role }: Props) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<FilterTab>("active");
  const [updating, setUpdating] = useState<string | null>(null);
  const [newOrderIds, setNewOrderIds] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);

  // Printing state
  const [printingOrder, setPrintingOrder] = useState<Order | null>(null);

  const prevIds = useRef<Set<string>>(new Set());
  const firstLoad = useRef(true);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }, []);

  const triggerPrint = (order: Order) => {
    setPrintingOrder(order);
    setTimeout(() => {
      window.print();
      setPrintingOrder(null);
    }, 150);
  };

  const handleAcceptCancellation = async (orderId: string) => {
    setUpdating(orderId);
    try {
      const res = await fetch(`/api/orders/${orderId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "rejected",
          voidReason: "Owner approved remote cancellation request.",
          voidedByStaffName: "Owner (Remote Approval)",
        }),
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Failed to accept cancellation");
      }
      showToast("Order cancellation approved and voided.");
    } catch (e: any) {
      showToast(e.message || "Error accepting cancellation");
    } finally {
      setUpdating(null);
    }
  };

  const handleDeclineCancellation = async (orderId: string) => {
    setUpdating(orderId);
    try {
      const res = await fetch(`/api/orders/${orderId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          declineCancellation: true,
        }),
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Failed to decline cancellation");
      }
      showToast("Order cancellation declined and restored.");
    } catch (e: any) {
      showToast(e.message || "Error declining cancellation");
    } finally {
      setUpdating(null);
    }
  };

  useEffect(() => {
    const q = query(
      collection(db, "orders"),
      where("restaurantId", "==", restaurant.slug),
      orderBy("createdAt", "desc")
    );

    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Order[];
      setOrders(data);
      setLoading(false);

      const currentIds = new Set(snap.docs.map((d) => d.id));
      if (firstLoad.current) {
        firstLoad.current = false;
        prevIds.current = currentIds;
        return;
      }

      const added = [...currentIds].filter((id) => {
        if (prevIds.current.has(id)) return false;
        const oDoc = snap.docs.find((d) => d.id === id);
        const oData = oDoc?.data() as any;
        return oData?.orderSource !== "counter";
      });
      if (added.length > 0) {
        playBeep();
        setNewOrderIds((prev) => new Set([...prev, ...added]));
        showToast(`${added.length} new order${added.length > 1 ? "s" : ""} received!`);
        setTimeout(() => {
          setNewOrderIds((prev) => {
            const next = new Set(prev);
            added.forEach((id) => next.delete(id));
            return next;
          });
        }, 8000);
      }
      prevIds.current = currentIds;
    }, (err) => {
      console.error("Firestore error:", err);
      setLoading(false);
    });

    return () => unsub();
  }, [restaurant.slug, showToast]);

  const advance = async (orderId: string, next: OrderStatus) => {
    setUpdating(orderId);
    try {
      const res = await fetch(`/api/orders/${orderId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) throw new Error("Failed");

      // Auto-print kitchen ticket on Acceptance (status moving to preparing)
      if (next === "preparing") {
        // Query the live local array or fetch to get the complete current items
        const acceptedOrder = orders.find((o) => o.id === orderId);
        if (acceptedOrder) {
          triggerPrint(acceptedOrder);
        }
      }
    } catch {
      alert("Failed to update status. Please try again.");
    } finally {
      setUpdating(null);
    }
  };

  const reject = async (orderId: string) => {
    if (!window.confirm("Reject this order? The customer will be notified.")) return;
    setUpdating(orderId);
    try {
      const res = await fetch(`/api/orders/${orderId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "rejected" }),
      });
      if (!res.ok) throw new Error("Failed");
      setRejectingId(null);
    } catch {
      alert("Failed to reject order.");
    } finally {
      setUpdating(null);
    }
  };

  const fmt = (ts: Timestamp) => {
    if (!ts) return "Just now";
    return ts.toDate().toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" });
  };

  const isToday = (ts: Timestamp) => {
    if (!ts?.toDate) return false;
    const d = ts.toDate();
    const now = new Date();
    return d.toDateString() === now.toDateString();
  };

  const activeStatuses: OrderStatus[] = ["scheduled", "pending", "preparing", "ready"];
  const todayOrders = orders.filter((o) => isToday(o.createdAt));
  const activeOrders = orders.filter(
    (o) => activeStatuses.includes(o.status) && o.orderSource !== "counter" && o.cancellationRequested !== true
  );
  const cancellationRequests = orders.filter((o) => o.cancellationRequested === true);

  const filtered =
    tab === "active" ? activeOrders :
    tab === "completed" ? orders.filter((o) => o.status === "completed" || o.status === "rejected") :
    orders;

  // Dashboard stats
  const todayRevenue = todayOrders.filter((o) => o.status !== "rejected").reduce((s, o) => s + o.total, 0);
  const todayPaid = todayOrders.filter((o) => o.paymentStatus === "paid").length;
  const todayCash = todayOrders.filter((o) => o.paymentMethod === "cash" && o.status !== "rejected").length;

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 pb-20 md:pb-6 relative">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-gray-900 border border-orange-500/50 text-white px-6 py-3 rounded-2xl shadow-2xl font-bold text-sm flex items-center gap-3 animate-bounce">
          <span className="w-2.5 h-2.5 bg-orange-500 rounded-full animate-ping" />
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-2xl font-black text-gray-900">{restaurant.name}</h1>
          <p className="text-gray-500 text-sm font-medium">Live order management</p>
        </div>
        {activeOrders.length > 0 && (
          <div className="flex items-center gap-2 bg-orange-50 border border-orange-200 px-4 py-2 rounded-xl">
            <span className="w-2 h-2 bg-orange-500 rounded-full animate-pulse" />
            <span className="text-sm font-black text-orange-700">{activeOrders.length} active</span>
          </div>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard label="Today's Orders" value={todayOrders.length.toString()} color="orange" />
        <StatCard label="Today's Revenue" value={`₦${todayRevenue.toLocaleString("en-NG")}`} color="green" />
        <StatCard label="Online Paid" value={todayPaid.toString()} color="blue" />
        <StatCard label="Cash Orders" value={todayCash.toString()} color="gray" />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-2xl mb-6 w-full sm:w-fit">
        {(["active", "completed", "all"] as FilterTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 sm:flex-none px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${tab === t ? "bg-white shadow text-gray-900" : "text-gray-500 hover:text-gray-700"}`}
          >
            {t === "active" ? `Active (${activeOrders.length})` : t === "completed" ? "Done" : "All"}
          </button>
        ))}
      </div>

      {/* ── PENDING CANCELLATION REQUESTS QUEUE ────────────────── */}
      {(role === "owner" || role === "manager") && tab === "active" && cancellationRequests.length > 0 && (
        <div className="mb-8 space-y-4">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 bg-red-550 rounded-full animate-ping" />
            <h2 className="text-xs font-black text-red-750 uppercase tracking-widest flex items-center gap-1">
              🚨 Pending Cancellation Requests ({cancellationRequests.length})
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-4">
            {cancellationRequests.map((order) => (
              <div key={order.id} className="bg-red-50/40 border border-red-200/80 rounded-3xl p-5 shadow-sm flex flex-col md:flex-row gap-5 items-start justify-between">
                <div className="space-y-2 flex-1">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs text-red-700 bg-red-100/60 px-2 py-0.5 rounded font-black">
                      #{order.orderNumber ? order.orderNumber : order.id.slice(-6).toUpperCase()}
                    </span>
                    <span className="text-xs text-gray-500 font-semibold">
                      {order.createdAt?.toDate ? order.createdAt.toDate().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : ""}
                    </span>
                  </div>
                  <div>
                    <p className="text-sm font-black text-gray-950">
                      Customer: {order.customerName || "Walk-in Guest"}
                    </p>
                    <p className="text-xs text-gray-500 font-bold mt-0.5">
                      Total: <span className="text-gray-900 font-black">₦{order.total.toLocaleString("en-NG")}</span>
                    </p>
                  </div>
                  <div className="bg-white border border-red-100 rounded-2xl p-3.5 text-xs space-y-1">
                    <p className="text-red-700 font-extrabold flex items-center gap-1.5">
                      ⚠️ Reason for Cancellation Request:
                    </p>
                    <p className="text-gray-700 font-medium italic">
                      "{order.cancellationReason || "No reason provided"}"
                    </p>
                    {order.cancellationRequestedBy && (
                      <p className="text-[10px] text-gray-400 font-bold mt-1">
                        Requested by: {order.cancellationRequestedBy}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex flex-row md:flex-col gap-2.5 w-full md:w-auto self-stretch md:self-auto justify-end">
                  <button
                    type="button"
                    disabled={updating === order.id}
                    onClick={() => handleDeclineCancellation(order.id)}
                    className="flex-1 md:flex-initial px-4 py-2.5 bg-gray-150 hover:bg-gray-200 text-gray-700 font-black rounded-xl text-xs uppercase tracking-wider transition-colors disabled:opacity-50"
                  >
                    Decline
                  </button>
                  <button
                    type="button"
                    disabled={updating === order.id}
                    onClick={() => handleAcceptCancellation(order.id)}
                    className="flex-1 md:flex-initial px-4 py-2.5 bg-red-600 hover:bg-red-500 text-white font-black rounded-xl text-xs uppercase tracking-wider transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5 shadow-sm"
                  >
                    <span>Approve & Void</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center py-20 bg-white rounded-3xl border shadow-sm">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-orange-600 mb-4" />
          <p className="text-gray-400 font-bold">Loading orders…</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-3xl border border-dashed border-gray-200">
          <p className="text-gray-400 font-bold">{tab === "active" ? "No active orders right now." : "No orders yet."}</p>
          <p className="text-gray-300 text-sm mt-1">New orders appear here in real-time.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((order) => {
            const cfg = STATUS_CONFIG[order.status];
            const isNew = newOrderIds.has(order.id);
            const busy = updating === order.id;

            return (
              <div key={order.id} className={`bg-white border rounded-3xl overflow-hidden shadow-sm transition-all ${isNew ? "border-orange-400 shadow-orange-100 shadow-lg ring-2 ring-orange-300/50" : "border-gray-100 hover:shadow-md"}`}>
                {isNew && (
                  <div className="bg-orange-500 text-white text-xs font-black uppercase tracking-widest px-4 py-1.5 text-center">
                    New Order!
                  </div>
                )}
                <div className="flex flex-col md:flex-row">
                  {/* Left */}
                  <div className="p-4 md:p-5 md:w-[60%] border-b md:border-b-0 md:border-r border-gray-100">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <span className="font-mono text-xs text-orange-600 bg-orange-50 px-2 py-0.5 rounded font-bold">{order.orderNumber ? `#${order.orderNumber}` : order.id.slice(0, 8).toUpperCase()}</span>
                        <p className="text-xs text-gray-400 mt-1 font-medium">{fmt(order.createdAt)}</p>
                      </div>
                      <span className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black uppercase border ${cfg.badge}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                        {cfg.label}
                      </span>
                    </div>

                    {order.orderType === "scheduled" && order.scheduledFor && (
                      <div className="bg-cyan-50 border border-cyan-100 px-3 py-2 rounded-xl mb-4 flex items-center gap-2">
                        <span className="text-cyan-600">🗓️</span>
                        <div>
                          <p className="text-xs font-bold text-cyan-700 uppercase mb-0.5">Scheduled For</p>
                          <p className="text-sm text-cyan-800 font-bold">
                            {typeof order.scheduledFor === "string" 
                              ? new Date(order.scheduledFor).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })
                              : fmt(order.scheduledFor)}
                          </p>
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div>
                        <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-1">Customer</p>
                        <p className="font-bold text-gray-900">{order.customerName}</p>
                        <p className="text-sm text-gray-500">{order.phone}</p>
                        <p className="text-xs text-gray-400 italic mt-0.5 leading-relaxed">
                          {order.address}
                          {order.deliveryZoneName && <span className="block mt-0.5 font-bold text-gray-500">Zone: {order.deliveryZoneName}</span>}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-1">Items</p>
                        <div className="space-y-1">
                          {order.items.map((item, i) => (
                            <p key={i} className="text-sm text-gray-700">
                              <span className="font-black text-orange-600">{item.quantity}×</span> {item.name}
                            </p>
                          ))}
                        </div>
                      </div>
                    </div>

                    {order.note && (
                      <div className="bg-amber-50 border border-amber-100 px-3 py-2 rounded-xl">
                        <p className="text-xs font-bold text-amber-700 uppercase mb-0.5">Note</p>
                        <p className="text-sm text-amber-800">{order.note}</p>
                      </div>
                    )}
                  </div>

                  {/* Right */}
                  <div className="p-4 md:p-5 md:w-[40%] bg-gray-50 flex flex-col gap-4">
                    {/* Payment */}
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-400 font-bold uppercase">Payment</span>
                        <span className={`font-bold uppercase px-2 py-0.5 rounded-full text-xs ${order.paymentMethod === "online" ? "bg-blue-100 text-blue-700" : "bg-gray-200 text-gray-600"}`}>
                          {order.paymentMethod === "online" ? "Online" : "Cash"}
                        </span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-400 font-bold uppercase">Status</span>
                        <span className={`font-bold uppercase px-2 py-0.5 rounded-full text-xs ${order.paymentStatus === "paid" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
                          {order.paymentStatus === "paid" ? "Paid" : "Pending"}
                        </span>
                      </div>
                      {order.deliveryFee !== undefined && order.deliveryFee > 0 && (
                        <div className="flex justify-between text-xs text-gray-400">
                          <span>Items</span><span>₦{(order.itemsTotal ?? order.total - order.deliveryFee).toLocaleString("en-NG")}</span>
                        </div>
                      )}
                      {order.deliveryFee !== undefined && order.deliveryFee > 0 && (
                        <div className="flex justify-between text-xs text-gray-400">
                          <span>Delivery</span><span>₦{order.deliveryFee.toLocaleString("en-NG")}</span>
                        </div>
                      )}
                      <div className="flex justify-between font-black pt-1 border-t border-gray-200">
                        <span className="text-sm text-gray-600">Total</span>
                        <span className="text-xl text-gray-900">₦{order.total.toLocaleString("en-NG")}</span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="space-y-2 mt-auto">
                      {order.orderSource === "counter" ? (
                        <div className="flex flex-col items-center justify-center gap-1 p-3 bg-gray-50 border border-gray-100 rounded-2xl">
                          <span className="text-sm">🖥️ POS Transaction</span>
                          <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-orange-100 text-orange-800">
                            Fulfilled at Counter
                          </span>
                        </div>
                      ) : (
                        <>
                          {order.status === "scheduled" && (
                            <>
                              <button onClick={() => advance(order.id, "preparing")} disabled={busy} className="w-full py-4 rounded-2xl bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 text-white font-black text-sm uppercase tracking-widest transition-all active:scale-95">
                                {busy ? "…" : "Accept & Start Preparing"}
                              </button>
                              <button onClick={() => reject(order.id)} disabled={busy} className="w-full py-3.5 rounded-2xl bg-red-50 hover:bg-red-100 disabled:opacity-50 text-red-600 font-black text-sm uppercase tracking-widest transition-all border border-red-100">
                                {busy ? "…" : "Reject"}
                              </button>
                            </>
                          )}
                          {order.status === "pending" && (
                            <>
                              <button onClick={() => advance(order.id, "preparing")} disabled={busy} className="w-full py-4 rounded-2xl bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-black text-sm uppercase tracking-widest transition-all active:scale-95">
                                {busy ? "…" : "Accept Order"}
                              </button>
                              <button onClick={() => reject(order.id)} disabled={busy} className="w-full py-3.5 rounded-2xl bg-red-50 hover:bg-red-100 disabled:opacity-50 text-red-600 font-black text-sm uppercase tracking-widest transition-all border border-red-100">
                                {busy ? "…" : "Reject"}
                              </button>
                            </>
                          )}
                          {order.status === "preparing" && (
                            <button onClick={() => advance(order.id, "ready")} disabled={busy} className="w-full py-4 rounded-2xl bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-black text-sm uppercase tracking-widest transition-all active:scale-95">
                              {busy ? "…" : "Mark as Ready"}
                            </button>
                          )}
                          {order.status === "ready" && (
                            <button onClick={() => advance(order.id, "completed")} disabled={busy} className="w-full py-4 rounded-2xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-black text-sm uppercase tracking-widest transition-all active:scale-95">
                              {busy ? "…" : "Mark Completed"}
                            </button>
                          )}
                          {order.status === "completed" && (
                            <div className="flex items-center justify-center gap-2 text-green-600 font-bold text-sm py-2">
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
                              Fulfilled
                            </div>
                          )}
                          {order.status === "rejected" && (
                            <div className="flex items-center justify-center gap-2 text-red-500 font-bold text-sm py-2">
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                              Rejected
                            </div>
                          )}

                          {/* Secondary manual Reprint Action Button */}
                          <button
                            onClick={() => triggerPrint(order)}
                            className="w-full py-2.5 rounded-2xl bg-white hover:bg-gray-100 text-gray-700 border border-gray-250 font-bold text-xs uppercase tracking-widest transition-all active:scale-95 flex items-center justify-center gap-2"
                          >
                            🖨️ Print Receipt
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Hidden high-fidelity thermal kitchen/driver ticket template */}
      {printingOrder && (
        <div id="admin-receipt-print-area" className="hidden print:block bg-white text-black font-sans leading-none">
          <div className="text-center mb-1.5">
            <h2 className="text-xs font-black tracking-tight uppercase" style={{ fontSize: "11px", margin: "0 0 1px 0" }}>{restaurant.name}</h2>
            <p className="text-[8px] text-gray-500 font-extrabold uppercase" style={{ fontSize: "8px", margin: "0" }}>LIVE KITCHEN TICKET</p>
            <div className="border-b border-dashed border-black my-1" />
          </div>

          <div className="space-y-0.5" style={{ fontSize: "9px" }}>
            <div className="flex justify-between font-mono text-[8px]" style={{ fontSize: "8px" }}>
              <span>TICKET: #{printingOrder.orderNumber ? printingOrder.orderNumber : printingOrder.id.slice(0, 8).toUpperCase()}</span>
              <span>{fmt(printingOrder.createdAt)}</span>
            </div>
            <div className="flex justify-between font-black uppercase" style={{ fontSize: "9px", marginTop: "1px" }}>
              <span>SERVICE MODE:</span>
              <span className="underline">{printingOrder.deliveryType || "delivery"}</span>
            </div>
          </div>

          <div className="border-b border-dashed border-black my-1" />

          {/* Customer info */}
          <div className="space-y-0.5" style={{ fontSize: "9px" }}>
            <p className="font-black" style={{ fontSize: "10px", margin: "0" }}>{printingOrder.customerName}</p>
            <p className="font-bold" style={{ margin: "0" }}>{printingOrder.phone}</p>
            <p className="text-gray-600 leading-none" style={{ fontSize: "8px", margin: "0" }}>
              {printingOrder.address}
              {printingOrder.deliveryZoneName && ` (Zone: ${printingOrder.deliveryZoneName})`}
            </p>
          </div>

          {/* Special note */}
          {printingOrder.note && (
            <div className="mt-1 p-1 bg-gray-50 border border-gray-200 rounded leading-tight" style={{ fontSize: "8px" }}>
              <span className="font-black uppercase tracking-wider block text-gray-500" style={{ fontSize: "7px", marginBottom: "1px" }}>Kitchen Note:</span>
              "{printingOrder.note}"
            </div>
          )}

          <div className="border-b border-dashed border-black my-1" />

          {/* Items Table */}
          <div className="space-y-0.5">
            <div className="flex justify-between font-black text-gray-500 uppercase" style={{ fontSize: "8px" }}>
              <span>Qty × Item</span>
              <span>Price</span>
            </div>
            <div className="border-b border-dotted border-gray-400 my-0.5" />
            
            {printingOrder.items.map((item, idx) => (
              <div key={idx} className="flex justify-between items-start" style={{ fontSize: "9px" }}>
                <span className="font-bold flex-1 pr-1 leading-tight">
                  <span className="font-black text-black" style={{ fontSize: "11px" }}>{item.quantity}×</span> {item.name}
                </span>
                <span className="font-mono pl-1 shrink-0">₦{(item.price * item.quantity).toLocaleString("en-NG")}</span>
              </div>
            ))}
          </div>

          <div className="border-b border-dashed border-black my-1" />

          {/* Subtotal & delivery */}
          <div className="space-y-0.5" style={{ fontSize: "9px" }}>
            {printingOrder.deliveryFee !== undefined && printingOrder.deliveryFee > 0 && (
              <>
                <div className="flex justify-between font-medium">
                  <span>Subtotal:</span>
                  <span>₦{(printingOrder.itemsTotal ?? (printingOrder.total - printingOrder.deliveryFee)).toLocaleString("en-NG")}</span>
                </div>
                <div className="flex justify-between font-medium">
                  <span>Delivery:</span>
                  <span>₦{printingOrder.deliveryFee.toLocaleString("en-NG")}</span>
                </div>
              </>
            )}
            <div className="flex justify-between font-black pt-0.5 border-t border-dotted border-black" style={{ fontSize: "10px" }}>
              <span>TOTAL DUE:</span>
              <span>₦{printingOrder.total.toLocaleString("en-NG")}</span>
            </div>
          </div>

          <div className="border-b border-dashed border-black my-1" />

          {/* Payment metadata */}
          <div className="text-center space-y-0.5" style={{ fontSize: "8px" }}>
            <p className="font-black uppercase bg-gray-100 py-0.5 rounded" style={{ fontSize: "8px", margin: "0" }}>
              PAY: {printingOrder.paymentMethod === "online" ? "ONLINE" : "CASH"} ({printingOrder.paymentStatus === "paid" ? "PAID ✓" : "UNPAID"})
            </p>
            <p className="text-gray-400 font-bold mt-1" style={{ fontSize: "7px", margin: "2px 0 0 0" }}>RestoFlow POS · Thanks for your order!</p>
          </div>
        </div>
      )}

      {/* High-fidelity CSS injector to completely isolate printable receipt */}
      <style>{`
        @media print {
          body * {
            visibility: hidden !important;
            background: none !important;
          }
          #admin-receipt-print-area, #admin-receipt-print-area * {
            visibility: visible !important;
          }
          #admin-receipt-print-area {
            position: fixed !important;
            left: 6mm !important;
            top: 4mm !important;
            width: calc(100% - 8mm) !important;
            max-width: 50mm !important; /* Safe printable width on 58mm rolls */
            padding: 0 !important;
            margin: 0 !important;
            background: white !important;
            color: black !important;
            box-sizing: border-box !important;
          }
          @page {
            size: auto;
            margin: 0 !important; /* Removes all default browser headers, footers and margins */
          }
        }
      `}</style>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  const colors: Record<string, string> = {
    orange: "border-orange-100 bg-orange-50",
    green:  "border-green-100 bg-green-50",
    blue:   "border-blue-100 bg-blue-50",
    gray:   "border-gray-100 bg-white",
  };
  const textColors: Record<string, string> = {
    orange: "text-orange-700",
    green:  "text-green-700",
    blue:   "text-blue-700",
    gray:   "text-gray-700",
  };
  return (
    <div className={`border rounded-2xl p-4 ${colors[color]}`}>
      <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-xl font-black ${textColors[color]}`}>{value}</p>
    </div>
  );
}
