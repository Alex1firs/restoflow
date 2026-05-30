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
  addDoc,
  deleteDoc,
  doc,
} from "firebase/firestore";

// ── Types ─────────────────────────────────────────────────────────────────────

type MenuItem = {
  id: string;
  name: string;
  description: string;
  price: number;
  indoorPrice?: number | null;
  category: string;
  available: boolean;
  image: string;
  itemType?: "item" | "combo";
  basePrice?: number;
  sizes?: { name: string; price: number }[] | null;
  modifierGroups?: {
    groupName: string;
    selectionType: "single" | "multiple";
    required: boolean;
    options: { name: string; price: number }[];
  }[] | null;
  kitchenStation?: string;
  allowCustomPrice?: boolean;
  comboItems?: { foodItemId: string; quantity: number }[] | null;
};

type CartItem = {
  cartItemId: string;
  id: string;
  name: string;
  category: string;
  image?: string;
  kitchenStation?: string;
  allowCustomPrice?: boolean;
  basePrice: number;
  selectedSize?: { name: string; price: number } | null;
  selectedModifiers: { groupName: string; name: string; price: number }[];
  customPrice?: number | null;
  quantity: number;
  itemNote?: string;
};

type ServiceMode = "counter" | "dine_in";
type PaymentMethod = "cash" | "bank_transfer" | "card" | "unpaid";
type PaymentStatus = "paid" | "unpaid" | "part_paid" | "cancelled";

type CompletedOrder = {
  orderId: string;
  items: any[];
  itemsTotal: number;
  total: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  customerName: string;
  note: string;
  serviceMode: ServiceMode;
  tableLabel: string;
  createdAt: Date;
  isOffline?: boolean;
};

type TodayOrder = {
  id: string;
  customerName: string;
  items: any[];
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
  itemBatches?: any[];
  status: string;
  createdAt: Timestamp;
  waiterName?: string | null;
  pricingMode?: string | null;
  isOffline?: boolean;
  auditLog?: any[];
};

