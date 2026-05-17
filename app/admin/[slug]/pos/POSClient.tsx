"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { db } from "@/lib/firebase";
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  Timestamp,
} from "firebase/firestore";

// ── Types ─────────────────────────────────────────────────────────────────────

type MenuItem = {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  available: boolean;
  image: string;
};

type CartItem = MenuItem & { quantity: number };

type ServiceMode = "counter" | "dine_in";
type PaymentMethod = "cash" | "bank_transfer" | "card" | "unpaid";
type PaymentStatus = "paid" | "unpaid" | "part_paid" | "cancelled";

type CompletedOrder = {
  orderId: string;
  items: { id: string; name: string; price: number; quantity: number }[];
  itemsTotal: number;
  total: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  customerName: string;
  note: string;
  serviceMode: ServiceMode;
  tableLabel: string;
  createdAt: Date;
};

// Full order snapshot from Firestore (used for ready-order tracking + open bills)
type TodayOrder = {
  id: string;
  customerName: string;
  items: { id: string; name: string; price: number; quantity: number }[];
  itemsTotal: number;
  total: number;
  paymentMethod: string;
  paymentStatus: string;
  note: string;
  orderSource: string;
  serviceMode?: string;
  tableLabel?: string;
  staffName?: string;
  deliveryType?: string;
  orderType?: string;
  parentTabId?: string;
  itemBatches?: { batchIndex: number; addedAt: string; staffId: string; staffName: string; items: { id: string; name: string; price: number; quantity: number }[]; addOnTotal: number }[];
  status: string;
  createdAt: Timestamp;
};

type AddOnReceipt = {
  tabId: string;
  kitchenTicketId: string;
  tableLabel: string;
  addedItems: { id: string; name: string; price: number; quantity: number }[];
  addOnTotal: number;
  newTotal: number;
  batchIndex: number;
};

type SettlementResult = {
  orderId: string;
  tableLabel: string;
  total: number;
  paymentMethod: string;
  paidAt: Date;
  staffName: string;
};

type Props = {
  restaurant: { slug: string; name: string };
  menuItems: MenuItem[];
  staffName: string;
  staffId: string;
};

// ── Labels ────────────────────────────────────────────────────────────────────

const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  bank_transfer: "Bank Transfer",
  card: "Card / POS Machine",
  unpaid: "Unpaid / Pay Later",
};

const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  paid: "Paid",
  unpaid: "Unpaid",
  part_paid: "Part Paid",
  cancelled: "Cancelled",
};

// Quick-tap table numbers shown in the dine-in table selector
const QUICK_TABLES = Array.from({ length: 16 }, (_, i) => i + 1);

function fmt(n: number) {
  return `₦${n.toLocaleString("en-NG")}`;
}

function getLagosStartOfDay(): Date {
  const d = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Africa/Lagos" })
  );
  d.setHours(0, 0, 0, 0);
  return d;
}

// ── Cashier alert sound (descending doorbell: 880 → 660 Hz) ──────────────────

function playCashierAlert() {
  try {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const ctx = new AC();
    const tones: [number, number, number][] = [
      [880, 0, 0.5],
      [660, 0.3, 0.45],
    ];
    tones.forEach(([freq, delay, vol]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, ctx.currentTime + delay);
      gain.gain.linearRampToValueAtTime(vol, ctx.currentTime + delay + 0.012);
      gain.gain.exponentialRampToValueAtTime(
        0.001,
        ctx.currentTime + delay + 0.58
      );
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + 0.62);
    });
  } catch {
    /* AudioContext unavailable */
  }
}

// ── Reprint via popup window ──────────────────────────────────────────────────

