"use client";

import { useState, useEffect, useRef } from "react";
import { db } from "@/lib/firebase";
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  Timestamp,
} from "firebase/firestore";

// ── Types ────────────────────────────────────────────────────────────────────

type OrderStatus =
  | "pending"
  | "preparing"
  | "ready"
  | "completed"
  | "rejected"
  | "scheduled";

type OrderItem = { id: string; name: string; price: number; quantity: number };

type KitchenOrder = {
  id: string;
  customerName: string;
  note: string;
  items: OrderItem[];
  total: number;
  status: OrderStatus;
  paymentMethod?: string;
  paymentStatus?: string;
  orderSource?: string;
  deliveryType?: string;
  orderType?: string;
  scheduledFor?: string | Timestamp;
  createdAt: Timestamp;
};

type ColKey = "pending" | "preparing" | "ready" | "completed";

type Props = {
  restaurant: { slug: string; name: string };
  role: string;
};

// ── Sound ────────────────────────────────────────────────────────────────────

function playKitchenBell() {
  try {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const ctx = new AC();
    // Ascending three-tone kitchen chime: 660 → 880 → 1100 Hz
    const tones: [number, number, number][] = [
      [660, 0, 0.45],
      [880, 0.22, 0.38],
      [1100, 0.44, 0.28],
    ];
    tones.forEach(([freq, delay, vol]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, ctx.currentTime + delay);
      gain.gain.linearRampToValueAtTime(vol, ctx.currentTime + delay + 0.015);
      gain.gain.exponentialRampToValueAtTime(
        0.001,
        ctx.currentTime + delay + 0.65
      );
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + 0.7);
    });
  } catch {
    /* AudioContext unavailable — skip silently */
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getLagosStartOfDay(): Date {
  const lagosNow = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Africa/Lagos" })
  );
  lagosNow.setHours(0, 0, 0, 0);
  return lagosNow;
}

function getElapsed(ts: Timestamp, now: Date): { label: string; level: "normal" | "warn" | "urgent" } {
  if (!ts?.toDate) return { label: "Just now", level: "normal" };
  const mins = Math.floor((now.getTime() - ts.toDate().getTime()) / 60000);
  if (mins < 1) return { label: "Just now", level: "normal" };
  if (mins < 10) return { label: `${mins}m ago`, level: "normal" };
  if (mins < 20) return { label: `${mins}m ago`, level: "warn" };
  if (mins < 60) return { label: `${mins}m ago`, level: "urgent" };
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return { label: `${h}h${m > 0 ? ` ${m}m` : ""}`, level: "urgent" };
}