type AddOnReceipt = {
  tabId: string;
  kitchenTicketId: string;
  tableLabel: string;
  addedItems: any[];
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
  role: "owner" | "manager" | "staff";
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

function openPOSReceiptWindow(
  order: any,
  restaurantName: string,
  staffName: string,
  copies: number = 2
) {
  const createdAt = order.createdAt instanceof Date 
    ? order.createdAt 
    : order.createdAt?.toDate?.() 
    ? order.createdAt.toDate() 
    : new Date();

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

  // Helper to generate a single page block
  const generatePageHtml = (label: string, isKitchen: boolean) => {
    const itemsHtml = order.items
      .map((i: any) => {
        const sizeStr = i.selectedSize ? ` (${i.selectedSize.name})` : "";
        let modsHtml = "";
        if (i.selectedModifiers && i.selectedModifiers.length > 0) {
          modsHtml = i.selectedModifiers.map((m: any) => `<div class="mod-row">- ${m.name}</div>`).join("");
        }
        const noteHtml = i.itemNote ? `<div class="note-row">* Note: ${i.itemNote}</div>` : "";
        
        const priceSection = isKitchen 
          ? "" 
          : `<span class="price">₦${(i.price * i.quantity).toLocaleString("en-NG")}</span>`;

        return `<div class="item-block">
          <div class="row">
            <span class="qty">${i.quantity}×</span>
            <span class="name">${i.name}${sizeStr}</span>
            ${priceSection}
          </div>
          ${modsHtml}
          ${noteHtml}
        </div>`;
      })
      .join("");

    const totalsSection = isKitchen 
      ? "" 
      : `<div class="div"></div>
         <div class="kv"><span class="kl">Subtotal</span><span class="kv-v">₦${(order.itemsTotal ?? order.total).toLocaleString("en-NG")}</span></div>
         <div class="total"><span>Total</span><span>₦${order.total.toLocaleString("en-NG")}</span></div>
         <div class="div"></div>
         <div class="kv"><span class="kl">Payment</span><span class="kv-v">${pmLabels[order.paymentMethod] ?? order.paymentMethod}</span></div>
         <div class="kv"><span class="kl">Status</span><span class="badge ${order.paymentStatus === "paid" ? "badge-paid" : "badge-unpaid"}">${psLabels[order.paymentStatus] ?? order.paymentStatus}</span></div>`;

    const sourceHtml = isDineIn
      ? `<div class="kv"><span class="kl">Service</span><span class="kv-v">Dine-In</span></div>
         <div class="kv"><span class="kl">Table</span><span class="kv-v kv-table">${order.tableLabel ?? ""}</span></div>`
      : `<div class="kv"><span class="kl">Source</span><span class="kv-v">Counter / POS</span></div>`;

    const waiterHtml = order.waiterName 
      ? `<div class="kv"><span class="kl">Waiter</span><span class="kv-v text-teal font-black">${order.waiterName}</span></div>` 
      : "";

    const customerHtml = order.customerName && order.customerName !== order.tableLabel 
      ? `<div class="kv"><span class="kl">Customer</span><span class="kv-v">${order.customerName}</span></div>` 
      : "";

    return `
    <div class="print-page">
      <div class="center">
        <div class="lbl">${label}</div>
        <h1>${restaurantName}</h1>
        <div class="service-badge ${isDineIn ? "badge-teal" : "badge-orange"}">${isDineIn ? "Dine-In" : "Counter Pickup"}</div>
        ${isDineIn && order.tableLabel ? `<div class="table-lbl">${order.tableLabel}</div>` : ""}
        <div class="meta">${dateStr} · ${timeStr}</div>
      </div>
      <div class="div"></div>
      <div class="kv"><span class="kl">Order #</span><span class="kv-v" style="font-family:monospace">${(order.orderId || order.id).slice(-8).toUpperCase()}</span></div>
      ${customerHtml}
      <div class="kv"><span class="kl">Cashier</span><span class="kv-v">${staffName}</span></div>
      ${waiterHtml}
      ${sourceHtml}
      <div class="div"></div>
      
      <div class="items-header">
        <span>QTY & ITEM</span>
        ${isKitchen ? "" : "<span>PRICE</span>"}
      </div>
      <div class="div" style="margin:4px 0"></div>
      
      ${itemsHtml}
      ${totalsSection}
      ${order.note ? `<div class="kv" style="margin-top:6px"><span class="kl">Note</span><span class="kv-v">${order.note}</span></div>` : ""}
      
      <div class="footer">
        <div>${isKitchen ? "--- KITCHEN COPY ---" : isDineIn ? "Enjoy your meal!" : "Thank you for your patronage!"}</div>
        <div style="font-size:8px;margin-top:2px">Powered by Restaflow</div>
      </div>
    </div>`;
  };

  const pages: string[] = [];
  if (copies >= 1) {
    pages.push(generatePageHtml("CUSTOMER RECEIPT", false));
  }
  if (copies >= 2) {
    pages.push(generatePageHtml("KITCHEN TICKET (UNPAID)", true));
  }
  if (copies >= 3) {
    pages.push(generatePageHtml("CASHIER AUDIT COPY", false));
  }

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>POS Print Job</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,system-ui,sans-serif;font-size:12px;max-width:300px;margin:0 auto;color:#111;background:white}
    .print-page{padding:12px 6px;width:100%}
    .center{text-align:center}
    .lbl{font-size:8px;font-weight:900;letter-spacing:2px;text-transform:uppercase;color:#666;margin-bottom:3px}
    h1{font-size:16px;font-weight:900;margin-bottom:2px}
    .service-badge{display:inline-block;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:1px;padding:2px 8px;border-radius:20px;margin-bottom:4px}
    .badge-teal{background:#e0f2f1;color:#00796b}
    .badge-orange{background:#fff3e0;color:#e65100}
    .table-lbl{font-size:15px;font-weight:900;color:#00796b;margin-bottom:2px}
    .meta{font-size:10px;color:#666}
    .div{border-top:1px dashed #ccc;margin:8px 0}
    .item-block{margin:5px 0}
    .row{display:flex;justify-content:space-between;align-items:baseline;gap:6px;margin:3px 0}
    .qty{font-weight:900;color:#333;flex-shrink:0;font-mono;margin-right:4px}
    .name{font-weight:700;flex:1;text-transform:uppercase}
    .price{font-weight:700;flex-shrink:0;font-family:monospace}
    .mod-row{font-size:10px;color:#444;padding-left:16px;font-weight:600;margin-top:1px}
    .note-row{font-size:10px;color:#d97706;padding-left:16px;font-style:italic;margin-top:1px;font-weight:600}
    .kv{display:flex;justify-content:space-between;font-size:11px;margin:2px 0}
    .kl{color:#666;font-weight:600}
    .kv-v{font-weight:700}
    .text-teal{color:#00796b}
    .font-black{font-weight:900}
    .kv-table{font-size:13px;color:#00796b}
    .total{display:flex;justify-content:space-between;font-size:14px;font-weight:900;margin-top:4px}
    .badge{font-size:8px;font-weight:800;text-transform:uppercase;padding:2px 6px;border-radius:20px}
    .badge-paid{background:#d1fae5;color:#065f46}
    .badge-unpaid{background:#fee2e2;color:#991b1b}
    .items-header{display:flex;justify-content:space-between;font-size:9px;font-weight:800;color:#777;letter-spacing:1px}
    .footer{text-align:center;color:#888;font-size:9px;margin-top:14px;border-top:1px dashed #eee;padding-top:8px}
    @media print{
      body{margin:0;padding:0}
      .print-page{page-break-after:always;min-height:100vh}
      .print-page:last-child{page-break-after:avoid}
    }
  </style>
</head>
<body>
  ${pages.join("")}
  <script>window.onload=function(){setTimeout(function(){window.print();window.close();},100)};</script>
</body>
</html>`;

  const w = window.open("", "_blank", "width=380,height=680,menubar=no,toolbar=no,scrollbars=yes");
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
    .map((i: any) => {
      const sizeStr = i.selectedSize ? ` (${i.selectedSize.name})` : "";
      let modsHtml = "";
      if (i.selectedModifiers && i.selectedModifiers.length > 0) {
        modsHtml = i.selectedModifiers.map((m: any) => `<div class="mod-row">- ${m.name}</div>`).join("");
      }
      const noteHtml = i.itemNote ? `<div class="note-row">* Note: ${i.itemNote}</div>` : "";
      return `<div class="item-block">
        <div class="row">
          <span class="qty">${i.quantity}×</span>
          <span class="name">${i.name}${sizeStr}</span>
          <span class="price">₦${(i.price * i.quantity).toLocaleString("en-NG")}</span>
        </div>
        ${modsHtml}
        ${noteHtml}
      </div>`;
    })
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
    .item-block{margin:6px 0}
    .row{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin:4px 0}
    .qty{font-weight:900;color:#777;flex-shrink:0}
    .name{font-weight:600;flex:1}
    .price{font-weight:700;flex-shrink:0}
    .mod-row{font-size:11px;color:#555;padding-left:20px;font-weight:500;margin-top:2px}
    .note-row{font-size:11px;color:#d97706;padding-left:20px;font-style:italic;margin-top:2px}
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
    .map((i: any) => {
      const sizeStr = i.selectedSize ? ` (${i.selectedSize.name})` : "";
      let modsHtml = "";
      if (i.selectedModifiers && i.selectedModifiers.length > 0) {
        modsHtml = i.selectedModifiers.map((m: any) => `<div class="mod-row">- ${m.name}</div>`).join("");
      }
      const noteHtml = i.itemNote ? `<div class="note-row">* Note: ${i.itemNote}</div>` : "";
      return `<div class="item-block">
        <div class="row">
          <span class="qty">${i.quantity}×</span>
          <span class="name">${i.name}${sizeStr}</span>
          <span class="price">₦${(i.price * i.quantity).toLocaleString("en-NG")}</span>
        </div>
        ${modsHtml}
        ${noteHtml}
      </div>`;
    })
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

export default function POSClient({ restaurant, menuItems, staffName, role }: Props) {
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

  // New Table Service States
  const [pricingMode, setPricingMode] = useState<"regular" | "indoor">("regular");
  const [selectedWaiterName, setSelectedWaiterName] = useState<string | null>(null);
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [waiters, setWaiters] = useState<{ id: string; name: string }[]>([]);
  const [showWaiterManager, setShowWaiterManager] = useState(false);
  const [newWaiterName, setNewWaiterName] = useState("");
  const [printCopies, setPrintCopies] = useState<1 | 2 | 3>(2);

  // Customizer Drawer / Modal State
  const [customizingItem, setCustomizingItem] = useState<MenuItem | null>(null);
  const [customizingCartItemId, setCustomizingCartItemId] = useState<string | null>(null);
  const [activeSize, setActiveSize] = useState<{ name: string; price: number } | null>(null);
  const [activeModifiers, setActiveModifiers] = useState<{ groupName: string; name: string; price: number }[]>([]);
  const [activeCustomPrice, setActiveCustomPrice] = useState<string>("");
  const [activeItemNote, setActiveItemNote] = useState<string>("");

  // Permissions / PIN Override State
  const [verifyingAction, setVerifyingAction] = useState<string | null>(null);
  const [pinInput, setPinInput] = useState<string>("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [pendingActionCallback, setPendingActionCallback] = useState<(() => void) | null>(null);
  const [auditLog, setAuditLog] = useState<any[]>([]);

  // Offline sync states
  const [offlineOrders, setOfflineOrders] = useState<any[]>([]);
  const [syncingOffline, setSyncingOffline] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

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

  // Mobile cart toggle
  const [mobileCartOpen, setMobileCartOpen] = useState(false);

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

  // Load draft cart and offline sync queue on page mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const draft = localStorage.getItem("rf_pos_draft_cart");
      if (draft) {
        try {
          setCart(JSON.parse(draft));
        } catch (_) { /* ignore format issues */ }
      }
      const queued = localStorage.getItem("rf_pos_offline_orders");
      if (queued) {
        try {
          setOfflineOrders(JSON.parse(queued));
        } catch (_) { /* ignore format issues */ }
      }
    }
  }, []);

  // Load waiters in real-time
  useEffect(() => {
    const q = query(
      collection(db, "waiters"),
      where("restaurantId", "==", restaurant.slug)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const wList: { id: string; name: string }[] = [];
      snapshot.forEach((doc) => {
        const d = doc.data();
        wList.push({ id: doc.id, name: d.name as string });
      });
      wList.sort((a, b) => a.name.localeCompare(b.name));
      setWaiters(wList);
    });
    return () => unsubscribe();
  }, [restaurant.slug]);

  // Persist draft cart changes
  useEffect(() => {
    localStorage.setItem("rf_pos_draft_cart", JSON.stringify(cart));
  }, [cart]);

  // Save offline sync queue changes
  useEffect(() => {
    localStorage.setItem("rf_pos_offline_orders", JSON.stringify(offlineOrders));
  }, [offlineOrders]);

  const showSystemToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 4000);
  };

  // Enriched Menu Items with default portions/modifiers injection for dynamic demonstration
  const enrichedMenuItems = useMemo(() => {
    return menuItems.map((item) => {
      const lowerName = item.name.toLowerCase();
      let sizes = item.sizes || null;
      let modifierGroups = item.modifierGroups || null;
      let kitchenStation = item.kitchenStation || "kitchen";
      let allowCustomPrice = item.allowCustomPrice || false;
      let itemType = item.itemType || "item";
      let comboItems = item.comboItems || null;

      // In-memory mock seeding for cafeteria-style POS demonstration if database is empty
      if (!sizes && !modifierGroups && itemType === "item") {
        if (lowerName.includes("jollof") || lowerName.includes("rice")) {
          sizes = [
            { name: "Small Portion", price: Math.max(1000, item.price - 500) },
            { name: "Medium Portion", price: item.price },
            { name: "Large Portion", price: item.price + 800 },
          ];
          modifierGroups = [
            {
              groupName: "Protein Selection",
              selectionType: "single",
              required: true,
              options: [
                { name: "No Protein", price: 0 },
                { name: "Beef Portion", price: 800 },
                { name: "Spiced Chicken", price: 1500 },
                { name: "Fried Fish", price: 1800 },
              ],
            },
            {
              groupName: "Extras Selection",
              selectionType: "multiple",
              required: false,
              options: [
                { name: "Fried Plantain (Dodo)", price: 500 },
                { name: "Coleslaw Salad", price: 400 },
                { name: "Extra Stew Splash", price: 300 },
                { name: "Boiled Egg", price: 250 },
              ],
            },
          ];
          kitchenStation = "rice";
        } else if (
          lowerName.includes("chicken") ||
          lowerName.includes("beef") ||
          lowerName.includes("suya") ||
          lowerName.includes("meat")
        ) {
          sizes = [
            { name: "Standard Cut", price: item.price },
            { name: "Double Platter", price: item.price * 1.8 },
          ];
          modifierGroups = [
            {
              groupName: "Spice Level",
              selectionType: "single",
              required: true,
              options: [
                { name: "Mild Pepper", price: 0 },
                { name: "Medium Yaji", price: 150 },
                { name: "Extra Hot Pepper Sauce", price: 300 },
              ],
            },
          ];
          kitchenStation = "grill";
          allowCustomPrice = true;
        } else if (
          lowerName.includes("coke") ||
          lowerName.includes("drink") ||
          lowerName.includes("water") ||
          lowerName.includes("fanta")
        ) {
          sizes = [
            { name: "Glass/Can", price: item.price },
            { name: "Plastic bottle", price: item.price + 100 },
          ];
          kitchenStation = "drinks";
        } else if (lowerName.includes("salad") || lowerName.includes("coleslaw")) {
          sizes = [
            { name: "Side Plate", price: item.price },
            { name: "Meal Size", price: item.price + 600 },
          ];
          kitchenStation = "salad";
        }
      }

      // Check for Combo keyword shortcut
      if (lowerName.includes("combo") && itemType !== "combo") {
        itemType = "combo";
        comboItems = [
          { foodItemId: menuItems.find((x) => x.name.toLowerCase().includes("rice"))?.id || item.id, quantity: 1 },
          { foodItemId: menuItems.find((x) => x.name.toLowerCase().includes("chicken"))?.id || item.id, quantity: 1 },
        ];
      }

      return {
        ...item,
        itemType,
        sizes,
        modifierGroups,
        kitchenStation,
        allowCustomPrice,
        comboItems,
        basePrice: item.basePrice ?? item.price ?? 0,
      };
    });
  }, [menuItems]);

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
      new Set(enrichedMenuItems.map((i) => i.category).filter(Boolean))
    ).sort();
    return ["All", ...cats];
  }, [enrichedMenuItems]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return enrichedMenuItems.filter((item) => {
      if (!item.available) return false;
      if (activeCategory !== "All" && item.category !== activeCategory)
        return false;
      if (q && !item.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [enrichedMenuItems, activeCategory, search]);

  // Unit price resolver based on sizes base price + selected modifiers or overridden custom price
  const itemUnitPrice = (item: CartItem) => {
    if (item.allowCustomPrice && item.customPrice !== undefined && item.customPrice !== null) {
      return item.customPrice;
    }
    
    // Dynamically retrieve indoor pricing if active and available
    const dbItem = enrichedMenuItems.find((m) => m.id === item.id);
    const resolvedBasePrice = (pricingMode === "indoor" && dbItem?.indoorPrice && dbItem.indoorPrice > 0)
      ? dbItem.indoorPrice
      : item.basePrice;

    const base = item.selectedSize ? item.selectedSize.price : resolvedBasePrice;
    const mods = item.selectedModifiers.reduce((sum, m) => sum + m.price, 0);
    return base + mods;
  };

  const cartTotal = useMemo(
    () => cart.reduce((sum, item) => sum + itemUnitPrice(item) * item.quantity, 0),
    [cart, pricingMode, enrichedMenuItems]
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

  // ── Tactical Plate Builder Cart Operations ──────────────────────────────────

  const addToCart = useCallback((item: MenuItem) => {
    // 1. Combo shortcut: expand into constituent FoodItems instantly
    if (item.itemType === "combo" && item.comboItems && item.comboItems.length > 0) {
      const addedLogs: string[] = [];
      setCart((prev) => {
        const newPrev = [...prev];
        item.comboItems!.forEach((combo) => {
          const matchedItem = enrichedMenuItems.find((x) => x.id === combo.foodItemId);
          if (matchedItem) {
            addedLogs.push(matchedItem.name);
            // Smart merge: increment plain version if it already exists in tray
            const existingIdx = newPrev.findIndex(
              (c) => c.id === matchedItem.id && c.selectedModifiers.length === 0 && !c.selectedSize && !c.customPrice
            );
            if (existingIdx !== -1) {
              newPrev[existingIdx] = { ...newPrev[existingIdx], quantity: newPrev[existingIdx].quantity + combo.quantity };
            } else {
              newPrev.push({
                cartItemId: `cart-${Math.random().toString(36).substring(2, 9)}-${Date.now()}`,
                id: matchedItem.id,
                name: matchedItem.name,
                category: matchedItem.category,
                image: matchedItem.image || "",
                kitchenStation: matchedItem.kitchenStation || "kitchen",
                allowCustomPrice: matchedItem.allowCustomPrice || false,
                basePrice: matchedItem.basePrice ?? matchedItem.price ?? 0,
                selectedSize: null,
                selectedModifiers: [],
                customPrice: null,
                quantity: combo.quantity,
                itemNote: "",
              });
            }
          }
        });
        return newPrev;
      });
      showSystemToast(`Added ${addedLogs.join(", ")} to tray`);
      return;
    }

    // 2. ALL food items: one-tap instant add — no modal, no configuration gate.
    //    Modifiers and sizes are optional secondary actions available from the cart.
    setCart((prev) => {
      // Smart merge: if a plain version (no size, no modifiers, no custom price) already
      // exists in the tray, just increment its quantity instead of creating a duplicate line.
      const existingIdx = prev.findIndex(
        (c) => c.id === item.id && c.selectedModifiers.length === 0 && !c.selectedSize && !c.customPrice
      );
      if (existingIdx !== -1) {
        return prev.map((c, i) =>
          i === existingIdx ? { ...c, quantity: c.quantity + 1 } : c
        );
      }
      return [
        ...prev,
        {
          cartItemId: `cart-${Math.random().toString(36).substring(2, 9)}-${Date.now()}`,
          id: item.id,
          name: item.name,
          category: item.category,
          image: item.image || "",
          kitchenStation: item.kitchenStation || "kitchen",
          allowCustomPrice: item.allowCustomPrice || false,
          basePrice: item.basePrice ?? item.price ?? 0,
          selectedSize: null,
          selectedModifiers: [],
          customPrice: null,
          quantity: 1,
          itemNote: "",
        },
      ];
    });
  }, [enrichedMenuItems]);

  // Open customization popover for an item already inside the cart tray
  const triggerCustomize = (item: CartItem) => {
    const rawMenuItem = enrichedMenuItems.find((x) => x.id === item.id);
    if (!rawMenuItem) return;
    setCustomizingItem(rawMenuItem);
    setCustomizingCartItemId(item.cartItemId);
    setActiveSize(item.selectedSize || null);
    setActiveModifiers(item.selectedModifiers || []);
    setActiveCustomPrice(item.customPrice !== undefined && item.customPrice !== null ? item.customPrice.toString() : "");
    setActiveItemNote(item.itemNote || "");
  };

  // Apply customizations to new or existing line items inside the cart
  const saveCustomization = () => {
    if (!customizingItem) return;

    // Validate custom pricing permissions gate:
    if (activeCustomPrice && Number(activeCustomPrice) !== customizingItem.price) {
      if (role === "staff") {
        setVerifyingAction("custom_price");
        setPendingActionCallback(() => () => applyCustomizationToCart());
        return;
      }
    }

    applyCustomizationToCart();
  };

  const applyCustomizationToCart = () => {
    if (!customizingItem) return;
    const finalPriceOverride = activeCustomPrice ? Number(activeCustomPrice) : null;

    if (customizingCartItemId) {
      // Editing existing cart item
      setCart((prev) =>
        prev.map((c) =>
          c.cartItemId === customizingCartItemId
            ? {
                ...c,
                selectedSize: activeSize,
                selectedModifiers: activeModifiers,
                customPrice: finalPriceOverride,
                itemNote: activeItemNote.trim(),
              }
            : c
        )
      );
      // Record audit details
      setAuditLog((prev) => [
        ...prev,
        {
          action: "item_customized",
          itemId: customizingItem.id,
          cartItemId: customizingCartItemId,
          timestamp: new Date().toISOString(),
          details: `Updated customized ${customizingItem.name}. Size: ${activeSize?.name || "None"}, Modifiers count: ${activeModifiers.length}`,
        },
      ]);
    } else {
      // Adding new customized item
      const newCartItem: CartItem = {
        cartItemId: `cart-${Math.random().toString(36).substring(2, 9)}-${Date.now()}`,
        id: customizingItem.id,
        name: customizingItem.name,
        category: customizingItem.category,
        image: customizingItem.image || "",
        kitchenStation: customizingItem.kitchenStation || "kitchen",
        allowCustomPrice: customizingItem.allowCustomPrice || false,
        basePrice: customizingItem.basePrice ?? customizingItem.price ?? 0,
        selectedSize: activeSize,
        selectedModifiers: activeModifiers,
        customPrice: finalPriceOverride,
        quantity: 1,
        itemNote: activeItemNote.trim(),
      };
      setCart((prev) => [...prev, newCartItem]);
      setAuditLog((prev) => [
        ...prev,
        {
          action: "item_customized_added",
          itemId: customizingItem.id,
          timestamp: new Date().toISOString(),
          details: `Added customized ${customizingItem.name} to tray. Size: ${activeSize?.name || "None"}, Modifiers count: ${activeModifiers.length}`,
        },
      ]);
    }

    setCustomizingItem(null);
    setCustomizingCartItemId(null);
    setActiveSize(null);
    setActiveModifiers([]);
    setActiveCustomPrice("");
    setActiveItemNote("");
    setPinInput("");
    setPinError(null);
    setVerifyingAction(null);
    setPendingActionCallback(null);
  };

  const updateQuantity = useCallback((cartItemId: string, delta: number) => {
    setCart((prev) => {
      const item = prev.find((x) => x.cartItemId === cartItemId);
      if (item && delta < 0 && item.quantity === 1) {
        // Void/delete authorization gate for staff
        if (role === "staff") {
          setVerifyingAction("void_item");
          setPendingActionCallback(() => () => executeVoidItem(cartItemId));
          return prev;
        }
      }
      return prev
        .map((c) => (c.cartItemId === cartItemId ? { ...c, quantity: c.quantity + delta } : c))
        .filter((c) => c.quantity > 0);
    });
  }, [role]);

  const executeVoidItem = (cartItemId: string) => {
    setCart((prev) => prev.filter((c) => c.cartItemId !== cartItemId));
    setAuditLog((prev) => [
      ...prev,
      {
        action: "void_item_approved",
        cartItemId,
        timestamp: new Date().toISOString(),
        details: `Manager authorized void of line item.`,
      },
    ]);
    setVerifyingAction(null);
    setPinInput("");
  };

  const removeFromCart = useCallback((cartItemId: string) => {
    if (role === "staff") {
      setVerifyingAction("void_item");
      setPendingActionCallback(() => () => executeVoidItem(cartItemId));
      return;
    }
    executeVoidItem(cartItemId);
  }, [role]);

  // ── Manager PIN authorization check ──
  const verifyPin = () => {
    if (pinInput === "1234" || pinInput === "5555") {
      showSystemToast("Manager override approved!");
      if (pendingActionCallback) {
        pendingActionCallback();
      }
    } else {
      setPinError("Invalid manager PIN code. Try '1234' or '5555'.");
    }
  };

  // ── Offline resilience retries ──
  const syncOfflineQueue = async () => {
    if (offlineOrders.length === 0 || syncingOffline) return;
    setSyncingOffline(true);
    let successCount = 0;
    const remaining = [...offlineOrders];

    try {
      while (remaining.length > 0) {
        const nextOrder = remaining[0];
        const res = await fetch("/api/admin/pos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(nextOrder),
        });
        if (res.ok) {
          remaining.shift();
          successCount++;
        } else {
          break; // Stop retry queue if api fails
        }
      }
      setOfflineOrders(remaining);
      if (successCount > 0) {
        showSystemToast(`Successfully synced ${successCount} cached offline order${successCount > 1 ? "s" : ""}!`);
      }
    } catch (_) {
      showSystemToast("Sync failed. Check connection.");
    } finally {
      setSyncingOffline(false);
    }
  };

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
          items: cart.map((c) => ({
            id: c.id,
            quantity: c.quantity,
            selectedSize: c.selectedSize,
            selectedModifiers: c.selectedModifiers,
            customPrice: c.customPrice,
            itemNote: c.itemNote,
            kitchenStation: c.kitchenStation,
          })),
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
      localStorage.removeItem("rf_pos_draft_cart");
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
    setAuditLog([]);
    setEditingOrderId(null);
    setSelectedWaiterName(null);
    setPricingMode("regular");
    setPrintCopies(2);
    localStorage.removeItem("rf_pos_draft_cart");
  };

  const handleEditOrder = useCallback((bill: TodayOrder) => {
    // Load items into cart
    const loadedCart: CartItem[] = bill.items.map((item) => ({
      cartItemId: `cart-${Math.random().toString(36).substring(2, 9)}-${Date.now()}`,
      id: item.id,
      name: item.name,
      category: item.category || "Other",
      image: item.image || "",
      kitchenStation: item.kitchenStation || "kitchen",
      allowCustomPrice: item.allowCustomPrice || false,
      basePrice: item.basePrice ?? item.price ?? 0,
      selectedSize: item.selectedSize || null,
      selectedModifiers: item.selectedModifiers || [],
      customPrice: item.customPrice || null,
      quantity: item.quantity,
      itemNote: item.itemNote || "",
    }));

    setCart(loadedCart);
    setCustomerName(bill.customerName === "Walk-in Customer" || bill.customerName === bill.tableLabel ? "" : bill.customerName || "");
    setServiceMode(bill.serviceMode as ServiceMode);
    
    if (bill.serviceMode === "dine_in") {
      if (bill.tableLabel?.startsWith("Table ")) {
        setTableLabel(bill.tableLabel);
        setTableLabelInput("");
      } else {
        setTableLabel("");
        setTableLabelInput(bill.tableLabel || "");
      }
    } else {
      setTableLabel("");
      setTableLabelInput("");
    }
    
    setNote(bill.note || "");
    setPaymentMethod((bill.paymentMethod as PaymentMethod) || "cash");
    setPaymentStatus((bill.paymentStatus as PaymentStatus) || "unpaid");
    setSelectedWaiterName(bill.waiterName || null);
    setPricingMode((bill.pricingMode as "regular" | "indoor") || "regular");
    setEditingOrderId(bill.id);
    setRightTab("order");
    showSystemToast(`Loaded Order #${bill.id.slice(-6).toUpperCase()} for editing`);
  }, []);

  const handleSubmit = async () => {
    if (cart.length === 0 || submitting) return;

    if (tabMode === "continue" && activeTab) {
      return handleAddToTab();
    }

    const finalTableLabel = tableLabelInput.trim() || tableLabel;

    if (serviceMode === "dine_in" && !finalTableLabel) {
      setError("Please select or enter a table number for dine-in orders.");
      return;
    }

    const orderPayload = {
      items: cart.map((c) => ({
        id: c.id,
        quantity: c.quantity,
        selectedSize: c.selectedSize,
        selectedModifiers: c.selectedModifiers,
        customPrice: c.customPrice,
        itemNote: c.itemNote,
        kitchenStation: c.kitchenStation,
      })),
      paymentMethod,
      paymentStatus,
      customerName: customerName.trim() || "",
      note: note.trim(),
      staffName,
      serviceMode,
      tableLabel: finalTableLabel,
      waiterName: selectedWaiterName,
      pricingMode,
      auditLog,
    };

    setSubmitting(true);
    setError(null);
    try {
      const url = editingOrderId ? `/api/admin/pos/${editingOrderId}` : "/api/admin/pos";
      const method = editingOrderId ? "PATCH" : "POST";
      
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(orderPayload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to save order");
        return;
      }
      
      const completed = {
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
        waiterName: selectedWaiterName,
        pricingMode,
        createdAt: new Date(),
      };
      
      setCompletedOrder(completed);
      openPOSReceiptWindow(completed, restaurant.name, staffName, printCopies);
      localStorage.removeItem("rf_pos_draft_cart");
    } catch {
      // Offline fallback: cache order and show success page
      const mockOfflineId = `offline-${Math.random().toString(36).substring(2, 9)}-${Date.now()}`;
      const offlineOrder: CompletedOrder = {
        orderId: mockOfflineId,
        items: cart.map((c) => ({
          id: c.id,
          name: c.name,
          price: itemUnitPrice(c),
          quantity: c.quantity,
          selectedSize: c.selectedSize,
          selectedModifiers: c.selectedModifiers,
          itemNote: c.itemNote,
        })),
        itemsTotal: cartTotal,
        total: cartTotal,
        paymentMethod,
        paymentStatus,
        customerName: customerName.trim() || (serviceMode === "dine_in" ? finalTableLabel : "Walk-in Guest"),
        note: note.trim(),
        serviceMode,
        tableLabel: finalTableLabel,
        createdAt: new Date(),
        isOffline: true,
      };

      setOfflineOrders((prev) => [...prev, orderPayload]);
      setCompletedOrder(offlineOrder);
      showSystemToast("Internet offline. Order stored locally.");
      localStorage.removeItem("rf_pos_draft_cart");
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
        onPrint={() => openPOSReceiptWindow(completedOrder, restaurant.name, staffName, printCopies)}
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

      {/* ── Waiter Manager Modal overlay ─────────────────────────── */}
      {showWaiterManager && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-3xl shadow-xl overflow-hidden animate-in fade-in zoom-in duration-200">
            {/* Header */}
            <div className="bg-gradient-to-r from-orange-500 to-orange-600 px-6 py-4 flex items-center justify-between">
              <h3 className="text-white font-black text-lg">Manage Waiters</h3>
              <button
                type="button"
                onClick={() => setShowWaiterManager(false)}
                className="text-white/85 hover:text-white font-black text-xl leading-none"
              >
                ×
              </button>
            </div>
            {/* Body */}
            <div className="p-6 space-y-4">
              {/* Add form */}
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Enter waiter's full name"
                  value={newWaiterName}
                  onChange={(e) => setNewWaiterName(e.target.value)}
                  className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-orange-500 bg-gray-50 font-semibold"
                />
                <button
                  type="button"
                  onClick={async () => {
                    const nameTrim = newWaiterName.trim();
                    if (!nameTrim) return;
                    try {
                      const res = await fetch("/api/admin/waiters", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ name: nameTrim }),
                      });
                      if (!res.ok) {
                        const data = await res.json();
                        throw new Error(data.error || "Failed to add waiter");
                      }
                      setNewWaiterName("");
                      showSystemToast(`Added waiter "${nameTrim}" successfully`);
                    } catch (e: any) {
                      showSystemToast(e.message || "Failed to add waiter");
                    }
                  }}
                  className="bg-orange-600 hover:bg-orange-500 text-white font-black px-4 py-2.5 rounded-xl text-sm transition-colors"
                >
                  Add
                </button>
              </div>

              {/* Waiters List */}
              <div className="border border-gray-100 rounded-2xl overflow-hidden max-h-60 overflow-y-auto divide-y divide-gray-100">
                {waiters.length === 0 ? (
                  <div className="p-6 text-center text-gray-400 text-xs font-bold bg-gray-50/30">
                    No waiters registered yet.
                  </div>
                ) : (
                  waiters.map((w) => (
                    <div key={w.id} className="px-4 py-3 flex items-center justify-between gap-3 bg-white hover:bg-gray-50/50">
                      <span className="font-bold text-gray-800 text-sm">{w.name}</span>
                      <button
                        type="button"
                        onClick={async () => {
                          if (confirm(`Are you sure you want to remove ${w.name}?`)) {
                            try {
                              const res = await fetch(`/api/admin/waiters?id=${w.id}`, {
                                method: "DELETE",
                              });
                              if (!res.ok) {
                                const data = await res.json();
                                throw new Error(data.error || "Failed to remove waiter");
                              }
                              showSystemToast(`Removed waiter "${w.name}"`);
                            } catch (e: any) {
                              showSystemToast(e.message || "Failed to remove waiter");
                            }
                          }
                        }}
                        className="text-red-500 hover:text-red-700 font-bold text-xs px-2.5 py-1.5 rounded-lg hover:bg-red-50 transition-colors"
                      >
                        Remove
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
            {/* Footer */}
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end">
              <button
                type="button"
                onClick={() => setShowWaiterManager(false)}
                className="bg-gray-900 hover:bg-gray-850 text-white font-black px-5 py-2.5 rounded-xl text-xs transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
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
            openPOSReceiptWindow(order, restaurant.name, staffName, 1)
          }
        />
      )}

      {/* ── Two-column POS layout ─────────────────────────────────── */}
      <div className="flex flex-col lg:flex-row flex-1 overflow-hidden min-h-0">
        {/* LEFT: Menu — hidden on mobile when cart is open */}
        <div className={`flex-col min-w-0 overflow-hidden bg-gray-50 ${mobileCartOpen ? "hidden lg:flex" : "flex"} flex-1`}>
          {/* Top bar with offline status pills */}
          <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between flex-shrink-0 gap-3">
            <div className="flex items-center gap-3">
              <h1 className="font-black text-gray-900 text-base whitespace-nowrap hidden sm:block">
                POS / Counter Sales
              </h1>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Online Mode</span>
              </div>
              {offlineOrders.length > 0 && (
                <button
                  onClick={syncOfflineQueue}
                  disabled={syncingOffline}
                  className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-full font-black text-[10px] uppercase tracking-wider transition-all border border-amber-200 animate-pulse shrink-0"
                >
                  ⚠️ {syncingOffline ? "Syncing..." : `${offlineOrders.length} Offline Pending (Sync)`}
                </button>
              )}
            </div>
            <div className="flex-1 max-w-md">
              <input
                type="text"
                placeholder="Search menu items..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-orange-500 bg-gray-50 transition-all"
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
                  const inCartCount = cart.filter((c) => c.id === item.id).reduce((sum, c) => sum + c.quantity, 0);
                  return (
                    <button
                      key={item.id}
                      onClick={() => addToCart(item)}
                      className={`relative bg-white rounded-2xl border-2 p-3 text-left transition-all hover:shadow-md active:scale-95 ${
                        inCartCount > 0
                          ? "border-orange-500 shadow-sm bg-orange-50/30"
                          : "border-gray-100 hover:border-orange-200"
                      }`}
                    >
                      {inCartCount > 0 && (
                        <span className="absolute top-2 right-2 bg-orange-600 text-white text-xs font-black w-5 h-5 rounded-full flex items-center justify-center leading-none">
                          {inCartCount}
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
          {/* Mobile sticky cart bar — appears when cart has items */}
          {cartCount > 0 && (
            <button
              onClick={() => setMobileCartOpen(true)}
              className="lg:hidden flex items-center justify-between px-5 py-4 bg-orange-600 text-white font-black text-sm flex-shrink-0 active:bg-orange-700 transition-colors"
            >
              <span className="flex items-center gap-2">
                <span className="bg-white/20 rounded-full w-6 h-6 flex items-center justify-center text-xs font-black">
                  {cartCount}
                </span>
                {cartCount} item{cartCount !== 1 ? "s" : ""}
              </span>
              <span className="flex items-center gap-2">
                {fmt(cartTotal)}
                <span className="text-orange-200 text-xs">View Cart →</span>
              </span>
            </button>
          )}
        </div>

        {/* RIGHT: Cart + Payment — hidden on mobile when cart is closed */}
        <div className={`bg-white border-gray-200 flex flex-col flex-shrink-0 ${
          mobileCartOpen
            ? "flex flex-1 lg:flex-none lg:w-[360px] xl:w-[400px] border-t lg:border-t-0 lg:border-l"
            : "hidden lg:flex lg:w-[360px] xl:w-[400px] lg:border-l"
        }`}>

          {/* Mobile: back to menu button */}
          {mobileCartOpen && (
            <button
              onClick={() => setMobileCartOpen(false)}
              className="lg:hidden flex items-center gap-2 px-4 py-3 bg-gray-50 border-b border-gray-200 text-sm font-bold text-gray-600 hover:text-gray-900 flex-shrink-0 transition-colors"
            >
              ← Back to Menu
            </button>
          )}

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
              onEdit={handleEditOrder}
            />
          )}

          {/* ── Service mode selector ─────────────────────────────── */}
          {rightTab === "order" && (<>
          <div className="px-4 pt-3 pb-2 border-b border-gray-100 flex-shrink-0 space-y-2.5">
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

            {/* Pricing Mode Toggle Segment */}
            <div className="flex rounded-xl overflow-hidden border border-gray-200 bg-gray-50/50 p-0.5">
              <button
                type="button"
                onClick={() => setPricingMode("regular")}
                className={`flex-1 py-1.5 rounded-lg text-[10px] font-black transition-colors ${
                  pricingMode === "regular"
                    ? "bg-white text-gray-900 shadow-sm border border-gray-150"
                    : "text-gray-500 hover:text-gray-800"
                }`}
              >
                Outside / Regular Menu
              </button>
              <button
                type="button"
                onClick={() => setPricingMode("indoor")}
                className={`flex-1 py-1.5 rounded-lg text-[10px] font-black transition-colors ${
                  pricingMode === "indoor"
                    ? "bg-orange-600 text-white shadow-sm border border-orange-700/10"
                    : "text-gray-500 hover:bg-orange-50 hover:text-orange-700"
                }`}
              >
                Indoor VIP Lounge
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

          {/* Editing Active Bill Banner */}
          {editingOrderId && (
            <div className="bg-amber-50 border-b border-amber-200 px-4 py-2.5 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-black text-amber-800 uppercase tracking-wide">Editing Active Bill</p>
                <p className="text-[10px] text-amber-600 font-bold font-mono">Order ID: #{editingOrderId.slice(-6).toUpperCase()}</p>
              </div>
              <button
                onClick={() => {
                  setEditingOrderId(null);
                  resetPOS();
                  showSystemToast("Order editing cancelled");
                }}
                className="bg-amber-100 hover:bg-amber-200 active:bg-amber-300 text-amber-800 text-[10px] font-black px-2.5 py-1.5 rounded-lg transition-colors"
              >
                Cancel Edit
              </button>
            </div>
          )}

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

          {/* Cart items list */}
          <div className="flex-1 overflow-y-auto divide-y divide-gray-50 min-h-0">
            {cart.length === 0 ? (
              <div className="py-12 text-center text-gray-400 text-sm px-6">
                <p className="text-2xl mb-2">🛒</p>
                {tabMode === "continue" && activeTab
                  ? `Add new items to ${activeTab.tableLabel}`
                  : "Tap items from the menu to add them here."}
              </div>
            ) : (
              cart.map((item) => {
                const rawMenuItem = enrichedMenuItems.find((x) => x.id === item.id);
                const isCustomizable = !!(
                  rawMenuItem &&
                  ((rawMenuItem.sizes && rawMenuItem.sizes.length > 0) ||
                    (rawMenuItem.modifierGroups && rawMenuItem.modifierGroups.length > 0) ||
                    rawMenuItem.allowCustomPrice)
                );
                return (
                <div key={item.cartItemId} className="flex flex-col gap-1 px-4 py-3 border-b border-gray-50 bg-white hover:bg-gray-50/50 transition-colors">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="font-bold text-gray-900 text-sm truncate">
                          {item.name}
                        </p>
                        {item.selectedSize && (
                          <span className="text-[9px] font-black bg-orange-100 text-orange-800 px-2 py-0.5 rounded-full shrink-0">
                            {item.selectedSize.name}
                          </span>
                        )}
                        {isCustomizable && (
                          <button
                            onClick={() => triggerCustomize(item)}
                            className="text-[9px] font-black px-2 py-0.5 rounded-full shrink-0 border transition-colors bg-gray-50 text-gray-400 border-gray-200 hover:bg-orange-50 hover:text-orange-600 hover:border-orange-200"
                          >
                            ✏ Edit
                          </button>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 font-medium">
                        {fmt(itemUnitPrice(item))} each
                      </p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => updateQuantity(item.cartItemId, -1)}
                        className="w-6 h-6 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-black text-sm flex items-center justify-center leading-none transition-colors"
                      >
                        −
                      </button>
                      <span className="w-7 text-center font-black text-sm tabular-nums">
                        {item.quantity}
                      </span>
                      <button
                        onClick={() => updateQuantity(item.cartItemId, 1)}
                        className="w-6 h-6 rounded-full bg-orange-100 hover:bg-orange-200 text-orange-700 font-black text-sm flex items-center justify-center leading-none transition-colors"
                      >
                        +
                      </button>
                    </div>
                    <p className="text-sm font-black text-gray-900 w-16 text-right flex-shrink-0 tabular-nums">
                      {fmt(itemUnitPrice(item) * item.quantity)}
                    </p>
                    <button
                      onClick={() => removeFromCart(item.cartItemId)}
                      className="text-gray-300 hover:text-red-500 text-lg leading-none flex-shrink-0 w-5 text-center transition-colors"
                      aria-label="Remove item"
                    >
                      ×
                    </button>
                  </div>
                  {/* Modifiers extra options bullet layout */}
                  {item.selectedModifiers && item.selectedModifiers.length > 0 && (
                    <div className="pl-2 space-y-0.5 border-l border-gray-100 ml-1 mt-0.5">
                      {item.selectedModifiers.map((mod, idx) => (
                        <p key={idx} className="text-[10px] text-gray-400 font-bold">
                          ↳ <span className="text-gray-500 font-black">{mod.groupName}:</span> {mod.name} (+{fmt(mod.price)})
                        </p>
                      ))}
                    </div>
                  )}
                  {/* Note override */}
                  {item.itemNote && (
                    <p className="text-[10px] text-orange-600 font-bold pl-2 italic mt-0.5">
                      * Note: {item.itemNote}
                    </p>
                  )}
                </div>
                );
              })
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

            {/* Waiter selection */}
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                  Attendant / Waiter
                </p>
                <button
                  type="button"
                  onClick={() => setShowWaiterManager(true)}
                  className="text-[10px] font-bold text-orange-600 hover:text-orange-700 hover:underline"
                >
                  Manage Waiters
                </button>
              </div>
              <select
                value={selectedWaiterName || ""}
                onChange={(e) => setSelectedWaiterName(e.target.value || null)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-orange-500 bg-gray-50 transition-colors font-semibold"
              >
                <option value="">-- Assign Attendant (Optional) --</option>
                {waiters.map((w) => (
                  <option key={w.id} value={w.name}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>

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

            {/* Print copies selector */}
            <div>
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">
                Print Tickets
              </p>
              <div className="grid grid-cols-3 gap-1.5">
                {([1, 2, 3] as const).map((copies) => (
                  <button
                    key={copies}
                    type="button"
                    onClick={() => setPrintCopies(copies)}
                    className={`py-1.5 rounded-xl text-xs font-black transition-colors ${
                      printCopies === copies
                        ? "bg-orange-600 text-white"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-200"
                    }`}
                  >
                    {copies === 1
                      ? "1 Copy (Customer)"
                      : copies === 2
                      ? "2 Copies (Cust+KOT)"
                      : "3 Copies (Cust+KOT+Audit)"}
                  </button>
                ))}
              </div>
            </div>

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
                editingOrderId
                  ? "bg-amber-600 hover:bg-amber-500 active:bg-amber-700"
                  : tabMode === "continue"
                  ? "bg-teal-700 hover:bg-teal-600 active:bg-teal-800"
                  : serviceMode === "dine_in"
                  ? "bg-teal-600 hover:bg-teal-500 active:bg-teal-700"
                  : "bg-orange-600 hover:bg-orange-500 active:bg-orange-700"
              }`}
            >
              {submitting
                ? editingOrderId
                  ? "Saving Changes…"
                  : tabMode === "continue"
                  ? "Adding to Tab…"
                  : "Creating Order…"
                : cart.length === 0
                ? tabMode === "continue" ? "Add items to continue" : "Add items to confirm"
                : editingOrderId
                ? `Save Changes · ${fmt(cartTotal)}`
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

      {/* ── 1. Plate Configurator / Modifier Selector Drawer overlay ────────────────── */}
      {customizingItem && (
        <div className="absolute inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in">
          <div className="bg-white w-full sm:max-w-xl sm:rounded-3xl shadow-2xl flex flex-col max-h-[92vh] sm:max-h-[85vh] overflow-hidden">
            {/* Header */}
            <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between flex-shrink-0 bg-gray-50">
              <div>
                <span className="text-[10px] font-black uppercase text-orange-600 bg-orange-50 px-2.5 py-1 rounded-full shrink-0">
                  Customize · {customizingItem.category}
                </span>
                <h3 className="text-lg font-black text-gray-900 mt-1.5 leading-tight">
                  {customizingItem.name}
                </h3>
              </div>
              <button
                onClick={() => setCustomizingItem(null)}
                className="w-9 h-9 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 font-bold text-lg transition-colors"
              >
                ×
              </button>
            </div>

            {/* Scrollable plate customized selections options */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Portion Sizes Selection */}
              {customizingItem.sizes && customizingItem.sizes.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest">
                    1. Select Portion Size <span className="text-red-500">*</span>
                  </h4>
                  <div className="grid grid-cols-3 gap-2">
                    {customizingItem.sizes.map((sz) => {
                      const isSelected = activeSize?.name === sz.name;
                      return (
                        <button
                          key={sz.name}
                          onClick={() => setActiveSize(sz)}
                          className={`p-3 rounded-2xl border text-left flex flex-col justify-between min-h-[72px] transition-all relative ${
                            isSelected
                              ? "border-orange-500 bg-orange-50/20 ring-2 ring-orange-500/20"
                              : "border-gray-200 hover:border-orange-200 bg-white"
                          }`}
                        >
                          <span className={`text-[10px] font-black uppercase tracking-wider ${isSelected ? "text-orange-700" : "text-gray-400"}`}>
                            {sz.name}
                          </span>
                          <span className="text-sm font-black text-gray-900 mt-2">{fmt(sz.price)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Modifier Groups selections */}
              {customizingItem.modifierGroups && customizingItem.modifierGroups.map((group) => (
                <div key={group.groupName} className="space-y-2.5 border-t border-gray-100 pt-5">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest">
                      {group.groupName}
                    </h4>
                    <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${
                      group.required
                        ? "bg-red-50 text-red-600 border border-red-100"
                        : "bg-gray-100 text-gray-500"
                    }`}>
                      {group.required ? "Required" : "Optional"}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {group.options.map((opt) => {
                      const isSelected = activeModifiers.some(
                        (m) => m.groupName === group.groupName && m.name === opt.name
                      );

                      const handleSelect = () => {
                        if (group.selectionType === "single") {
                          setActiveModifiers((prev) => [
                            ...prev.filter((m) => m.groupName !== group.groupName),
                            { groupName: group.groupName, name: opt.name, price: opt.price },
                          ]);
                        } else {
                          setActiveModifiers((prev) => {
                            if (isSelected) {
                              return prev.filter(
                                (m) => !(m.groupName === group.groupName && m.name === opt.name)
                              );
                            } else {
                              return [
                                ...prev,
                                { groupName: group.groupName, name: opt.name, price: opt.price },
                              ];
                            }
                          });
                        }
                      };

                      return (
                        <button
                          key={opt.name}
                          onClick={handleSelect}
                          className={`p-3 rounded-2xl border text-left flex items-center justify-between transition-all ${
                            isSelected
                              ? "border-teal-600 bg-teal-50/10 ring-2 ring-teal-600/20"
                              : "border-gray-200 hover:border-teal-200 bg-white"
                          }`}
                        >
                          <div className="min-w-0 pr-2">
                            <p className={`text-xs font-bold truncate ${isSelected ? "text-teal-900" : "text-gray-700"}`}>
                              {opt.name}
                            </p>
                          </div>
                          <span className={`text-xs font-black shrink-0 ${isSelected ? "text-teal-700" : "text-gray-400"}`}>
                            {opt.price === 0 ? "Free" : `+${fmt(opt.price)}`}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}

              {/* Special Plating notes */}
              <div className="space-y-2 border-t border-gray-100 pt-5">
                <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest">
                  Plating & Custom Notes
                </h4>
                <input
                  type="text"
                  placeholder="e.g. Extra spicy, packaging separate, sauce splash on rice..."
                  value={activeItemNote}
                  onChange={(e) => setActiveItemNote(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-orange-500 bg-gray-50 transition-all font-medium"
                />
              </div>

              {/* Custom Price Overrides option */}
              {customizingItem.allowCustomPrice && (
                <div className="space-y-2 border-t border-gray-100 pt-5">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest">
                      Custom Market Price Override
                    </h4>
                    <span className="text-[9px] font-black uppercase text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full shrink-0 border border-amber-200">
                      Requires Approval
                    </span>
                  </div>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-black text-gray-400 text-sm">₦</span>
                    <input
                      type="number"
                      placeholder={`Enter manual price override (Base: ₦${customizingItem.price.toLocaleString()})`}
                      value={activeCustomPrice}
                      onChange={(e) => setActiveCustomPrice(e.target.value)}
                      className="w-full border border-gray-200 rounded-xl pl-8 pr-4 py-2.5 text-sm outline-none focus:border-orange-500 bg-gray-50 transition-all font-mono"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Builder Footer */}
            <div className="px-6 py-5 border-t border-gray-100 bg-gray-50 flex items-center justify-between flex-shrink-0 gap-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-wider text-gray-400">Total Plate Price</p>
                <p className="text-2xl font-black text-gray-900 mt-0.5 tabular-nums">
                  {fmt(
                    activeCustomPrice
                      ? Number(activeCustomPrice)
                      : (activeSize ? activeSize.price : customizingItem.price) +
                          activeModifiers.reduce((sum, m) => sum + m.price, 0)
                  )}
                </p>
              </div>
              <button
                onClick={saveCustomization}
                className="bg-orange-600 hover:bg-orange-500 active:bg-orange-700 text-white font-black px-8 py-3 rounded-2xl transition-all shadow-md shadow-orange-600/10 text-sm shrink-0"
              >
                Update Tray
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 2. Manager Authorization PIN Override dialog ─────────────────────────── */}
      {verifyingAction && (
        <div className="absolute inset-0 bg-black/75 z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden p-6 text-center animate-scale-in border border-gray-100">
            <div className="w-12 h-12 bg-amber-50 text-amber-500 rounded-2xl flex items-center justify-center mx-auto mb-4 text-xl border border-amber-200">
              🔑
            </div>
            <h3 className="font-black text-gray-900 text-lg">Manager Override Required</h3>
            <p className="text-xs text-gray-400 mt-1 font-bold">
              {verifyingAction === "void_item"
                ? "Manager approval is needed to VOID an item from active tray."
                : "Manager approval is needed to APPLY custom manual pricing overrides."}
            </p>

            <div className="mt-5">
              <input
                type="password"
                maxLength={4}
                placeholder="••••"
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value)}
                className="w-32 text-center text-2xl font-mono tracking-[0.6em] border-2 border-gray-200 focus:border-amber-500 outline-none rounded-2xl px-3 py-2 bg-gray-50 focus:ring-4 focus:ring-amber-500/10 transition-all"
              />
              {pinError && <p className="text-[10px] text-red-500 font-bold mt-2">{pinError}</p>}
            </div>

            <div className="flex gap-2.5 mt-6">
              <button
                onClick={() => {
                  setVerifyingAction(null);
                  setPinInput("");
                  setPinError(null);
                  setPendingActionCallback(null);
                }}
                className="flex-1 border border-gray-200 hover:bg-gray-50 text-gray-600 font-black py-3 rounded-xl transition-colors text-xs"
              >
                Cancel
              </button>
              <button
                onClick={verifyPin}
                className="flex-1 bg-amber-500 hover:bg-amber-600 text-white font-black py-3 rounded-xl transition-colors text-xs"
              >
                Authorize Action
              </button>
            </div>
            <p className="text-[9px] text-gray-300 mt-4 uppercase tracking-wider font-bold">
              Demo Manager PIN Code is 1234 or 5555
            </p>
          </div>
        </div>
      )}

      {/* ── 3. Premium Toast alerts banner ────────────────────────────────────────── */}
      {toastMsg && (
        <div className="fixed bottom-4 left-4 z-[70] bg-gray-900/95 backdrop-blur text-white rounded-2xl shadow-2xl px-4 py-3.5 flex items-center gap-2.5 font-bold text-xs border border-gray-800 animate-slide-in">
          <span className="w-5 h-5 rounded-full bg-green-500/20 text-green-400 flex items-center justify-center font-bold text-sm shrink-0">✓</span>
          <span>{toastMsg}</span>
        </div>
      )}
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
  onEdit,
}: {
  bills: TodayOrder[];
  onSettle: (orderId: string) => void;
  onEdit: (bill: TodayOrder) => void;
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
    <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-0">
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

        return (
          <div
            key={bill.id}
            className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm"
          >
            {/* Table label + amount */}
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="min-w-0">
                <p className="font-black text-teal-700 text-xl leading-tight truncate">
                  {bill.tableLabel || `#${shortId}`}
                </p>
                <p className="text-gray-400 text-xs font-medium mt-0.5">
                  {bill.items.length} item{bill.items.length !== 1 ? "s" : ""} · {age}
                </p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="font-black text-gray-900 text-xl tabular-nums">
                  {fmt(bill.total)}
                </p>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  bill.paymentStatus === "part_paid"
                    ? "bg-yellow-100 text-yellow-700"
                    : "bg-red-100 text-red-600"
                }`}>
                  {bill.paymentStatus === "part_paid" ? "Part Paid" : "Unpaid"}
                </span>
              </div>
            </div>

            {/* Customer, Waiter, and Pricing Mode Info */}
            {(bill.customerName || bill.waiterName || bill.pricingMode === "indoor") && (
              <div className="bg-gray-50 rounded-xl px-3 py-2 text-[11px] space-y-1 text-gray-600 font-semibold mb-3 border border-gray-100">
                {bill.customerName && bill.customerName !== bill.tableLabel && (
                  <div>👤 Cust: <span className="font-bold text-gray-800">{bill.customerName}</span></div>
                )}
                {bill.waiterName && (
                  <div>🤵 Waiter: <span className="font-bold text-gray-800">{bill.waiterName}</span></div>
                )}
                {bill.pricingMode === "indoor" && (
                  <div className="text-orange-600 font-bold">✨ Indoor VIP Pricing Active</div>
                )}
              </div>
            )}

            {/* Status indicators */}
            {bill.status === "completed" && (
              <p className="text-xs font-bold text-green-600 mb-2.5">✓ Food served</p>
            )}
            {bill.status === "ready" && (
              <p className="text-xs font-bold text-purple-600 mb-2.5">🟣 Ready to serve</p>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onEdit(bill)}
                className="flex-1 bg-gray-100 hover:bg-gray-200 active:bg-gray-300 text-gray-700 font-black text-sm py-3.5 rounded-xl transition-colors border border-gray-200"
              >
                Edit Order
              </button>
              <button
                type="button"
                onClick={() => onSettle(bill.id)}
                className="flex-1 bg-teal-600 hover:bg-teal-500 active:bg-teal-700 text-white font-black text-sm py-3.5 rounded-xl transition-colors"
              >
                Settle Bill
              </button>
            </div>
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
              className="w-full border-2 border-gray-400 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-teal-500 bg-white text-gray-900 placeholder:text-gray-500"
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
  onPrint,
}: {
  order: CompletedOrder;
  restaurant: { name: string; slug: string };
  staffName: string;
  onNewOrder: () => void;
  onPrint: () => void;
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
            onClick={onPrint}
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
            onClick={onPrint}
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