function openReprintWindow(
  order: TodayOrder,
  restaurantName: string,
  staffName: string
) {
  const createdAt = order.createdAt?.toDate?.() ?? new Date();
  const dateStr = createdAt.toLocaleDateString("en-NG", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const timeStr = createdAt.toLocaleTimeString("en-NG", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const isDineIn = order.serviceMode === "dine_in";

  const pmLabels: Record<string, string> = {
    cash: "Cash",
    bank_transfer: "Bank Transfer",
    card: "Card / POS Machine",
    unpaid: "Unpaid / Pay Later",
  };
  const psLabels: Record<string, string> = {
    paid: "Paid",
    unpaid: "Unpaid",
    part_paid: "Part Paid",
    cancelled: "Cancelled",
  };

  const itemsHtml = order.items
    .map(
      (i) =>
        `<div class="row"><span class="qty">${i.quantity}×</span><span class="name">${i.name}</span><span class="price">₦${(i.price * i.quantity).toLocaleString("en-NG")}</span></div>`
    )
    .join("");

  const sourceHtml = isDineIn
    ? `<div class="kv"><span class="kl">Service</span><span class="kv-v">Dine-In</span></div>
       <div class="kv"><span class="kl">Table</span><span class="kv-v kv-table">${order.tableLabel ?? ""}</span></div>`
    : `<div class="kv"><span class="kl">Source</span><span class="kv-v">Counter / POS</span></div>`;

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Receipt #${order.id.slice(-8).toUpperCase()}</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,system-ui,sans-serif;font-size:13px;max-width:300px;margin:0 auto;padding:20px 10px}
    .center{text-align:center}
    .lbl{font-size:9px;font-weight:800;letter-spacing:3px;text-transform:uppercase;color:#999;margin-bottom:4px}
    h1{font-size:18px;font-weight:900;margin-bottom:4px}
    .service-badge{display:inline-block;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:1px;padding:3px 10px;border-radius:20px;margin-bottom:6px;${isDineIn ? "background:#e0f2f1;color:#00796b" : "background:#fff3e0;color:#e65100"}}
    .table-lbl{font-size:16px;font-weight:900;color:#00796b;margin-bottom:4px}
    .meta{font-size:11px;color:#777}
    .div{border-top:1px dashed #ddd;margin:10px 0}
    .row{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin:4px 0}
    .qty{font-weight:900;color:#777;flex-shrink:0}
    .name{font-weight:600;flex:1}
    .price{font-weight:700;flex-shrink:0}
    .kv{display:flex;justify-content:space-between;font-size:12px;margin:3px 0}
    .kl{color:#777;font-weight:600}
    .kv-v{font-weight:700}
    .kv-table{font-size:14px;color:#00796b}
    .total{display:flex;justify-content:space-between;font-size:15px;font-weight:900;margin-top:6px}
    .badge{font-size:9px;font-weight:800;text-transform:uppercase;padding:2px 6px;border-radius:20px;background:#f0f0f0}
    .footer{text-align:center;color:#bbb;font-size:10px;margin-top:16px}
    @media print{body{margin:0;padding:8px}}
  </style>
</head>
<body>
  <div class="center">
    <div class="lbl">Restaflow POS · Reprint</div>
    <h1>${restaurantName}</h1>
    <div class="service-badge">${isDineIn ? "Dine-In" : "Counter Pickup"}</div>
    ${isDineIn && order.tableLabel ? `<div class="table-lbl">${order.tableLabel}</div>` : ""}
    <div class="meta">${dateStr} · ${timeStr}</div>
  </div>
  <div class="div"></div>
  <div class="kv"><span class="kl">Order #</span><span class="kv-v" style="font-family:monospace">${order.id.slice(-8).toUpperCase()}</span></div>
  ${order.customerName && order.customerName !== order.tableLabel ? `<div class="kv"><span class="kl">Customer</span><span class="kv-v">${order.customerName}</span></div>` : ""}
  <div class="kv"><span class="kl">Cashier</span><span class="kv-v">${staffName}</span></div>
  ${sourceHtml}
  <div class="div"></div>
  ${itemsHtml}
  <div class="div"></div>
  <div class="kv"><span class="kl">Subtotal</span><span class="kv-v">₦${(order.itemsTotal ?? order.total).toLocaleString("en-NG")}</span></div>
  <div class="total"><span>Total</span><span>₦${order.total.toLocaleString("en-NG")}</span></div>
  <div class="div"></div>
  <div class="kv"><span class="kl">Payment</span><span class="kv-v">${pmLabels[order.paymentMethod] ?? order.paymentMethod}</span></div>
  <div class="kv"><span class="kl">Status</span><span class="badge">${psLabels[order.paymentStatus] ?? order.paymentStatus}</span></div>
  ${order.note ? `<div class="kv"><span class="kl">Note</span><span class="kv-v">${order.note}</span></div>` : ""}
  <div class="footer"><div>Thank you!</div><div>Powered by Restaflow</div></div>
  <script>window.onload=function(){setTimeout(function(){window.print();},80)};</script>
</body>
</html>`;

  const w = window.open(
    "",
    "_blank",
    "width=380,height=680,menubar=no,toolbar=no,scrollbars=yes"
  );
  if (w) {
    w.document.write(html);
    w.document.close();
  }
}

// ── Add-on receipt popup ──────────────────────────────────────────────────────

function openAddOnReprintWindow(receipt: AddOnReceipt, restaurantName: string, staffName: string) {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-NG", { weekday: "short", year: "numeric", month: "short", day: "numeric" });
  const timeStr = now.toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" });

  const itemsHtml = receipt.addedItems
    .map((i) => `<div class="row"><span class="qty">${i.quantity}×</span><span class="name">${i.name}</span><span class="price">₦${(i.price * i.quantity).toLocaleString("en-NG")}</span></div>`)
    .join("");

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Add-On · ${receipt.tableLabel} · #${receipt.kitchenTicketId.slice(-8).toUpperCase()}</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,system-ui,sans-serif;font-size:13px;max-width:300px;margin:0 auto;padding:20px 10px}
    .center{text-align:center}
    .lbl{font-size:9px;font-weight:800;letter-spacing:3px;text-transform:uppercase;color:#999;margin-bottom:4px}
    h1{font-size:18px;font-weight:900;margin-bottom:4px}
    .badge{display:inline-block;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:1px;padding:3px 10px;border-radius:20px;margin-bottom:4px;background:#e0f2f1;color:#00796b}
    .addon-badge{display:inline-block;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:1px;padding:3px 10px;border-radius:20px;background:#f0fdf4;color:#15803d;border:1px solid #bbf7d0}
    .table-lbl{font-size:18px;font-weight:900;color:#00796b;margin:4px 0}
    .meta{font-size:11px;color:#777}
    .div{border-top:1px dashed #ddd;margin:10px 0}
    .row{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin:4px 0}
    .qty{font-weight:900;color:#777;flex-shrink:0}
    .name{font-weight:600;flex:1}
    .price{font-weight:700;flex-shrink:0}
    .kv{display:flex;justify-content:space-between;font-size:12px;margin:3px 0}
    .kl{color:#777;font-weight:600}
    .kv-v{font-weight:700}
    .total{display:flex;justify-content:space-between;font-size:14px;font-weight:900;margin-top:4px}
    .running{display:flex;justify-content:space-between;font-size:12px;margin-top:6px;color:#555}
    .footer{text-align:center;color:#bbb;font-size:10px;margin-top:16px}
    @media print{body{margin:0;padding:8px}}
  </style>
</head>
<body>
  <div class="center">
    <div class="lbl">Restaflow POS · Add-On Receipt</div>
    <h1>${restaurantName}</h1>
    <div class="badge">Dine-In</div><br/>
    <div class="addon-badge">Add-On Order ${receipt.batchIndex > 0 ? `#${receipt.batchIndex}` : ""}</div>
    <div class="table-lbl">${receipt.tableLabel}</div>
    <div class="meta">${dateStr} · ${timeStr}</div>
  </div>
  <div class="div"></div>
  <div class="kv"><span class="kl">Ticket #</span><span class="kv-v" style="font-family:monospace">${receipt.kitchenTicketId.slice(-8).toUpperCase()}</span></div>
  <div class="kv"><span class="kl">Tab #</span><span class="kv-v" style="font-family:monospace">${receipt.tabId.slice(-8).toUpperCase()}</span></div>
  <div class="kv"><span class="kl">Added by</span><span class="kv-v">${staffName}</span></div>
  <div class="div"></div>
  <div class="kl" style="margin-bottom:6px">Items Added</div>
  ${itemsHtml}
  <div class="div"></div>
  <div class="total"><span>Added This Round</span><span>₦${receipt.addOnTotal.toLocaleString("en-NG")}</span></div>
  <div class="running"><span>Running Tab Total</span><span>₦${receipt.newTotal.toLocaleString("en-NG")}</span></div>
  <div class="footer"><div>Items sent to kitchen</div><div>Powered by Restaflow</div></div>
  <script>window.onload=function(){setTimeout(function(){window.print();},80)};</script>
</body>
</html>`;

  const w = window.open("", "_blank", "width=380,height=640,menubar=no,toolbar=no,scrollbars=yes");
  if (w) { w.document.write(html); w.document.close(); }
}

// ── Settled-bill receipt popup ────────────────────────────────────────────────

function openSettledBillWindow(order: TodayOrder, result: SettlementResult, restaurantName: string) {
  const paidAt = result.paidAt;
  const dateStr = paidAt.toLocaleDateString("en-NG", { weekday: "short", year: "numeric", month: "short", day: "numeric" });
  const timeStr = paidAt.toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" });

  const pmLabels: Record<string, string> = {
    cash: "Cash", bank_transfer: "Bank Transfer", card: "Card / POS Machine",
  };

  const itemsHtml = order.items
    .map((i) => `<div class="row"><span class="qty">${i.quantity}×</span><span class="name">${i.name}</span><span class="price">₦${(i.price * i.quantity).toLocaleString("en-NG")}</span></div>`)
    .join("");

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Receipt · ${result.tableLabel} · #${order.id.slice(-8).toUpperCase()}</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,system-ui,sans-serif;font-size:13px;max-width:300px;margin:0 auto;padding:20px 10px}
    .center{text-align:center}
    .lbl{font-size:9px;font-weight:800;letter-spacing:3px;text-transform:uppercase;color:#999;margin-bottom:4px}
    h1{font-size:18px;font-weight:900;margin-bottom:4px}
    .badge{display:inline-block;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:1px;padding:3px 10px;border-radius:20px;margin-bottom:4px;background:#e0f2f1;color:#00796b}
    .paid-badge{display:inline-block;font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:1px;padding:4px 14px;border-radius:20px;background:#dcfce7;color:#15803d;margin-top:6px}
    .table-lbl{font-size:18px;font-weight:900;color:#00796b;margin:4px 0}
    .meta{font-size:11px;color:#777}
    .div{border-top:1px dashed #ddd;margin:10px 0}
    .row{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin:4px 0}
    .qty{font-weight:900;color:#777;flex-shrink:0}
    .name{font-weight:600;flex:1}
    .price{font-weight:700;flex-shrink:0}
    .kv{display:flex;justify-content:space-between;font-size:12px;margin:3px 0}
    .kl{color:#777;font-weight:600}
    .kv-v{font-weight:700}
    .total{display:flex;justify-content:space-between;font-size:15px;font-weight:900;margin-top:6px}
    .footer{text-align:center;color:#bbb;font-size:10px;margin-top:16px}
    @media print{body{margin:0;padding:8px}}
  </style>
</head>
<body>
  <div class="center">
    <div class="lbl">Restaflow POS · Bill Settlement</div>
    <h1>${restaurantName}</h1>
    <div class="badge">Dine-In</div>
    <div class="table-lbl">${result.tableLabel}</div>
    <div class="paid-badge">✓ PAID</div>
    <div class="meta" style="margin-top:6px">${dateStr} · ${timeStr}</div>
  </div>
  <div class="div"></div>
  <div class="kv"><span class="kl">Order #</span><span class="kv-v" style="font-family:monospace">${order.id.slice(-8).toUpperCase()}</span></div>
  ${order.customerName && order.customerName !== order.tableLabel ? `<div class="kv"><span class="kl">Guest</span><span class="kv-v">${order.customerName}</span></div>` : ""}
  <div class="kv"><span class="kl">Settled by</span><span class="kv-v">${result.staffName}</span></div>
  <div class="div"></div>
  ${itemsHtml}
  <div class="div"></div>
  <div class="kv"><span class="kl">Subtotal</span><span class="kv-v">₦${(order.itemsTotal ?? order.total).toLocaleString("en-NG")}</span></div>
  <div class="total"><span>Total</span><span>₦${order.total.toLocaleString("en-NG")}</span></div>
  <div class="div"></div>
  <div class="kv"><span class="kl">Payment</span><span class="kv-v">${pmLabels[result.paymentMethod] ?? result.paymentMethod}</span></div>
  <div class="kv"><span class="kl">Status</span><span class="kv-v" style="color:#15803d;font-weight:900">PAID</span></div>
  <div class="footer"><div>Thank you for dining with us!</div><div>Powered by Restaflow</div></div>
  <script>window.onload=function(){setTimeout(function(){window.print();},80)};</script>
</body>
</html>`;

  const w = window.open("", "_blank", "width=380,height=720,menubar=no,toolbar=no,scrollbars=yes");
  if (w) { w.document.write(html); w.document.close(); }
}

// ── POSClient ─────────────────────────────────────────────────────────────────

export default function POSClient({ restaurant, menuItems, staffName }: Props) {
  // Order entry state
  const [serviceMode, setServiceMode] = useState<ServiceMode>("counter");
  const [tableLabel, setTableLabel] = useState("");
  const [tableLabelInput, setTableLabelInput] = useState(""); // free-text field
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>("paid");
  const [customerName, setCustomerName] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completedOrder, setCompletedOrder] = useState<CompletedOrder | null>(null);

  // Ready-order alert state
  const [readyOrders, setReadyOrders] = useState<TodayOrder[]>([]);
  const [alertMuted, setAlertMuted] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("rf_pos_muted") === "true";
  });
  const [servingId, setServingId] = useState<string | null>(null);
  const [alertCollapsed, setAlertCollapsed] = useState(false);

  // Open bills state
  const [openBills, setOpenBills] = useState<TodayOrder[]>([]);
  const [rightTab, setRightTab] = useState<"order" | "bills">("order");
  const [settleBillId, setSettleBillId] = useState<string | null>(null);
  const [settlementResult, setSettlementResult] = useState<SettlementResult | null>(null);

  // Tab continuation state
  const [tabMode, setTabMode] = useState<"new" | "continue">("new");
  const [activeTab, setActiveTab] = useState<TodayOrder | null>(null);
  const [openTabPromptDismissed, setOpenTabPromptDismissed] = useState(false);
  const [addOnReceipt, setAddOnReceipt] = useState<AddOnReceipt | null>(null);

  const prevReadyIds = useRef<Set<string>>(new Set());
  const firstReadyLoad = useRef(true);
  const mutedRef = useRef(alertMuted);
  useEffect(() => {
    mutedRef.current = alertMuted;
  }, [alertMuted]);

  // Switch service mode: auto-default payment status for the mode
  const switchServiceMode = (mode: ServiceMode) => {
    setServiceMode(mode);
    setTableLabel("");
    setTableLabelInput("");
    setTabMode("new");
    setActiveTab(null);
    setOpenTabPromptDismissed(false);
    if (mode === "dine_in") {
      setPaymentStatus("unpaid");
    } else {
      setPaymentStatus("paid");
    }
  };

  // ── Ready-order Firestore listener ────────────────────────────────────────
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
          ...(d.data() as Omit<TodayOrder, "id">),
        }));

        // Show ready alerts for both counter and dine-in POS orders
        const ready = data.filter(
          (o) => o.orderSource === "counter" && o.status === "ready"
        );
        setReadyOrders(ready);

        // Open dine-in bills: unpaid, not cancelled, not add-on kitchen tickets
        const bills = data.filter(
          (o) =>
            (o.serviceMode === "dine_in" || o.deliveryType === "dine_in") &&
            (o.paymentStatus === "unpaid" || o.paymentStatus === "part_paid") &&
            o.status !== "rejected" &&
            o.orderType !== "addon"
        );
        setOpenBills(bills);

        const currentReadyIds = new Set(ready.map((o) => o.id));

        if (firstReadyLoad.current) {
          firstReadyLoad.current = false;
          prevReadyIds.current = currentReadyIds;
          return;
        }

        const newlyReady = [...currentReadyIds].filter(
          (id) => !prevReadyIds.current.has(id)
        );
        if (newlyReady.length > 0 && !mutedRef.current) {
          playCashierAlert();
        }

        prevReadyIds.current = currentReadyIds;
      },
      () => {
        /* Firestore error — listener retries automatically */
      }
    );

    return () => unsub();
  }, [restaurant.slug]);

  const toggleAlertMute = () => {
    const next = !alertMuted;
    setAlertMuted(next);
    localStorage.setItem("rf_pos_muted", next.toString());
    if (!next) setTimeout(playCashierAlert, 60);
  };

  const markServed = async (orderId: string) => {
    if (servingId) return;
    setServingId(orderId);
    try {
      await fetch(`/api/orders/${orderId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
      });
    } catch {
      /* Firestore listener holds authoritative state */
    } finally {
      setServingId(null);
    }
  };

  // ── Menu helpers ──────────────────────────────────────────────────────────

  const categories = useMemo(() => {
    const cats = Array.from(
      new Set(menuItems.map((i) => i.category).filter(Boolean))
    ).sort();
    return ["All", ...cats];
  }, [menuItems]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return menuItems.filter((item) => {
      if (!item.available) return false;
      if (activeCategory !== "All" && item.category !== activeCategory)
        return false;
      if (q && !item.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [menuItems, activeCategory, search]);

  const cartTotal = useMemo(
    () => cart.reduce((sum, item) => sum + item.price * item.quantity, 0),
    [cart]
  );
  const cartCount = useMemo(
    () => cart.reduce((sum, item) => sum + item.quantity, 0),
    [cart]
  );

  // Detect an existing open tab for the currently selected dine-in table
  const openTabForTable = useMemo(() => {
    const resolved = (tableLabelInput.trim() || tableLabel).trim();
    if (!resolved || serviceMode !== "dine_in") return null;
    return openBills.find((o) => (o.tableLabel ?? "").trim() === resolved) ?? null;
  }, [tableLabelInput, tableLabel, serviceMode, openBills]);

  const addToCart = useCallback((item: MenuItem) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.id === item.id);
      if (existing) {
        return prev.map((c) =>
          c.id === item.id ? { ...c, quantity: c.quantity + 1 } : c
        );
      }
      return [...prev, { ...item, quantity: 1 }];
    });
  }, []);

  const updateQuantity = useCallback((id: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((c) => (c.id === id ? { ...c, quantity: c.quantity + delta } : c))
        .filter((c) => c.quantity > 0)
    );
  }, []);

  const removeFromCart = useCallback((id: string) => {
    setCart((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const handleAddToTab = async () => {
    if (!activeTab || cart.length === 0 || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/pos/add-to-tab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tabId: activeTab.id,
          items: cart.map((c) => ({ id: c.id, quantity: c.quantity })),
          staffName,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to add items to tab");
        return;
      }
      setAddOnReceipt({
        tabId: data.tabId,
        kitchenTicketId: data.kitchenTicketId,
        tableLabel: activeTab.tableLabel ?? "",
        addedItems: data.addedItems,
        addOnTotal: data.addOnTotal,
        newTotal: data.newTotal,
        batchIndex: data.batchIndex,
      });
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const resetPOS = () => {
    setCart([]);
    setServiceMode("counter");
    setTableLabel("");
    setTableLabelInput("");
    setPaymentMethod("cash");
    setPaymentStatus("paid");
    setCustomerName("");
    setNote("");
    setError(null);
    setCompletedOrder(null);
    setSearch("");
    setActiveCategory("All");
    setTabMode("new");
    setActiveTab(null);
    setOpenTabPromptDismissed(false);
    setAddOnReceipt(null);
  };

  const handleSubmit = async () => {
    if (cart.length === 0 || submitting) return;

    // Route to add-to-tab when continuing an existing open tab
    if (tabMode === "continue" && activeTab) {
      return handleAddToTab();
    }

    // Resolve final table label: free-text input overrides quick-tap selection
    const finalTableLabel = tableLabelInput.trim() || tableLabel;

    if (serviceMode === "dine_in" && !finalTableLabel) {
      setError("Please select or enter a table number for dine-in orders.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/pos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: cart.map((c) => ({ id: c.id, quantity: c.quantity })),
          paymentMethod,
          paymentStatus,
          customerName: customerName.trim() || "",
          note: note.trim(),
          staffName,
          serviceMode,
          tableLabel: finalTableLabel,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to create order");
        return;
      }
      setCompletedOrder({
        orderId: data.orderId,
        items: data.items,
        itemsTotal: data.itemsTotal,
        total: data.total,
        paymentMethod,
        paymentStatus,
        customerName: customerName.trim() || (serviceMode === "dine_in" ? finalTableLabel : "Walk-in Customer"),
        note: note.trim(),
        serviceMode,
        tableLabel: finalTableLabel,
        createdAt: new Date(),
      });
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Add-on receipt view ───────────────────────────────────────────────────

  if (addOnReceipt) {
    return (
      <AddOnReceiptView
        receipt={addOnReceipt}
        restaurantName={restaurant.name}
        staffName={staffName}
        onAddMore={() => {
          setCart([]);
          setAddOnReceipt(null);
          // Update activeTab total optimistically so the running total stays accurate
          if (activeTab) {
            setActiveTab((prev) =>
              prev ? { ...prev, total: addOnReceipt.newTotal, itemsTotal: addOnReceipt.newTotal } : prev
            );
          }
        }}
        onViewBills={() => {
          setAddOnReceipt(null);
          setRightTab("bills");
          setTabMode("new");
          setActiveTab(null);
          setCart([]);
        }}
        onPrint={() => openAddOnReprintWindow(addOnReceipt, restaurant.name, staffName)}
        onNewOrder={resetPOS}
      />
    );
  }

  // ── Receipt view ──────────────────────────────────────────────────────────

  if (completedOrder) {
    return (
      <ReceiptView
        order={completedOrder}
        restaurant={restaurant}
        staffName={staffName}
        onNewOrder={resetPOS}
      />
    );
  }

  // Resolved table label used in confirm button
  const resolvedTable = tableLabelInput.trim() || tableLabel;

  const settleOrder = openBills.find((o) => o.id === settleBillId) ?? null;

  // ── POS main UI ───────────────────────────────────────────────────────────

  return (
    <div
      className="flex flex-col overflow-hidden relative"
      style={{ height: "calc(100vh - 56px)" }}
    >
      {/* ── Settle Bill Modal overlay ─────────────────────────────── */}
      {settleOrder && !settlementResult && (
        <SettleBillModal
          order={settleOrder}
          restaurant={restaurant}
          staffName={staffName}
          onClose={() => setSettleBillId(null)}
          onSettled={(result) => {
            setSettlementResult(result);
            // Remove from open bills immediately (optimistic)
            setOpenBills((prev) => prev.filter((o) => o.id !== result.orderId));
          }}
        />
      )}
      {settleBillId && settlementResult && (
        <SettlementSuccessModal
          order={openBills.find((o) => o.id === settleBillId) ?? settleOrder!}
          result={settlementResult}
          restaurantName={restaurant.name}
          onClose={() => {
            setSettleBillId(null);
            setSettlementResult(null);
          }}
          onPrint={() =>
            openSettledBillWindow(
              openBills.find((o) => o.id === settleBillId) ?? settleOrder!,
              settlementResult,
              restaurant.name
            )
          }
        />
      )}
      {/* ── Ready-order alert banner ──────────────────────────────── */}
      {readyOrders.length > 0 && (
        <ReadyOrdersPanel
          orders={readyOrders}
          muted={alertMuted}
          collapsed={alertCollapsed}
          servingId={servingId}
          onToggleMute={toggleAlertMute}
          onToggleCollapse={() => setAlertCollapsed((v) => !v)}
          onMarkServed={markServed}
          onReprint={(order) =>
            openReprintWindow(order, restaurant.name, staffName)
          }
        />
      )}

      {/* ── Two-column POS layout ─────────────────────────────────── */}
      <div className="flex flex-col lg:flex-row flex-1 overflow-hidden min-h-0">
        {/* LEFT: Menu */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-gray-50">
          {/* Top bar */}
          <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 flex-shrink-0">
            <h1 className="font-black text-gray-900 text-base whitespace-nowrap hidden sm:block">
              POS / Counter Sales
            </h1>
            <div className="flex-1">
              <input
                type="text"
                placeholder="Search menu items..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-orange-500 bg-gray-50"
              />
            </div>
          </div>

          {/* Category tabs */}
          <div className="bg-white border-b border-gray-200 px-4 flex-shrink-0 overflow-x-auto">
            <div className="flex gap-1.5 py-2">
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors ${
                    activeCategory === cat
                      ? "bg-orange-600 text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-orange-50 hover:text-orange-700"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Items grid */}
          <div className="flex-1 overflow-y-auto p-4">
            {filteredItems.length === 0 ? (
              <div className="py-20 text-center text-gray-400 text-sm">
                {search
                  ? `No items matching "${search}"`
                  : "No available items in this category."}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
                {filteredItems.map((item) => {
                  const inCart = cart.find((c) => c.id === item.id);
                  return (
                    <button
                      key={item.id}
                      onClick={() => addToCart(item)}
                      className={`relative bg-white rounded-2xl border-2 p-3 text-left transition-all hover:shadow-md active:scale-95 ${
                        inCart
                          ? "border-orange-500 shadow-sm bg-orange-50/30"
                          : "border-gray-100 hover:border-orange-200"
                      }`}
                    >
                      {inCart && (
                        <span className="absolute top-2 right-2 bg-orange-600 text-white text-xs font-black w-5 h-5 rounded-full flex items-center justify-center leading-none">
                          {inCart.quantity}
                        </span>
                      )}
                      {item.image ? (
                        <div className="w-full h-20 rounded-xl mb-2 overflow-hidden bg-gray-100 flex-shrink-0">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={item.image}
                            alt={item.name}
                            className="w-full h-full object-cover"
                          />
                        </div>
                      ) : (
                        <div className="w-full h-20 rounded-xl mb-2 bg-orange-50 flex items-center justify-center text-orange-200 text-3xl flex-shrink-0">
                          🍽
                        </div>
                      )}
                      <p className="font-bold text-gray-900 text-sm leading-tight line-clamp-2">
                        {item.name}
                      </p>
                      {item.category && (
                        <p className="text-[11px] text-gray-400 mt-0.5 truncate">
                          {item.category}
                        </p>
                      )}
                      <p className="text-sm font-black text-orange-600 mt-1.5">
                        {fmt(item.price)}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: Cart + Payment */}
        <div className="w-full lg:w-[360px] xl:w-[400px] bg-white border-t lg:border-t-0 lg:border-l border-gray-200 flex flex-col flex-shrink-0">

          {/* ── Right-panel tab switcher ──────────────────────────── */}
          <div className="flex border-b border-gray-200 flex-shrink-0">
            <button
              onClick={() => setRightTab("order")}
              className={`flex-1 py-2.5 text-xs font-black transition-colors ${
                rightTab === "order"
                  ? "border-b-2 border-orange-600 text-orange-700 bg-orange-50/60"
                  : "text-gray-500 hover:text-gray-800"
              }`}
            >
              New Order
            </button>
            <button
              onClick={() => setRightTab("bills")}
              className={`flex-1 py-2.5 text-xs font-black transition-colors relative ${
                rightTab === "bills"
                  ? "border-b-2 border-teal-600 text-teal-700 bg-teal-50/60"
                  : "text-gray-500 hover:text-gray-800"
              }`}
            >
              Open Bills
              {openBills.length > 0 && (
                <span className={`ml-1.5 text-[10px] font-black px-1.5 py-0.5 rounded-full ${
                  rightTab === "bills" ? "bg-teal-600 text-white" : "bg-teal-100 text-teal-700"
                }`}>
                  {openBills.length}
                </span>
              )}
            </button>
          </div>

          {/* ── Open Bills panel ──────────────────────────────────── */}
          {rightTab === "bills" && (
            <OpenBillsPanel
              bills={openBills}
              onSettle={(id) => {
                setSettleBillId(id);
                setSettlementResult(null);
              }}
            />
          )}

          {/* ── Service mode selector ─────────────────────────────── */}
          {rightTab === "order" && (<>
          <div className="px-4 pt-3 pb-2 border-b border-gray-100 flex-shrink-0">
            <div className="flex rounded-xl overflow-hidden border border-gray-200">
              <button
                onClick={() => switchServiceMode("counter")}
                className={`flex-1 py-2 text-xs font-black transition-colors ${
                  serviceMode === "counter"
                    ? "bg-gray-900 text-white"
                    : "bg-white text-gray-500 hover:bg-gray-50"
                }`}
              >
                Counter Pickup
              </button>
              <button
                onClick={() => switchServiceMode("dine_in")}
                className={`flex-1 py-2 text-xs font-black transition-colors border-l border-gray-200 ${
                  serviceMode === "dine_in"
                    ? "bg-teal-600 text-white"
                    : "bg-white text-gray-500 hover:bg-teal-50 hover:text-teal-700"
                }`}
              >
                Dine-In
              </button>
            </div>

            {/* Table selector — dine-in only */}
            {serviceMode === "dine_in" && (
              <div className="mt-2.5 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                    Table
                  </p>
                  {(tableLabel || tableLabelInput) && (
                    <span className="text-xs font-black text-teal-700 bg-teal-50 px-2 py-0.5 rounded-full">
                      {tableLabelInput.trim() || tableLabel}
                    </span>
                  )}
                </div>
                {/* Quick-tap table numbers */}
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_TABLES.map((n) => {
                    const label = `Table ${n}`;
                    const isActive =
                      !tableLabelInput.trim() && tableLabel === label;
                    return (
                      <button
                        key={n}
                        onClick={() => {
                          setTableLabel(label);
                          setTableLabelInput("");
                          setOpenTabPromptDismissed(false);
                          if (tabMode === "continue" && activeTab?.tableLabel !== label) {
                            setTabMode("new");
                            setActiveTab(null);
                          }
                        }}
                        className={`w-9 h-9 rounded-xl text-xs font-black transition-colors ${
                          isActive
                            ? "bg-teal-600 text-white shadow-sm"
                            : "bg-gray-100 text-gray-700 hover:bg-teal-100 hover:text-teal-800"
                        }`}
                      >
                        {n}
                      </button>
                    );
                  })}
                </div>
                {/* Free-text override */}
                <input
                  type="text"
                  placeholder="Custom: VIP 1, Outdoor A, Bar…"
                  value={tableLabelInput}
                  onChange={(e) => {
                    setTableLabelInput(e.target.value);
                    setOpenTabPromptDismissed(false);
                    if (tabMode === "continue") { setTabMode("new"); setActiveTab(null); }
                  }}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-teal-500 bg-gray-50"
                />
              </div>
            )}
          </div>

          {/* Cart header */}
          <div className="px-4 py-2.5 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
            <h2 className="font-black text-gray-900 text-sm">
              {serviceMode === "dine_in" && resolvedTable
                ? <span className="text-teal-700">{resolvedTable}</span>
                : "Current Order"}
              {" "}
              {cartCount > 0 && (
                <span className="text-orange-600 font-black">({cartCount})</span>
              )}
            </h2>
            {cart.length > 0 && (
              <button
                onClick={() => setCart([])}
                className="text-xs font-bold text-red-400 hover:text-red-600 transition-colors"
              >
                Clear all
              </button>
            )}
          </div>

          {/* ── Open tab prompt ─────────────────────────────────────── */}
          {serviceMode === "dine_in" && resolvedTable && tabMode !== "continue" && openTabForTable && !openTabPromptDismissed && (
            <div className="mx-3 mt-3 rounded-2xl border-2 border-teal-300 bg-teal-50 overflow-hidden flex-shrink-0">
              <div className="bg-teal-600 px-3 py-1.5 flex items-center gap-1.5">
                <span className="w-2 h-2 bg-white rounded-full animate-pulse flex-shrink-0" />
                <span className="text-white font-black text-[11px] uppercase tracking-widest">
                  Open Tab Found
                </span>
              </div>
              <div className="px-3 py-2.5">
                <p className="font-black text-teal-800 text-sm">{resolvedTable}</p>
                <p className="text-teal-700 text-xs font-bold mt-0.5">
                  {fmt(openTabForTable.total)} · {openTabForTable.items.length} item{openTabForTable.items.length !== 1 ? "s" : ""}
                  {" · "}{openTabForTable.items.slice(0, 2).map(i => i.name).join(", ")}{openTabForTable.items.length > 2 ? "…" : ""}
                </p>
                <div className="flex gap-2 mt-2.5">
                  <button
                    onClick={() => {
                      setActiveTab(openTabForTable);
                      setTabMode("continue");
                    }}
                    className="flex-[2] bg-teal-600 hover:bg-teal-500 text-white font-black text-xs py-2 rounded-xl transition-colors"
                  >
                    Continue Tab
                  </button>
                  <button
                    onClick={() => setOpenTabPromptDismissed(true)}
                    className="flex-1 bg-white hover:bg-gray-50 text-gray-600 font-black text-xs py-2 rounded-xl border border-gray-200 transition-colors"
                  >
                    New Tab
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Active tab banner ────────────────────────────────────── */}
          {tabMode === "continue" && activeTab && (
            <div className="mx-3 mt-3 rounded-xl bg-teal-700 px-3 py-2 flex items-center justify-between flex-shrink-0">
              <div>
                <p className="text-white font-black text-sm leading-tight">{activeTab.tableLabel}</p>
                <p className="text-teal-200 text-[11px] font-bold">
                  Running tab · {fmt(activeTab.total)} · Adding on
                </p>
              </div>
              <button
                onClick={() => { setTabMode("new"); setActiveTab(null); setOpenTabPromptDismissed(true); }}
                className="text-teal-300 hover:text-white text-xs font-bold underline transition-colors flex-shrink-0 ml-2"
              >
                New Tab
              </button>
            </div>
          )}

          {/* Cart items */}
          <div className="flex-1 overflow-y-auto divide-y divide-gray-50 min-h-0">
            {cart.length === 0 ? (
              <div className="py-12 text-center text-gray-400 text-sm px-6">
                <p className="text-2xl mb-2">🛒</p>
                {tabMode === "continue" && activeTab
                  ? `Add new items to ${activeTab.tableLabel}`
                  : "Tap items from the menu to add them here."}
              </div>
            ) : (
              cart.map((item) => (
                <div key={item.id} className="flex items-center gap-2 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-gray-900 text-sm truncate">
                      {item.name}
                    </p>
                    <p className="text-xs text-gray-500">{fmt(item.price)} each</p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => updateQuantity(item.id, -1)}
                      className="w-6 h-6 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-black text-sm flex items-center justify-center leading-none transition-colors"
                    >
                      −
                    </button>
                    <span className="w-7 text-center font-black text-sm tabular-nums">
                      {item.quantity}
                    </span>
                    <button
                      onClick={() => updateQuantity(item.id, 1)}
                      className="w-6 h-6 rounded-full bg-orange-100 hover:bg-orange-200 text-orange-700 font-black text-sm flex items-center justify-center leading-none transition-colors"
                    >
                      +
                    </button>
                  </div>
                  <p className="text-sm font-black text-gray-900 w-16 text-right flex-shrink-0 tabular-nums">
                    {fmt(item.price * item.quantity)}
                  </p>
                  <button
                    onClick={() => removeFromCart(item.id)}
                    className="text-gray-300 hover:text-red-500 text-lg leading-none flex-shrink-0 w-5 text-center transition-colors"
                    aria-label="Remove item"
                  >
                    ×
                  </button>
                </div>
              ))
            )}
          </div>

          {/* Payment panel */}
          <div className="border-t border-gray-100 p-4 space-y-3 flex-shrink-0">
            {/* Total / running total */}
            <div className="space-y-1">
              <div className="flex justify-between items-center">
                <span className="text-sm font-bold text-gray-500">
                  {tabMode === "continue" ? "Adding" : "Total"}
                </span>
                <span className="text-2xl font-black text-gray-900 tabular-nums">
                  {fmt(cartTotal)}
                </span>
              </div>
              {tabMode === "continue" && activeTab && cartTotal > 0 && (
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-teal-700">Running Total</span>
                  <span className="text-base font-black text-teal-700 tabular-nums">
                    {fmt(activeTab.total + cartTotal)}
                  </span>
                </div>
              )}
            </div>

            {/* Customer name — hidden in continue mode (tab already has one) */}
            {tabMode !== "continue" && (
              <input
                type="text"
                placeholder="Customer name (optional)"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-orange-500 bg-gray-50 transition-colors"
              />
            )}

            {/* Payment method — hidden in continue mode (payment settled at bill close) */}
            {tabMode !== "continue" && (
              <div>
                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">
                  Payment Method
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  {(
                    ["cash", "bank_transfer", "card", "unpaid"] as PaymentMethod[]
                  ).map((pm) => (
                    <button
                      key={pm}
                      onClick={() => setPaymentMethod(pm)}
                      className={`py-2 px-2 rounded-xl text-xs font-bold transition-colors text-center leading-tight ${
                        paymentMethod === pm
                          ? "bg-gray-900 text-white"
                          : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                      }`}
                    >
                      {PAYMENT_METHOD_LABELS[pm]}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Payment status — hidden in continue mode */}
            {tabMode !== "continue" && (
              <div>
                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">
                  Payment Status
                </p>
                <div className="grid grid-cols-4 gap-1">
                  {(
                    ["paid", "unpaid", "part_paid", "cancelled"] as PaymentStatus[]
                  ).map((ps) => (
                    <button
                      key={ps}
                      onClick={() => setPaymentStatus(ps)}
                      className={`py-1.5 rounded-lg text-[10px] font-bold transition-colors text-center ${
                        paymentStatus === ps
                          ? ps === "paid"
                            ? "bg-green-600 text-white"
                            : ps === "cancelled"
                            ? "bg-red-600 text-white"
                            : "bg-yellow-500 text-white"
                          : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                      }`}
                    >
                      {PAYMENT_STATUS_LABELS[ps]}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Note */}
            <input
              type="text"
              placeholder={tabMode === "continue" ? "Add-on note (optional)" : "Order note (optional)"}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-orange-500 bg-gray-50 transition-colors"
            />

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 text-sm text-red-700 font-medium">
                {error}
              </div>
            )}

            {/* Confirm / Add-to-tab button */}
            <button
              onClick={handleSubmit}
              disabled={cart.length === 0 || submitting || (serviceMode === "dine_in" && tabMode === "new" && !resolvedTable)}
              className={`w-full disabled:opacity-40 disabled:cursor-not-allowed text-white font-black py-3.5 rounded-xl transition-colors text-sm ${
                tabMode === "continue"
                  ? "bg-teal-700 hover:bg-teal-600 active:bg-teal-800"
                  : serviceMode === "dine_in"
                  ? "bg-teal-600 hover:bg-teal-500 active:bg-teal-700"
                  : "bg-orange-600 hover:bg-orange-500 active:bg-orange-700"
              }`}
            >
              {submitting
                ? tabMode === "continue" ? "Adding to Tab…" : "Creating Order…"
                : cart.length === 0
                ? tabMode === "continue" ? "Add items to continue" : "Add items to confirm"
                : tabMode === "continue" && activeTab
                ? `Add to ${activeTab.tableLabel ?? "Tab"} · ${fmt(cartTotal)}`
                : serviceMode === "dine_in"
                ? resolvedTable
                  ? `Confirm · ${resolvedTable} · ${fmt(cartTotal)}`
                  : `Select a table first`
                : `Confirm Order · ${fmt(cartTotal)}`}
            </button>

            <p className="text-center text-[11px] text-gray-400">
              Cashier:{" "}
              <span className="font-bold text-gray-600">{staffName}</span>
            </p>
          </div>
          </>)}
        </div>
      </div>
    </div>
  );
}

// ── Add-on receipt view ───────────────────────────────────────────────────────

function AddOnReceiptView({
  receipt,
  restaurantName,
  staffName,
  onAddMore,
  onViewBills,
  onPrint,
  onNewOrder,
}: {
  receipt: AddOnReceipt;
  restaurantName: string;
  staffName: string;
  onAddMore: () => void;
  onViewBills: () => void;
  onPrint: () => void;
  onNewOrder: () => void;
}) {
  return (
    <>
      <style>{`@media print { .pos-no-print { display: none !important; } }`}</style>
      <div className="max-w-md mx-auto px-4 py-8">
        <div className="pos-no-print flex items-center justify-between mb-6">
          <button
            onClick={onNewOrder}
            className="flex items-center gap-1.5 text-sm font-bold text-gray-600 hover:text-gray-900 bg-white border border-gray-200 px-4 py-2.5 rounded-xl transition-colors"
          >
            ← New Order
          </button>
          <button
            onClick={onPrint}
            className="flex items-center gap-1.5 text-sm font-bold bg-teal-700 text-white px-4 py-2.5 rounded-xl hover:bg-teal-600 transition-colors"
          >
            Print Add-On Receipt
          </button>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="text-center px-6 pt-8 pb-5 border-b border-dashed border-gray-200">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">
              Restaflow POS · Add-On
            </p>
            <h1 className="text-xl font-black text-gray-900">{restaurantName}</h1>
            <div className="mt-2 flex justify-center gap-2">
              <span className="text-[10px] font-black uppercase px-3 py-1 rounded-full bg-teal-100 text-teal-800">
                Dine-In
              </span>
              <span className="text-[10px] font-black uppercase px-3 py-1 rounded-full bg-green-100 text-green-800">
                Added to Tab
              </span>
            </div>
            <p className="text-lg font-black text-teal-700 mt-1">{receipt.tableLabel}</p>
            <p className="text-xs text-gray-400 mt-1">
              {new Date().toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" })}
            </p>
          </div>

          <div className="px-6 py-4 border-b border-dashed border-gray-200 space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500 font-bold">Ticket #</span>
              <span className="font-mono text-xs font-bold text-gray-900">{receipt.kitchenTicketId.slice(-8).toUpperCase()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500 font-bold">Tab #</span>
              <span className="font-mono text-xs font-bold text-gray-900">{receipt.tabId.slice(-8).toUpperCase()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500 font-bold">Added by</span>
              <span className="font-bold text-gray-900">{staffName}</span>
            </div>
          </div>

          <div className="px-6 py-4 border-b border-dashed border-gray-200 space-y-2">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Items Added</p>
            {receipt.addedItems.map((item, i) => (
              <div key={i} className="flex items-baseline justify-between gap-2">
                <div className="flex items-baseline gap-1.5 min-w-0">
                  <span className="text-gray-400 font-bold text-sm flex-shrink-0">{item.quantity}×</span>
                  <span className="font-bold text-gray-900 text-sm truncate">{item.name}</span>
                </div>
                <span className="font-bold text-gray-900 text-sm flex-shrink-0 tabular-nums">
                  {fmt(item.price * item.quantity)}
                </span>
              </div>
            ))}
          </div>

          <div className="px-6 py-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500 font-bold">Added This Round</span>
              <span className="font-bold text-gray-900 tabular-nums">{fmt(receipt.addOnTotal)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="font-black text-teal-700 text-base">Running Tab Total</span>
              <span className="font-black text-teal-700 text-xl tabular-nums">{fmt(receipt.newTotal)}</span>
            </div>
            <p className="text-[10px] text-gray-400 text-center pt-1">
              Items sent to kitchen · Bill stays open until settled
            </p>
          </div>
        </div>

        <div className="pos-no-print mt-6 grid grid-cols-3 gap-2">
          <button
            onClick={onAddMore}
            className="bg-teal-700 hover:bg-teal-600 text-white font-black py-3 rounded-xl transition-colors text-xs"
          >
            Add More
          </button>
          <button
            onClick={onViewBills}
            className="bg-gray-100 hover:bg-gray-200 text-gray-700 font-black py-3 rounded-xl transition-colors text-xs"
          >
            Open Bills
          </button>
          <button
            onClick={onNewOrder}
            className="bg-gray-900 hover:bg-gray-700 text-white font-black py-3 rounded-xl transition-colors text-xs"
          >
            New Order
          </button>
        </div>
      </div>
    </>
  );
}

// ── Open Bills Panel ──────────────────────────────────────────────────────────

function OpenBillsPanel({
  bills,
  onSettle,
}: {
  bills: TodayOrder[];
  onSettle: (orderId: string) => void;
}) {
  if (bills.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-12">
        <p className="text-3xl mb-3">🍽</p>
        <p className="text-sm font-bold text-gray-400">No open bills</p>
        <p className="text-xs text-gray-300 mt-1">
          Unpaid dine-in orders will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto divide-y divide-gray-50 min-h-0">
      {bills.map((bill) => {
        const shortId = bill.id.slice(-6).toUpperCase();
        const age = bill.createdAt?.toDate
          ? (() => {
              const mins = Math.floor((Date.now() - bill.createdAt.toDate().getTime()) / 60000);
              if (mins < 1) return "Just now";
              if (mins < 60) return `${mins}m ago`;
              const h = Math.floor(mins / 60);
              const m = mins % 60;
              return `${h}h${m > 0 ? ` ${m}m` : ""}`;
            })()
          : "";
        const itemSummary = bill.items
          .slice(0, 3)
          .map((i) => `${i.quantity}× ${i.name}`)
          .join(", ") + (bill.items.length > 3 ? ` +${bill.items.length - 3}` : "");

        return (
          <div key={bill.id} className="px-4 py-3.5 hover:bg-teal-50/40 transition-colors">
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="min-w-0">
                <p className="font-black text-teal-700 text-base leading-tight truncate">
                  {bill.tableLabel || `#${shortId}`}
                </p>
                <p className="font-mono text-gray-400 text-[11px] leading-tight">
                  #{shortId} · {age}
                </p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="font-black text-gray-900 text-base tabular-nums">
                  {fmt(bill.total)}
                </p>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">
                  {bill.paymentStatus === "part_paid" ? "Part Paid" : "Unpaid"}
                </span>
              </div>
            </div>

            <p className="text-xs text-gray-500 mb-2.5 truncate">{itemSummary}</p>

            {bill.status === "completed" && (
              <p className="text-[10px] font-bold text-green-600 mb-2">✓ Food served</p>
            )}
            {bill.status === "ready" && (
              <p className="text-[10px] font-bold text-purple-600 mb-2">Ready to serve</p>
            )}

            <button
              onClick={() => onSettle(bill.id)}
              className="w-full bg-teal-600 hover:bg-teal-500 active:bg-teal-700 text-white font-black text-xs py-2.5 rounded-xl transition-colors"
            >
              Settle Bill
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ── Settle Bill Modal ─────────────────────────────────────────────────────────

function SettleBillModal({
  order,
  restaurant,
  staffName,
  onClose,
  onSettled,
}: {
  order: TodayOrder;
  restaurant: { name: string; slug: string };
  staffName: string;
  onClose: () => void;
  onSettled: (result: SettlementResult) => void;
}) {
  const [method, setMethod] = useState<"cash" | "bank_transfer" | "card">("cash");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shortId = order.id.slice(-6).toUpperCase();
  const createdAt = order.createdAt?.toDate?.() ?? new Date();

  const settle = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/pos/settle-bill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: order.id,
          paymentMethod: method,
          settlementNote: note.trim(),
          staffName,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to settle bill");
        return;
      }
      onSettled({
        orderId: order.id,
        tableLabel: order.tableLabel ?? `#${shortId}`,
        total: order.total,
        paymentMethod: method,
        paidAt: new Date(),
        staffName,
      });
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const methodLabels: Record<string, string> = {
    cash: "Cash",
    bank_transfer: "Bank Transfer",
    card: "Card / POS Machine",
  };

  return (
    <div className="absolute inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-md sm:rounded-2xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">
        {/* Modal header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 flex-shrink-0">
          <div>
            <p className="text-[10px] font-bold text-gray-600 uppercase tracking-widest">
              Settle Bill · {restaurant.name}
            </p>
            <h2 className="font-black text-teal-700 text-lg leading-tight">
              {order.tableLabel || `#${shortId}`}
            </h2>
            <p className="font-mono text-gray-500 text-xs">#{shortId}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-800 text-2xl leading-none w-8 h-8 flex items-center justify-center rounded-xl hover:bg-gray-100 transition-colors"
          >
            ×
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
          {/* Order meta */}
          <div className="px-5 py-3 bg-gray-50 border-b border-gray-200 space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-700 font-bold">Status</span>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                order.status === "completed" ? "bg-green-100 text-green-800"
                : order.status === "ready" ? "bg-purple-100 text-purple-800"
                : order.status === "preparing" ? "bg-blue-100 text-blue-800"
                : "bg-yellow-100 text-yellow-800"
              }`}>{order.status}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-700 font-bold">Ordered</span>
              <span className="font-bold text-gray-900">
                {createdAt.toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" })}
                {" · "}
                {createdAt.toLocaleDateString("en-NG", { day: "numeric", month: "short" })}
              </span>
            </div>
            {order.staffName && (
              <div className="flex justify-between">
                <span className="text-gray-700 font-bold">Waiter</span>
                <span className="font-bold text-gray-900">{order.staffName}</span>
              </div>
            )}
            {order.note && (
              <div className="flex justify-between gap-4">
                <span className="text-gray-700 font-bold flex-shrink-0">Note</span>
                <span className="font-bold text-gray-900 text-right">{order.note}</span>
              </div>
            )}
          </div>

          {/* Items */}
          <div className="px-5 py-4 border-b border-gray-200 space-y-2.5">
            {order.items.map((item, i) => (
              <div key={i} className="flex items-baseline justify-between gap-2">
                <div className="flex items-baseline gap-1.5 min-w-0">
                  <span className="text-gray-600 font-black text-sm flex-shrink-0">{item.quantity}×</span>
                  <span className="font-bold text-gray-900 text-sm truncate">{item.name}</span>
                </div>
                <span className="font-bold text-gray-900 text-sm flex-shrink-0 tabular-nums">
                  {fmt(item.price * item.quantity)}
                </span>
              </div>
            ))}
          </div>

          {/* Total */}
          <div className="px-5 py-4 border-b border-gray-200">
            <div className="flex justify-between items-center">
              <span className="font-black text-gray-900 text-base">Total</span>
              <span className="font-black text-gray-900 text-2xl tabular-nums">{fmt(order.total)}</span>
            </div>
            {order.paymentStatus === "part_paid" && (
              <p className="text-xs text-yellow-800 font-bold mt-1">Part payment previously recorded</p>
            )}
          </div>

          {/* Payment controls */}
          <div className="px-5 py-4 space-y-3">
            <div>
              <p className="text-[11px] font-bold text-gray-600 uppercase tracking-wider mb-2">
                Payment Method
              </p>
              <div className="grid grid-cols-3 gap-2">
                {(["cash", "bank_transfer", "card"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMethod(m)}
                    className={`py-2.5 px-2 rounded-xl text-xs font-bold transition-colors text-center leading-tight border ${
                      method === m
                        ? "bg-teal-600 text-white border-teal-600 shadow-sm"
                        : "bg-white text-gray-800 border-gray-300 hover:border-teal-400 hover:text-teal-700 hover:bg-teal-50"
                    }`}
                  >
                    {methodLabels[m]}
                  </button>
                ))}
              </div>
            </div>

            <input
              type="text"
              placeholder={
                method === "bank_transfer"
                  ? "Transfer reference / narration (optional)"
                  : "Note or reference (optional)"
              }
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-teal-500 bg-white placeholder:text-gray-400"
            />

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 text-sm text-red-700 font-medium">
                {error}
              </div>
            )}
          </div>
        </div>

        {/* Footer actions */}
        <div className="px-5 py-4 border-t border-gray-200 flex gap-3 flex-shrink-0">
          <button
            onClick={onClose}
            className="flex-1 py-3 rounded-xl border-2 border-gray-300 text-gray-700 font-black text-sm hover:border-gray-400 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={settle}
            disabled={submitting}
            className="flex-2 flex-grow-[2] py-3 rounded-xl bg-teal-600 hover:bg-teal-500 active:bg-teal-700 text-white font-black text-sm transition-colors disabled:opacity-50"
          >
            {submitting ? "Settling…" : `Mark as Paid · ${fmt(order.total)}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Settlement success modal ───────────────────────────────────────────────────

function SettlementSuccessModal({
  order,
  result,
  restaurantName,
  onClose,
  onPrint,
}: {
  order: TodayOrder | null;
  result: SettlementResult;
  restaurantName: string;
  onClose: () => void;
  onPrint: () => void;
}) {
  void restaurantName;
  const shortId = result.orderId.slice(-6).toUpperCase();

  return (
    <div className="absolute inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-md sm:rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-6 pt-8 pb-6 text-center">
          <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl">✓</span>
          </div>
          <h2 className="font-black text-gray-900 text-xl mb-1">Bill Settled!</h2>
          <p className="text-teal-700 font-black text-lg">{result.tableLabel}</p>
          <p className="font-mono text-gray-400 text-xs mb-3">#{shortId}</p>
          <div className="bg-gray-50 rounded-xl px-4 py-3 text-left space-y-1.5 mb-4">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500 font-bold">Total Paid</span>
              <span className="font-black text-gray-900">{fmt(result.total)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500 font-bold">Method</span>
              <span className="font-bold text-gray-900">
                {{ cash: "Cash", bank_transfer: "Bank Transfer", card: "Card / POS Machine" }[result.paymentMethod] ?? result.paymentMethod}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500 font-bold">Settled by</span>
              <span className="font-bold text-gray-900">{result.staffName}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500 font-bold">Time</span>
              <span className="font-bold text-gray-900">
                {result.paidAt.toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={onPrint}
              className="flex-1 border-2 border-teal-600 text-teal-700 hover:bg-teal-50 font-black py-3 rounded-xl transition-colors text-sm"
            >
              Print Receipt
            </button>
            <button
              onClick={onClose}
              className="flex-1 bg-gray-900 hover:bg-gray-700 text-white font-black py-3 rounded-xl transition-colors text-sm"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Ready-orders alert panel ──────────────────────────────────────────────────

function ReadyOrdersPanel({
  orders,
  muted,
  collapsed,
  servingId,
  onToggleMute,
  onToggleCollapse,
  onMarkServed,
  onReprint,
}: {
  orders: TodayOrder[];
  muted: boolean;
  collapsed: boolean;
  servingId: string | null;
  onToggleMute: () => void;
  onToggleCollapse: () => void;
  onMarkServed: (id: string) => void;
  onReprint: (order: TodayOrder) => void;
}) {
  const itemSummary = (items: TodayOrder["items"]) =>
    items
      .slice(0, 3)
      .map((i) => `${i.quantity}× ${i.name}`)
      .join(", ") + (items.length > 3 ? ` +${items.length - 3} more` : "");

  // Header changes based on what types of orders are ready
  const hasDineIn = orders.some((o) => o.serviceMode === "dine_in");
  const hasCounter = orders.some((o) => o.serviceMode !== "dine_in");
  const headerText =
    hasDineIn && hasCounter
      ? "ORDERS READY FOR SERVICE"
      : hasDineIn
      ? "TABLES READY TO SERVE"
      : "ORDERS READY FOR PICKUP";

  return (
    <div className="flex-shrink-0 bg-gradient-to-r from-green-600 to-emerald-600 shadow-lg shadow-green-900/20">
      {/* Header row */}
      <div className="flex items-center justify-between px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-60" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-white" />
          </span>
          <span className="font-black text-white text-sm tracking-wide">
            {headerText}
          </span>
          <span className="bg-white/20 text-white font-black text-xs px-2 py-0.5 rounded-full">
            {orders.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleMute}
            className="text-white/80 hover:text-white text-xs font-bold px-2.5 py-1 rounded-lg bg-white/15 hover:bg-white/25 transition-colors"
          >
            {muted ? "🔇" : "🔔"}
          </button>
          <button
            onClick={onToggleCollapse}
            className="text-white/80 hover:text-white text-xs font-bold px-2.5 py-1 rounded-lg bg-white/15 hover:bg-white/25 transition-colors"
          >
            {collapsed ? "▼ Show" : "▲ Hide"}
          </button>
        </div>
      </div>

      {/* Order rows */}
      {!collapsed && (
        <div className="border-t border-white/20 max-h-[180px] overflow-y-auto">
          {orders.map((order, idx) => {
            const isBusy = servingId === order.id;
            const isDineIn = order.serviceMode === "dine_in";
            const shortId = order.id.slice(-6).toUpperCase();
            const displayName = isDineIn
              ? (order.tableLabel ?? `#${shortId}`)
              : `#${shortId}`;
            const customerDisplay =
              order.customerName &&
              order.customerName !== "Walk-in Customer" &&
              order.customerName !== order.tableLabel
                ? ` · ${order.customerName}`
                : "";

            return (
              <div
                key={order.id}
                className={`flex items-center gap-3 px-4 py-2.5 ${
                  idx < orders.length - 1 ? "border-b border-white/10" : ""
                }`}
              >
                {/* Order info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full flex-shrink-0 ${
                        isDineIn
                          ? "bg-teal-100 text-teal-800"
                          : "bg-white/25 text-white"
                      }`}
                    >
                      {isDineIn ? "Dine-In" : "Counter"}
                    </span>
                    <span className="font-mono font-black text-white text-sm truncate">
                      {displayName}
                      {customerDisplay && (
                        <span className="font-sans font-bold text-white/70 text-xs">
                          {customerDisplay}
                        </span>
                      )}
                    </span>
                  </div>
                  <p className="text-white/60 text-[11px] truncate leading-tight mt-0.5">
                    {itemSummary(order.items)}
                  </p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => onReprint(order)}
                    className="text-white/60 hover:text-white text-[11px] font-bold underline underline-offset-2 transition-colors"
                  >
                    Reprint
                  </button>
                  <button
                    disabled={isBusy}
                    onClick={() => onMarkServed(order.id)}
                    className="bg-white text-green-700 hover:bg-green-50 active:bg-green-100 disabled:opacity-50 font-black text-xs px-3.5 py-2 rounded-xl transition-colors whitespace-nowrap"
                  >
                    {isBusy
                      ? "…"
                      : isDineIn
                      ? "✓ Serve Table"
                      : "✓ Mark Served"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Receipt view (after confirming new order) ─────────────────────────────────

function ReceiptView({
  order,
  restaurant,
  staffName,
  onNewOrder,
}: {
  order: CompletedOrder;
  restaurant: { name: string; slug: string };
  staffName: string;
  onNewOrder: () => void;
}) {
  const isDineIn = order.serviceMode === "dine_in";

  return (
    <>
      <style>{`
        @media print {
          .pos-no-print { display: none !important; }
          body { background: white !important; margin: 0; }
          .pos-receipt-wrap { max-width: 100%; box-shadow: none !important; }
        }
      `}</style>

      <div className="max-w-md mx-auto px-4 py-8">
        <div className="pos-no-print flex items-center justify-between mb-6">
          <button
            onClick={onNewOrder}
            className="flex items-center gap-1.5 text-sm font-bold text-gray-600 hover:text-gray-900 bg-white border border-gray-200 px-4 py-2.5 rounded-xl transition-colors"
          >
            ← New Order
          </button>
          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 text-sm font-bold bg-orange-600 text-white px-4 py-2.5 rounded-xl hover:bg-orange-500 transition-colors"
          >
            Print Receipt
          </button>
        </div>

        <div className="pos-receipt-wrap bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          {/* Header */}
          <div className="text-center px-6 pt-8 pb-5 border-b border-dashed border-gray-200">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">
              Restaflow POS
            </p>
            <h1 className="text-xl font-black text-gray-900">{restaurant.name}</h1>
            {/* Service mode badge */}
            <div className="mt-2 flex justify-center">
              <span
                className={`text-[10px] font-black uppercase px-3 py-1 rounded-full ${
                  isDineIn
                    ? "bg-teal-100 text-teal-800"
                    : "bg-orange-100 text-orange-800"
                }`}
              >
                {isDineIn ? "Dine-In" : "Counter Pickup"}
              </span>
            </div>
            {/* Table label — prominent for dine-in */}
            {isDineIn && order.tableLabel && (
              <p className="text-lg font-black text-teal-700 mt-1">
                {order.tableLabel}
              </p>
            )}
            <p className="text-xs text-gray-400 mt-2">
              {order.createdAt.toLocaleDateString("en-NG", {
                weekday: "short",
                year: "numeric",
                month: "short",
                day: "numeric",
              })}
              {" · "}
              {order.createdAt.toLocaleTimeString("en-NG", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          </div>

          {/* Order meta */}
          <div className="px-6 py-4 border-b border-dashed border-gray-200 space-y-2">
            <ReceiptRow
              label="Order #"
              value={order.orderId.slice(-8).toUpperCase()}
              mono
            />
            {isDineIn && order.tableLabel && (
              <ReceiptRow label="Table" value={order.tableLabel} accent />
            )}
            {order.customerName &&
              order.customerName !== order.tableLabel && (
                <ReceiptRow label="Customer" value={order.customerName} />
              )}
            <ReceiptRow label="Cashier" value={staffName} />
            <ReceiptRow
              label="Service"
              value={isDineIn ? "Dine-In" : "Counter Pickup"}
              accent
            />
          </div>

          {/* Items */}
          <div className="px-6 py-4 border-b border-dashed border-gray-200 space-y-2">
            {order.items.map((item) => (
              <div
                key={item.id}
                className="flex items-baseline justify-between gap-2"
              >
                <div className="flex items-baseline gap-1.5 min-w-0">
                  <span className="text-gray-400 font-bold text-sm flex-shrink-0">
                    {item.quantity}×
                  </span>
                  <span className="font-bold text-gray-900 text-sm truncate">
                    {item.name}
                  </span>
                </div>
                <span className="font-bold text-gray-900 text-sm flex-shrink-0 tabular-nums">
                  {fmt(item.price * item.quantity)}
                </span>
              </div>
            ))}
          </div>

          {/* Totals */}
          <div className="px-6 py-4 border-b border-dashed border-gray-200 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Subtotal</span>
              <span className="font-bold text-gray-900 tabular-nums">
                {fmt(order.itemsTotal)}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="font-black text-gray-900 text-base">Total</span>
              <span className="font-black text-gray-900 text-xl tabular-nums">
                {fmt(order.total)}
              </span>
            </div>
          </div>

          {/* Payment */}
          <div className="px-6 py-4 border-b border-dashed border-gray-200 space-y-2">
            <ReceiptRow
              label="Payment Method"
              value={PAYMENT_METHOD_LABELS[order.paymentMethod]}
            />
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-500 font-bold">Payment Status</span>
              <span
                className={`text-[10px] font-black uppercase px-2 py-1 rounded-full ${
                  order.paymentStatus === "paid"
                    ? "bg-green-100 text-green-700"
                    : order.paymentStatus === "cancelled"
                    ? "bg-red-100 text-red-700"
                    : order.paymentStatus === "part_paid"
                    ? "bg-yellow-100 text-yellow-700"
                    : "bg-gray-100 text-gray-600"
                }`}
              >
                {PAYMENT_STATUS_LABELS[order.paymentStatus]}
              </span>
            </div>
            {order.note && <ReceiptRow label="Note" value={order.note} />}
          </div>

          <div className="px-6 py-6 text-center">
            <p className="text-xs font-bold text-gray-500">
              {isDineIn ? "Enjoy your meal!" : "Thank you for your order!"}
            </p>
            <p className="text-[10px] text-gray-300 mt-1">Powered by Restaflow</p>
          </div>
        </div>

        <div className="pos-no-print mt-6 flex gap-3">
          <button
            onClick={onNewOrder}
            className="flex-1 bg-gray-900 hover:bg-gray-700 text-white font-black py-3.5 rounded-xl transition-colors text-sm"
          >
            New Order
          </button>
          <button
            onClick={() => window.print()}
            className="flex-1 border-2 border-orange-600 text-orange-600 hover:bg-orange-50 font-black py-3.5 rounded-xl transition-colors text-sm"
          >
            Print Receipt
          </button>
        </div>
      </div>
    </>
  );
}

function ReceiptRow({
  label,
  value,
  mono,
  accent,
}: {
  label: string;
  value: string;
  mono?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="flex justify-between items-center text-sm gap-2">
      <span className="text-gray-500 font-bold flex-shrink-0">{label}</span>
      <span
        className={`font-bold text-right truncate ${
          mono
            ? "font-mono text-xs text-gray-900"
            : accent
            ? "text-teal-700"
            : "text-gray-900"
        }`}
      >
        {value}
      </span>
    </div>
  );
}