function fmtTime(ts: Timestamp): string {
  if (!ts?.toDate) return "";
  return ts.toDate().toLocaleTimeString("en-NG", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── Column config ─────────────────────────────────────────────────────────────

const COLS: {
  key: ColKey;
  label: string;
  headerCls: string;
  nextStatus: string | null;
  actionLabel: string | null;
  actionCls: string;
}[] = [
  {
    key: "pending",
    label: "NEW",
    headerCls: "bg-amber-500",
    nextStatus: "preparing",
    actionLabel: "▶  Start Preparing",
    actionCls:
      "bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white",
  },
  {
    key: "preparing",
    label: "PREPARING",
    headerCls: "bg-blue-600",
    nextStatus: "ready",
    actionLabel: "✓  Mark Ready",
    actionCls:
      "bg-green-600 hover:bg-green-500 active:bg-green-700 text-white",
  },
  {
    key: "ready",
    label: "READY",
    headerCls: "bg-green-600",
    nextStatus: "completed",
    actionLabel: "⊹  Mark Served",
    actionCls:
      "bg-purple-600 hover:bg-purple-500 active:bg-purple-700 text-white",
  },
  {
    key: "completed",
    label: "SERVED",
    headerCls: "bg-gray-600",
    nextStatus: null,
    actionLabel: null,
    actionCls: "",
  },
];

// ── Main component ────────────────────────────────────────────────────────────

export default function KitchenClient({ restaurant }: Props) {
  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [muted, setMuted] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("rf_kitchen_muted") === "true";
  });
  const [updating, setUpdating] = useState<string | null>(null);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [now, setNow] = useState(() => new Date());

  const prevIds = useRef<Set<string>>(new Set());
  const firstLoad = useRef(true);
  const mutedRef = useRef(muted);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  // Live clock
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Firestore real-time listener — today's orders for this restaurant
  useEffect(() => {
    const startOfDay = getLagosStartOfDay();

    const q = query(
      collection(db, "orders"),
      where("restaurantId", "==", restaurant.slug),
      where("createdAt", ">=", Timestamp.fromDate(startOfDay)),
      orderBy("createdAt", "desc")
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const data = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<KitchenOrder, "id">),
        }));
        setOrders(data);
        setLoading(false);

        const currentIds = new Set(snap.docs.map((d) => d.id));

        if (firstLoad.current) {
          firstLoad.current = false;
          prevIds.current = currentIds;
          return;
        }

        // New arriving orders (not rejected/completed)
        const added = [...currentIds].filter((id) => {
          if (prevIds.current.has(id)) return false;
          const o = data.find((x) => x.id === id);
          return o && !["completed", "rejected"].includes(o.status);
        });

        if (added.length > 0) {
          if (!mutedRef.current) playKitchenBell();
          setNewIds((prev) => new Set([...prev, ...added]));
          setTimeout(() => {
            setNewIds((prev) => {
              const next = new Set(prev);
              added.forEach((id) => next.delete(id));
              return next;
            });
          }, 12000);
        }

        prevIds.current = currentIds;
      },
      (err) => {
        console.error("Kitchen Firestore error:", err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [restaurant.slug]);

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    localStorage.setItem("rf_kitchen_muted", next.toString());
    // Play a test chime when unmuting so staff knows it works
    if (!next) setTimeout(playKitchenBell, 50);
  };

  const advance = async (orderId: string, status: string) => {
    if (updating) return;
    setUpdating(orderId);
    try {
      await fetch(`/api/orders/${orderId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
    } catch {
      // Real-time listener will show the authoritative state
    } finally {
      setUpdating(null);
    }
  };

  // Partition orders into kanban columns
  const pending = orders.filter((o) => o.status === "pending" || o.status === "scheduled");
  const preparing = orders.filter((o) => o.status === "preparing");
  const ready = orders.filter((o) => o.status === "ready");
  // Limit served column to 20 most recent to avoid clutter
  const served = orders.filter((o) => o.status === "completed").slice(0, 20);

  const colOrders: Record<ColKey, KitchenOrder[]> = {
    pending,
    preparing,
    ready,
    completed: served,
  };

  const activeCount = pending.length + preparing.length + ready.length;

  return (
    <div
      className="flex flex-col bg-[#0f1117] overflow-hidden"
      style={{ flex: 1, minHeight: 0 }}
    >
      {/* ── Top bar ────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-[#16181f] border-b border-white/5 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="font-black text-white text-sm leading-tight">
              {restaurant.name}
            </h1>
            <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">
              Kitchen Display
            </p>
          </div>
          {activeCount > 0 && (
            <div className="flex items-center gap-1.5 bg-orange-500/15 border border-orange-500/25 px-2.5 py-1 rounded-full">
              <span className="w-1.5 h-1.5 bg-orange-400 rounded-full animate-pulse flex-shrink-0" />
              <span className="text-[11px] font-black text-orange-300">
                {activeCount} active
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[13px] text-white/40 tabular-nums hidden sm:block">
            {now.toLocaleTimeString("en-NG", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </span>
          <button
            onClick={toggleMute}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold transition-colors border ${
              muted
                ? "bg-red-900/40 text-red-300 border-red-800/60 hover:bg-red-900/60"
                : "bg-white/8 text-white/60 border-white/10 hover:bg-white/15"
            }`}
          >
            {muted ? "🔇 Muted" : "🔔 Sound On"}
          </button>
        </div>
      </div>

      {/* ── Kanban board ───────────────────────────────────────────── */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-10 h-10 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-gray-500 font-bold text-sm">Loading kitchen…</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 grid grid-cols-2 lg:grid-cols-4 min-h-0 overflow-hidden divide-x divide-white/5">
          {COLS.map((col) => {
            const colList = colOrders[col.key];
            return (
              <div key={col.key} className="flex flex-col min-h-0">
                {/* Column header */}
                <div
                  className={`${col.headerCls} px-3 py-2 flex items-center justify-between flex-shrink-0`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full bg-white/70 flex-shrink-0 ${
                        colList.length > 0 ? "animate-pulse" : "opacity-40"
                      }`}
                    />
                    <span className="font-black text-white text-[11px] uppercase tracking-widest">
                      {col.label}
                    </span>
                  </div>
                  <span className="bg-black/25 text-white/80 font-black text-xs px-2 py-0.5 rounded-full tabular-nums">
                    {colList.length}
                  </span>
                </div>

                {/* Cards */}
                <div className="flex-1 overflow-y-auto p-2 space-y-2 scrollbar-none">
                  {colList.length === 0 ? (
                    <p className="text-center text-white/15 text-xs font-bold py-10">
                      Empty
                    </p>
                  ) : (
                    colList.map((order) => (
                      <KitchenCard
                        key={order.id}
                        order={order}
                        col={col}
                        isNew={newIds.has(order.id)}
                        elapsed={getElapsed(order.createdAt, now)}
                        createdTime={fmtTime(order.createdAt)}
                        busy={updating === order.id}
                        onAdvance={advance}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Kitchen card ──────────────────────────────────────────────────────────────

type ColCfg = (typeof COLS)[number];

function KitchenCard({
  order,
  col,
  isNew,
  elapsed,
  createdTime,
  busy,
  onAdvance,
}: {
  order: KitchenOrder;
  col: ColCfg;
  isNew: boolean;
  elapsed: { label: string; level: "normal" | "warn" | "urgent" };
  createdTime: string;
  busy: boolean;
  onAdvance: (id: string, status: string) => void;
}) {
  const isCounter = order.orderSource === "counter";
  const shortId = order.id.slice(-6).toUpperCase();
  const isScheduled = order.orderType === "scheduled" || order.status === "scheduled";

  const elapsedColor =
    elapsed.level === "urgent"
      ? "text-red-400"
      : elapsed.level === "warn"
      ? "text-yellow-400"
      : "text-white/30";

  const payStatusColor =
    order.paymentStatus === "paid"
      ? "bg-green-900/50 text-green-400 border-green-800/40"
      : order.paymentStatus === "part_paid"
      ? "bg-yellow-900/50 text-yellow-400 border-yellow-800/40"
      : order.paymentStatus === "unpaid"
      ? "bg-red-900/50 text-red-400 border-red-800/40"
      : "bg-white/8 text-white/30 border-white/10";

  const deliveryLabel =
    order.deliveryType === "counter"
      ? "Counter"
      : order.deliveryType === "pickup"
      ? "Pickup"
      : order.deliveryType === "delivery"
      ? "Delivery"
      : "";

  return (
    <div
      className={`rounded-2xl border overflow-hidden transition-all ${
        isNew
          ? "border-amber-400/50 bg-amber-950/30 ring-1 ring-amber-400/25 shadow-lg shadow-amber-500/10"
          : col.key === "pending"
          ? "border-amber-800/30 bg-[#1c1a12]"
          : col.key === "preparing"
          ? "border-blue-800/30 bg-[#111827]"
          : col.key === "ready"
          ? "border-green-800/30 bg-[#0f1f14]"
          : "border-white/6 bg-[#16181f]"
      }`}
    >
      {/* New order banner */}
      {isNew && (
        <div className="bg-amber-500 text-black text-[10px] font-black uppercase tracking-widest text-center py-1 animate-pulse">
          New Order!
        </div>
      )}
      {/* Scheduled banner */}
      {isScheduled && (
        <div className="bg-cyan-700 text-white text-[10px] font-black uppercase tracking-widest text-center py-1">
          Scheduled
        </div>
      )}

      <div className="p-3 space-y-2.5">
        {/* Header: ID + source + elapsed */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-mono text-orange-400 font-black text-sm leading-none">
              #{shortId}
            </p>
            <div className="flex items-center gap-1 mt-1">
              <span
                className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full border ${
                  isCounter
                    ? "bg-orange-500/15 text-orange-300 border-orange-500/20"
                    : "bg-blue-500/15 text-blue-300 border-blue-500/20"
                }`}
              >
                {isCounter ? "Counter" : "Online"}
              </span>
              {deliveryLabel && (
                <span className="text-[10px] font-bold text-white/25 uppercase">
                  · {deliveryLabel}
                </span>
              )}
            </div>
          </div>
          <div className="text-right flex-shrink-0">
            <p className={`text-xs font-black tabular-nums leading-tight ${elapsedColor}`}>
              {elapsed.label}
            </p>
            {elapsed.level === "urgent" && (
              <p className="text-[9px] font-black text-red-500 uppercase leading-tight mt-0.5">
                Delayed
              </p>
            )}
            <p className="text-[10px] text-white/20 mt-0.5">{createdTime}</p>
          </div>
        </div>

        {/* Customer name */}
        <div>
          <p className="text-[10px] text-white/25 font-bold uppercase tracking-widest leading-none mb-0.5">
            Customer
          </p>
          <p className="text-white font-bold text-sm leading-tight">
            {order.customerName || "Walk-in"}
          </p>
        </div>

        {/* Items — large and clear */}
        <div className="space-y-1">
          {order.items.map((item, i) => (
            <div key={i} className="flex items-baseline gap-2">
              <span className="text-orange-400 font-black text-base w-7 flex-shrink-0 leading-tight tabular-nums">
                {item.quantity}×
              </span>
              <span className="text-white font-bold text-sm leading-tight">
                {item.name}
              </span>
            </div>
          ))}
        </div>

        {/* Note — highlighted */}
        {order.note && (
          <div className="bg-amber-950/60 border border-amber-500/20 rounded-xl px-2.5 py-2">
            <p className="text-[10px] font-black text-amber-400 uppercase tracking-widest leading-none mb-1">
              Note
            </p>
            <p className="text-amber-200 text-sm font-semibold leading-snug">
              {order.note}
            </p>
          </div>
        )}

        {/* Payment status */}
        <div className="flex items-center gap-2">
          <span
            className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${payStatusColor}`}
          >
            {order.paymentStatus ?? "—"}
          </span>
          {order.paymentMethod && (
            <span className="text-[10px] text-white/25 font-bold capitalize">
              {order.paymentMethod === "bank_transfer"
                ? "Bank Transfer"
                : order.paymentMethod}
            </span>
          )}
        </div>

        {/* Action button */}
        {col.nextStatus && col.actionLabel ? (
          <button
            disabled={busy}
            onClick={() => onAdvance(order.id, col.nextStatus!)}
            className={`w-full py-3 rounded-xl font-black text-xs uppercase tracking-widest transition-all disabled:opacity-40 disabled:cursor-not-allowed ${col.actionCls}`}
          >
            {busy ? "Updating…" : col.actionLabel}
          </button>
        ) : col.key === "completed" ? (
          <div className="flex items-center justify-center gap-1.5 text-white/20 text-xs font-bold py-1.5">
            ✓ Served
          </div>
        ) : null}
      </div>
    </div>
  );
}
