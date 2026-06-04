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
import {
  openOfflineDB,
  verifyOfflinePin,
  getDeviceId,
  getTerminalName,
  setTerminalName,
  getLastSyncTime,
  setLastSyncTime,
  dbPut,
  dbGetAll,
  dbDelete,
  dbClear,
  OfflineStaff,
  OfflineMenuItem,
  OfflineOrder
} from "@/lib/offline-db";

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
  waiterName?: string | null;
  pricingMode?: string | null;
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
  cancellationRequested?: boolean;
  cancellationReason?: string;
  cancellationRequestedBy?: string;
  cancellationRequestedAt?: any;
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
  restaurant: {
    slug: string;
    name: string;
    cancellationManagerPinEnabled?: boolean;
    cancellationOwnerApprovalEnabled?: boolean;
  };
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
    cash: "CASH",
    bank_transfer: "BANK TRANSFER",
    card: "CARD / POS",
    unpaid: "UNPAID / DEFER",
  };

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
         <div class="kv"><span class="kl">Subtotal:</span><span class="kv-v">₦${(order.itemsTotal ?? order.total).toLocaleString("en-NG")}</span></div>
         <div class="total"><span>TOTAL DUE:</span><span>₦${order.total.toLocaleString("en-NG")}</span></div>
         <div class="div"></div>
         <div class="payment-method-row">
           PAYMENT METHOD: ${pmLabels[order.paymentMethod] ?? (order.paymentMethod ?? "CASH").toUpperCase()} (${order.paymentStatus === "paid" ? "PAID ✓" : "UNPAID"})
         </div>`;

    const sourceHtml = isDineIn
      ? `<div class="kv"><span class="kl">Service:</span><span class="kv-v" style="text-decoration:underline">DINE-IN</span></div>
         <div class="kv"><span class="kl">Table:</span><span class="kv-v kv-table">${order.tableLabel ?? ""}</span></div>`
      : `<div class="kv"><span class="kl">Service:</span><span class="kv-v" style="text-decoration:underline">COUNTER PICKUP</span></div>`;

    const waiterHtml = order.waiterName 
      ? `<div class="kv"><span class="kl">Waiter:</span><span class="kv-v text-teal">${order.waiterName}</span></div>` 
      : "";

    const customerHtml = order.customerName && order.customerName !== order.tableLabel 
      ? `<div class="kv"><span class="kl">Customer:</span><span class="kv-v">${order.customerName}</span></div>` 
      : "";

    return `
    <div class="print-page">
      <div class="center">
        <h1>${restaurantName}</h1>
        <div class="lbl">${label}</div>
        <div class="div"></div>
      </div>
      
      <div class="kv"><span class="kl">Ticket:</span><span class="kv-v font-mono">#${(order.orderId || order.id).slice(-8).toUpperCase()}</span></div>
      <div class="kv"><span class="kl">Date:</span><span class="kv-v font-mono">${dateStr} · ${timeStr}</span></div>
      ${customerHtml}
      <div class="kv"><span class="kl">Cashier:</span><span class="kv-v">${staffName}</span></div>
      ${waiterHtml}
      ${sourceHtml}
      
      <div class="div"></div>
      <div class="items-header">
        <span>QTY × ITEM</span>
        ${isKitchen ? "" : "<span>PRICE</span>"}
      </div>
      <div class="div" style="margin:2px 0; border-top:1px dotted #888;"></div>
      
      ${itemsHtml}
      ${totalsSection}
      ${order.note ? `<div class="kv" style="margin-top:4px"><span class="kl">Note:</span><span class="kv-v">"${order.note}"</span></div>` : ""}
      
      <div class="footer">
        <div>${isKitchen ? "--- KITCHEN COPY ---" : "RestoFlow POS · Thank you for your business!"}</div>
      </div>
    </div>`;
  };

  const pages: string[] = [];
  if (copies >= 1) {
    pages.push(generatePageHtml("CUSTOMER RECEIPT", false));
  }
  if (copies >= 2) {
    pages.push(generatePageHtml("KITCHEN TICKET", true));
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
    body{font-family:-apple-system,system-ui,sans-serif;font-size:9.5px;max-width:260px;width:100%;margin:0 auto;color:black;background:white;line-height:1.1}
    .print-page{padding:2px 4px;width:100%;height:auto}
    .center{text-align:center}
    .lbl{font-size:8px;font-weight:900;letter-spacing:0.5px;text-transform:uppercase;color:black;margin-top:1px}
    h1{font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:0.5px}
    .meta{font-size:8px;color:black;font-weight:750}
    .div{border-top:1px dashed black;margin:2px 0}
    .item-block{margin:1.5px 0}
    .row{display:flex;justify-content:space-between;align-items:baseline;gap:2px;margin:0}
    .qty{font-weight:900;color:black;flex-shrink:0;margin-right:2px}
    .name{font-weight:700;flex:1;text-transform:uppercase;font-size:9.5px;line-height:1.15}
    .price{font-weight:700;flex-shrink:0;font-family:monospace;font-size:9.5px}
    .mod-row{font-size:8px;color:black;padding-left:8px;font-weight:700}
    .note-row{font-size:8px;color:black;padding-left:8px;font-style:italic;font-weight:700}
    .kv{display:flex;justify-content:space-between;font-size:9px;margin:0.5px 0}
    .kl{color:black;font-weight:700}
    .kv-v{font-weight:700}
    .text-teal{color:black}
    .kv-table{font-size:10px;color:black;text-decoration:underline}
    .total{display:flex;justify-content:space-between;font-size:10.5px;font-weight:900;margin-top:1px}
    .payment-method-row{text-align:center;font-size:8px;font-weight:900;background:white;border:1.5px solid black;padding:2px;border-radius:3px;margin-top:2px;text-transform:uppercase;color:black}
    .items-header{display:flex;justify-content:space-between;font-size:8px;font-weight:900;color:black;letter-spacing:0.5px}
    .footer{text-align:center;color:black;font-size:7.5px;margin-top:4px;border-top:1px dashed black;padding-top:2px;font-weight:black}
    @media print{
      body{margin:0 !important;padding:4mm 2mm 4mm 6mm !important;background:white;color:black}
      .print-page{page-break-after:always;min-height:auto !important;height:auto !important}
      .print-page:last-child{page-break-after:avoid}
      @page {
        size: auto;
        margin: 0 !important; /* Removes all default browser headers, footers and margins */
      }
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
    body{font-family:-apple-system,system-ui,sans-serif;font-size:9.5px;max-width:260px;width:100%;margin:0 auto;padding:4px 6px;color:black;background:white;line-height:1.1}
    .lbl{font-size:8px;font-weight:900;letter-spacing:0.5px;text-transform:uppercase;color:black;margin-bottom:2px}
    h1{font-size:12px;font-weight:900;margin-bottom:2px;text-transform:uppercase}
    .badge{display:inline-block;font-size:8px;font-weight:900;text-transform:uppercase;letter-spacing:0.5px;padding:2px 6px;border-radius:10px;margin-bottom:2px;border:1.5px solid black;color:black}
    .addon-badge{display:inline-block;font-size:8px;font-weight:900;text-transform:uppercase;letter-spacing:0.5px;padding:2px 6px;border-radius:10px;background:white;color:black;border:2px solid black}
    .table-lbl{font-size:13px;font-weight:900;color:black;margin:2px 0}
    .meta{font-size:8px;color:black;font-weight:bold}
    .div{border-top:1px dashed black;margin:4px 0}
    .item-block{margin:3px 0}
    .row{display:flex;justify-content:space-between;align-items:baseline;gap:4px;margin:2px 0}
    .qty{font-weight:900;color:black;flex-shrink:0}
    .name{font-weight:700;flex:1;text-transform:uppercase}
    .price{font-weight:700;flex-shrink:0;font-family:monospace}
    .mod-row{font-size:8px;color:black;padding-left:10px;font-weight:700;margin-top:1px}
    .note-row{font-size:8px;color:black;padding-left:10px;font-style:italic;margin-top:1px;font-weight:700}
    .kv{display:flex;justify-content:space-between;font-size:9px;margin:1px 0}
    .kl{color:black;font-weight:750}
    .kv-v{font-weight:700}
    .total{display:flex;justify-content:space-between;font-size:11px;font-weight:900;margin-top:2px}
    .running{display:flex;justify-content:space-between;font-size:9.5px;margin-top:3px;color:black;font-weight:750}
    .footer{text-align:center;color:black;font-size:7.5px;margin-top:6px;border-top:1px dashed black;padding-top:2px;font-weight:bold}
    @media print{
      body{margin:0 !important;padding:4mm 2mm 4mm 6mm !important}
      @page {
        size: auto;
        margin: 0 !important; /* Removes all default browser headers, footers and margins */
      }
    }
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
  <div class="kv"><span class="kl">Ticket #</span><span class="kv-v font-mono">#${receipt.kitchenTicketId.slice(-8).toUpperCase()}</span></div>
  <div class="kv"><span class="kl">Tab #</span><span class="kv-v font-mono">#${receipt.tabId.slice(-8).toUpperCase()}</span></div>
  <div class="kv"><span class="kl">Added by</span><span class="kv-v">${staffName}</span></div>
  <div class="div"></div>
  <div class="kl font-bold" style="margin-bottom:2px">Items Added</div>
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

// ── Kitchen order slip (counter orders placed but not yet paid) ───────────────

function openKitchenSlip(order: any, restaurantName: string, cashierName: string) {
  const createdAt = order.createdAt instanceof Date ? order.createdAt : new Date();
  const dateStr = createdAt.toLocaleDateString("en-NG", { weekday: "short", year: "numeric", month: "short", day: "numeric" });
  const timeStr = createdAt.toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" });
  const shortId = order.orderId?.slice(-8).toUpperCase() ?? "NEW";

  const totalQty = (order.items as any[]).reduce((s: number, i: any) => s + i.quantity, 0);

  const itemsHtml = (order.items as any[]).map((i: any) => {
    const sizeStr = i.selectedSize ? ` (${i.selectedSize.name})` : "";
    const modsHtml = i.selectedModifiers?.length
      ? i.selectedModifiers.map((m: any) => `<div class="mod">+ ${m.name}</div>`).join("")
      : "";
    const noteHtml = i.itemNote ? `<div class="note">* ${i.itemNote}</div>` : "";
    return `<div class="item">
      <div class="row"><span class="qty">${i.quantity}×</span><span class="name">${i.name}${sizeStr}</span></div>
      ${modsHtml}${noteHtml}
    </div>`;
  }).join("");

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<title>Order Slip · #${shortId}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,system-ui,sans-serif;font-size:9.5px;max-width:260px;width:100%;margin:0 auto;padding:4px 6px;color:black;background:white;line-height:1.1}
  .center{text-align:center}
  h1{font-size:12px;font-weight:900;margin-bottom:1px;text-transform:uppercase}
  .lbl{font-size:8px;font-weight:900;letter-spacing:1px;text-transform:uppercase;color:black;margin-bottom:1px}
  .order-id{font-size:14px;font-weight:900;letter-spacing:0.5px;color:black;margin:2px 0}
  .meta{font-size:8px;color:black;margin-bottom:1px;font-weight:bold}
  .div{border-top:1px dashed black;margin:4px 0}
  .item{margin-bottom:4px}
  .row{display:flex;gap:4px;align-items:baseline}
  .qty{font-weight:900;min-width:16px;color:black}
  .name{font-weight:700;flex:1;text-transform:uppercase}
  .mod,.note{font-size:8px;color:black;padding-left:20px;margin-top:1px;font-weight:700}
  .summary{margin-top:4px}
  .kv{display:flex;justify-content:space-between;font-size:9px;padding:2px 0;color:black;font-weight:700}
  .kv.strong{font-weight:900;font-size:10.5px;color:black;border-top:1px solid black;margin-top:2px;padding-top:3px}
  .kv.balance{font-weight:900;font-size:11px;color:black;border-top:1.5px solid black;margin-top:3px;padding-top:3px}
  .pending{display:block;margin:6px auto 0;font-size:8px;font-weight:900;text-transform:uppercase;letter-spacing:1px;color:black;border:2px solid black;border-radius:10px;padding:2px 8px;width:fit-content}
  .footer{font-size:7.5px;color:black;margin-top:6px;font-weight:bold}
  @media print{
    body{margin:0 !important;padding:4mm 2mm 4mm 6mm !important}
    @page {
      size: auto;
      margin: 0 !important; /* Removes all default browser headers, footers and margins */
    }
  }
</style></head>
<body>
<div class="center">
  <div class="lbl">${restaurantName}</div>
  <div class="lbl">Counter Order Slip</div>
  <div class="order-id">#${shortId}</div>
  <div class="meta">${dateStr} · ${timeStr}</div>
  ${order.customerName && order.customerName !== "Walk-in Customer" ? `<div class="meta" style="font-weight:700">👤 ${order.customerName}</div>` : ""}
  <div class="meta">Cashier: ${cashierName}</div>
</div>
<div class="div"></div>
${itemsHtml}
<div class="div"></div>
<div class="summary">
  <div class="kv"><span>Total Item(s) Ordered</span><span>${totalQty}</span></div>
  <div class="kv"><span>Total Item(s) Delivered</span><span>0</span></div>
  <div class="kv"><span>Total Item(s) Due</span><span>${totalQty}</span></div>
  <div class="kv"><span>Subtotal</span><span>₦${(order.total ?? order.itemsTotal ?? 0).toLocaleString("en-NG")}</span></div>
  <div class="kv strong"><span>TOTAL</span><span>₦${(order.total ?? order.itemsTotal ?? 0).toLocaleString("en-NG")}</span></div>
  <div class="kv balance"><span>Balance Due</span><span>₦${(order.total ?? order.itemsTotal ?? 0).toLocaleString("en-NG")}</span></div>
</div>
<span class="pending">⏳ Awaiting Payment</span>
<div class="center footer" style="margin-top:8px">Powered by Restaflow</div>
<script>window.onload=function(){window.print();}<\/script>
</body></html>`;

  const w = window.open("", "_blank", "width=380,height=620,toolbar=0,menubar=0");
  if (w) { w.document.write(html); w.document.close(); }
}

function openCancellationSlip(order: any, restaurantName: string, cashierName: string, reason: string) {
  const createdAt = order.createdAt?.toDate ? order.createdAt.toDate() : new Date();
  const dateStr = createdAt.toLocaleDateString("en-NG", { weekday: "short", year: "numeric", month: "short", day: "numeric" });
  const timeStr = createdAt.toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" });
  const shortId = order.id?.slice(-8).toUpperCase() ?? "NEW";

  const totalQty = (order.items as any[]).reduce((s: number, i: any) => s + i.quantity, 0);

  const itemsHtml = (order.items as any[]).map((i: any) => {
    const sizeStr = i.selectedSize ? ` (${i.selectedSize.name})` : "";
    const modsHtml = i.selectedModifiers?.length
      ? i.selectedModifiers.map((m: any) => `<div class="mod">+ ${m.name}</div>`).join("")
      : "";
    const noteHtml = i.itemNote ? `<div class="note">* ${i.itemNote}</div>` : "";
    return `<div class="item">
      <div class="row" style="text-decoration: line-through; opacity: 1; font-weight: 750;"><span class="qty">${i.quantity}×</span><span class="name">${i.name}${sizeStr}</span></div>
      ${modsHtml}${noteHtml}
    </div>`;
  }).join("");

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<title>Cancellation Slip · #${shortId}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,system-ui,sans-serif;font-size:9.5px;max-width:260px;width:100%;margin:0 auto;padding:4px 6px;color:black;background:white;line-height:1.1}
  .center{text-align:center}
  h1{font-size:12px;font-weight:900;margin-bottom:1px;text-transform:uppercase}
  .lbl{font-size:8px;font-weight:900;letter-spacing:1px;text-transform:uppercase;color:black;margin-bottom:1px}
  .order-id{font-size:14px;font-weight:900;letter-spacing:0.5px;color:black;margin:2px 0}
  .meta{font-size:8px;color:black;margin-bottom:1px;font-weight:bold}
  .div{border-top:1px dashed black;margin:4px 0}
  .item{margin-bottom:4px}
  .row{display:flex;gap:4px;align-items:baseline}
  .qty{font-weight:900;min-width:16px;color:black}
  .name{font-weight:700;flex:1;text-transform:uppercase}
  .mod,.note{font-size:8px;color:black;padding-left:20px;margin-top:1px;font-weight:700}
  .summary{margin-top:4px}
  .kv{display:flex;justify-content:space-between;font-size:9px;padding:2px 0;color:black;font-weight:700}
  .kv.strong{font-weight:900;font-size:10.5px;color:black;border-top:1.5px solid black;margin-top:2px;padding-top:3px}
  .void-badge{display:block;margin:6px auto 0;font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:1px;color:black;border:2.5px solid black;border-radius:10px;padding:4px 10px;width:fit-content;text-align:center}
  .footer{font-size:7.5px;color:black;margin-top:6px;font-weight:bold}
  @media print{
    body{margin:0 !important;padding:4mm 2mm 4mm 6mm !important}
    @page {
      size: auto;
      margin: 0 !important;
    }
  }
</style></head>
<body>
<div class="center">
  <div class="lbl">${restaurantName}</div>
  <div class="void-badge">⚠️ ORDER VOIDED / CANCELLED ⚠️</div>
  <div class="order-id" style="text-decoration: line-through;">#${shortId}</div>
  <div class="meta">${dateStr} · ${timeStr}</div>
  ${order.customerName && order.customerName !== "Walk-in Guest" && order.customerName !== "Walk-in Customer" ? `<div class="meta" style="font-weight:700">👤 ${order.customerName}</div>` : ""}
  <div class="meta" style="font-weight:black; color:black; margin-top: 4px; border: 1.5px solid black; padding: 2px;">Reason: ${reason}</div>
  <div class="meta">Voided By Cashier: ${cashierName}</div>
</div>
<div class="div"></div>
${itemsHtml}
<div class="div"></div>
<div class="summary">
  <div class="kv strong"><span>TOTAL VOIDED VALUE</span><span>₦${(order.total ?? order.itemsTotal ?? 0).toLocaleString("en-NG")}</span></div>
</div>
<div class="center footer" style="margin-top:12px; font-weight: 900; color: black; text-transform: uppercase; border: 2px solid black; padding: 4px;">
  *** STOP PREPARATION / DO NOT SERVE ***
</div>
<script>window.onload=function(){window.print();}<\/script>
</body></html>`;

  const w = window.open("", "_blank", "width=380,height=620,toolbar=0,menubar=0");
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
    body{font-family:-apple-system,system-ui,sans-serif;font-size:9.5px;max-width:260px;width:100%;margin:0 auto;padding:4px 6px;color:black;background:white;line-height:1.1}
    .center{text-align:center}
    .lbl{font-size:8px;font-weight:900;letter-spacing:0.5px;text-transform:uppercase;color:black;margin-bottom:2px}
    h1{font-size:12px;font-weight:900;margin-bottom:2px;text-transform:uppercase}
    .badge{display:inline-block;font-size:8px;font-weight:900;text-transform:uppercase;letter-spacing:0.5px;padding:2px 6px;border-radius:10px;margin-bottom:2px;border:1px solid black;color:black}
    .paid-badge{display:inline-block;font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:0.5px;padding:2px 8px;border-radius:10px;background:white;color:black;border:2px solid black;margin-top:2px}
    .table-lbl{font-size:13px;font-weight:900;color:black;margin:2px 0}
    .meta{font-size:8px;color:black;font-weight:bold}
    .div{border-top:1px dashed black;margin:4px 0}
    .row{display:flex;justify-content:space-between;align-items:baseline;gap:4px;margin:2px 0}
    .qty{font-weight:900;color:black;flex-shrink:0}
    .name{font-weight:700;flex:1;text-transform:uppercase}
    .price{font-weight:700;flex-shrink:0;font-family:monospace}
    .kv{display:flex;justify-content:space-between;font-size:9px;margin:1px 0}
    .kl{color:black;font-weight:750}
    .kv-v{font-weight:700}
    .total{display:flex;justify-content:space-between;font-size:11px;font-weight:900;margin-top:3px}
    .footer{text-align:center;color:black;font-size:7.5px;margin-top:6px;border-top:1px dashed black;padding-top:2px;font-weight:bold}
    @media print{
      body{margin:0 !important;padding:4mm 2mm 4mm 6mm !important}
      @page {
        size: auto;
        margin: 0 !important; /* Removes all default browser headers, footers and margins */
      }
    }
  </style>
</head>
<body>
  <div class="center">
    <div class="lbl">Restaflow POS · Bill Settlement</div>
    <h1>${restaurantName}</h1>
    <div class="badge">Dine-In</div>
    <div class="table-lbl">${result.tableLabel}</div>
    <div class="paid-badge">✓ PAID</div>
    <div class="meta" style="margin-top:2px">${dateStr} · ${timeStr}</div>
  </div>
  <div class="div"></div>
  <div class="kv"><span class="kl">Order #</span><span class="kv-v font-mono">#${order.id.slice(-8).toUpperCase()}</span></div>
  ${order.customerName && order.customerName !== order.tableLabel ? `<div class="kv"><span class="kl">Guest</span><span class="kv-v">${order.customerName}</span></div>` : ""}
  <div class="kv"><span class="kl">Settled by</span><span class="kv-v">${result.staffName}</span></div>
  <div class="div"></div>
  ${itemsHtml}
  <div class="div"></div>
  <div class="kv"><span class="kl">Subtotal</span><span class="kv-v">₦${(order.itemsTotal ?? order.total).toLocaleString("en-NG")}</span></div>
  <div class="total"><span>Total</span><span>₦${order.total.toLocaleString("en-NG")}</span></div>
  <div class="div"></div>
  <div class="kv"><span class="kl">Payment</span><span class="kv-v">${pmLabels[result.paymentMethod] ?? result.paymentMethod}</span></div>
  <div class="kv"><span class="kl">Status</span><span class="kv-v" style="color:black;font-weight:900">PAID</span></div>
  <div class="footer"><div>Thank you for dining with us!</div><div>Powered by Restaflow</div></div>
  <script>window.onload=function(){setTimeout(function(){window.print();},80)};</script>
</body>
</html>`;

  const w = window.open("", "_blank", "width=380,height=720,menubar=no,toolbar=no,scrollbars=yes");
  if (w) { w.document.write(html); w.document.close(); }
}

// ── POSClient ─────────────────────────────────────────────────────────────────

// Module-level guard: staff-sync should only run once per page session regardless
// of React Strict Mode double-mounts or concurrent rendering re-invocations.
let _staffSyncPending = false;

export default function POSClient({ restaurant, menuItems, staffName, staffId, role }: Props) {
  // Order entry state
  const [serviceMode, setServiceMode] = useState<ServiceMode>("counter");
  const [tableLabel, setTableLabel] = useState("");
  const [tableLabelInput, setTableLabelInput] = useState(""); // free-text field
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>("unpaid");
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

  // Online orders background monitoring alert state
  const [onlineAlertCount, setOnlineAlertCount] = useState<number>(0);
  const [showOnlineOrderAlert, setShowOnlineOrderAlert] = useState<boolean>(false);

  // Strengthened PWA Offline POS States
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [lastSyncText, setLastSyncText] = useState<string>("Never");
  const [pendingOfflineCount, setPendingOfflineCount] = useState<number>(0);
  const [syncFailed, setSyncFailed] = useState<boolean>(false);
  const [staffSyncFailed, setStaffSyncFailed] = useState<boolean>(false);
  const [terminalId, setTerminalId] = useState<string>("");
  const [termName, setTermName] = useState<string>("Terminal 1");

  // Cashier Offline Authentication states
  const [activeCashierName, setActiveCashierName] = useState<string>(staffName);
  const [activeCashierId, setActiveCashierId] = useState<string>(staffId);
  const [activeCashierRole, setActiveCashierRole] = useState<string>(role);
  const [isTerminalLocked, setIsTerminalLocked] = useState<boolean>(true); // Locked by default for security on load
  const [failedAttempts, setFailedAttempts] = useState<number>(0);
  const [lockoutTime, setLockoutTime] = useState<number>(0); // lockout cooldown time
  const [showTerminalSetup, setShowTerminalSetup] = useState<boolean>(false);
  const [terminalNameInput, setTerminalNameInput] = useState<string>("");

  // Cashier PIN setup/change modal states
  const [showCashierPinModal, setShowCashierPinModal] = useState<boolean>(false);
  const [selectedCashierForPin, setSelectedCashierForPin] = useState<any | null>(null);
  const [cashierPinOld, setCashierPinOld] = useState<string>("");
  const [cashierPinNew, setCashierPinNew] = useState<string>("");
  const [cashierPinConfirm, setCashierPinConfirm] = useState<string>("");
  const [cashierPinError, setCashierPinError] = useState<string | null>(null);
  const [cashierPinSubmitting, setCashierPinSubmitting] = useState<boolean>(false);
  const [managersWithPinCount, setManagersWithPinCount] = useState<number>(0);

  // Ready-order alert state
  const [readyOrders, setReadyOrders] = useState<TodayOrder[]>([]);
  const [alertMuted, setAlertMuted] = useState<boolean>(false);
  // Defer localStorage read to avoid SSR/client hydration mismatch
  useEffect(() => {
    setAlertMuted(localStorage.getItem("rf_pos_muted") === "true");
  }, []);
  const [servingId, setServingId] = useState<string | null>(null);
  const [alertCollapsed, setAlertCollapsed] = useState(false);

  // Open bills state
  const [openBills, setOpenBills] = useState<TodayOrder[]>([]);
  const [offlineQueueBills, setOfflineQueueBills] = useState<TodayOrder[]>([]);
  const [rightTab, setRightTab] = useState<"order" | "bills">("order");
  const [settleBillId, setSettleBillId] = useState<string | null>(null);
  const [voidingOrder, setVoidingOrder] = useState<TodayOrder | null>(null);
  const [pendingVoidParams, setPendingVoidParams] = useState<{ orderId: string; reason: string } | null>(null);
  const [voidAuthChoiceOpen, setVoidAuthChoiceOpen] = useState(false);
  const [settlementResult, setSettlementResult] = useState<SettlementResult | null>(null);
  const [settledOrder, setSettledOrder] = useState<TodayOrder | null>(null);

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
  // Ref-based guard for triggerBackgroundSync so the function stays stable
  // and doesn't force the mount useEffect to re-run on every sync cycle.
  const syncingOfflineRef = useRef(false);

  useEffect(() => {
    mutedRef.current = alertMuted;
  }, [alertMuted]);

  useEffect(() => {
    syncingOfflineRef.current = syncingOffline;
  }, [syncingOffline]);

  // Convert an IDB offline order into a TodayOrder-shaped object for Open Bills
  const loadOfflineQueueBills = useCallback(async () => {
    try {
      const queue = await dbGetAll<any>("ordersQueue");
      const bills: TodayOrder[] = queue
        .filter((o: any) => (o.syncStatus === "pending" || o.syncStatus === "failed") && o.paymentStatus !== "paid")
        .map((o: any) => ({
          id: o.localOrderId,
          localOrderId: o.localOrderId,
          customerName: o.customerName || "Walk-in Guest",
          items: o.items,
          itemsTotal: o.total,
          total: o.total,
          paymentMethod: o.paymentMethod || "cash",
          paymentStatus: o.paymentStatus || "unpaid",
          note: o.note || "",
          orderSource: "counter" as const,
          serviceMode: o.serviceMode || "counter",
          tableLabel: o.tableLabel || "",
          status: "pending",
          createdAt: { toDate: () => new Date(o.createdAt) } as any,
          waiterName: o.waiterName ?? null,
          pricingMode: o.pricingMode ?? "regular",
          isOffline: true,
        }));
      setOfflineQueueBills(bills);
    } catch (err) {
      console.error("Failed to load offline queue bills:", err);
    }
  }, []);

  // Mark an offline IDB order as paid and update the queue for sync
  const settleOfflineOrder = useCallback(async (
    localOrderId: string,
    paymentMethod: string,
    settlementNote: string,
    restaurantName: string,
    cashierName: string,
  ) => {
    try {
      const queue = await dbGetAll<any>("ordersQueue");
      const order = queue.find((o: any) => o.localOrderId === localOrderId);
      if (!order) return;

      const settled = { ...order, paymentMethod, paymentStatus: "paid", settlementNote };
      await dbPut("ordersQueue", settled);

      // Print payment receipt
      openPOSReceiptWindow({
        orderId: localOrderId,
        items: order.items,
        itemsTotal: order.total,
        total: order.total,
        paymentMethod,
        paymentStatus: "paid",
        customerName: order.customerName || "Walk-in Guest",
        note: settlementNote || order.note || "",
        serviceMode: order.serviceMode || "counter",
        tableLabel: order.tableLabel || "",
        waiterName: order.waiterName,
        pricingMode: order.pricingMode,
        createdAt: new Date(order.createdAt),
      }, restaurantName, cashierName, 1);

      await loadOfflineQueueBills();
      showSystemToast(`Bill #${localOrderId.slice(-6).toUpperCase()} settled offline — will sync when online`);
    } catch (err) {
      console.error("Failed to settle offline order:", err);
    }
  }, [loadOfflineQueueBills]);

  const triggerBackgroundSync = useCallback(async () => {
    if (typeof window === "undefined" || !navigator.onLine || syncingOfflineRef.current) return;
    
    setSyncingOffline(true);
    setSyncFailed(false);

    try {
      const queue = await dbGetAll<any>("ordersQueue");
      const pendingOrders = queue.filter(o => o.syncStatus === "pending" || o.syncStatus === "failed");

      if (pendingOrders.length === 0) {
        setSyncingOffline(false);
        return;
      }

      for (const order of pendingOrders) {
        const syncingOrder = { ...order, syncStatus: "syncing" as const };
        await dbPut("ordersQueue", syncingOrder);

        try {
          const res = await fetch(`/api/admin/pos/sync`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(order),
          });

          if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || "Sync failed on server");
          }

          // Remove from local IndexedDB on successful sync to avoid bloated data
          await dbDelete("ordersQueue", order.localOrderId);
        } catch (err: any) {
          console.error(`Failed to sync offline order ${order.localOrderId}:`, err);
          const failedOrder = { 
            ...order, 
            syncStatus: "failed" as const, 
            syncError: err.message || "Unknown error" 
          };
          await dbPut("ordersQueue", failedOrder);
          setSyncFailed(true);
        }
      }

      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setLastSyncTime(`Today at ${timeStr}`);
      setLastSyncText(`Today at ${timeStr}`);

    } catch (err) {
      console.error("Offline sync manager crashed:", err);
      setSyncFailed(true);
    } finally {
      const updatedQueue = await dbGetAll<any>("ordersQueue");
      setPendingOfflineCount(updatedQueue.filter(o => o.syncStatus === "pending" || o.syncStatus === "failed").length);
      loadOfflineQueueBills();
      setSyncingOffline(false);
    }
  }, [loadOfflineQueueBills]);

  // Load PWA states — runs exactly once on mount (empty deps).
  // Staff-sync and menu cache are here intentionally: they must not re-run
  // on every sync cycle. menuItems is captured via closure; the prop value
  // is stable across re-renders (it comes from the server component).
  useEffect(() => {
    const draft = localStorage.getItem("rf_pos_draft_cart");
    if (draft) {
      try { setCart(JSON.parse(draft)); } catch (_) {}
    }

    const devId = getDeviceId();
    setTerminalId(devId);

    const tName = getTerminalName();
    setTermName(tName);
    setTerminalNameInput(tName);

    if (!localStorage.getItem("rf_pos_terminal_name")) {
      setShowTerminalSetup(true);
    }

    setLastSyncText(getLastSyncTime());
    dbGetAll("ordersQueue").then((queue: any[]) => {
      const count = queue.filter((o: any) => o.syncStatus === "pending" || o.syncStatus === "failed").length;
      setPendingOfflineCount(count);
    });
    loadOfflineQueueBills();

    if (navigator.onLine && !_staffSyncPending) {
      _staffSyncPending = true;
      fetch(`/api/admin/pos/staff-sync`)
        .then(res => res.json())
        .then(async (data) => {
          if (data.staff && Array.isArray(data.staff)) {
            for (const member of data.staff) {
              if (!member.isActive) {
                await dbDelete("staff", member.staffId);
              } else {
                await dbPut("staff", member);
              }
            }
            setStaffSyncFailed(false);
          }
        }).catch(async (err) => {
          console.error("Staff sync failed on mount:", err);
          const cached = await dbGetAll<any>("staff").catch(() => []);
          if (cached.length === 0) setStaffSyncFailed(true);
        }).finally(() => {
          // Reset so next full page reload can sync again
          _staffSyncPending = false;
        });

      if (menuItems && Array.isArray(menuItems)) {
        menuItems.forEach((item) => {
          dbPut("menu", {
            itemId: item.id,
            name: item.name,
            price: item.price,
            indoorPrice: item.indoorPrice || 0,
            isActive: item.available,
          });
        });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // empty — run once on mount only

  // Online/offline listeners — separated so that re-creation of triggerBackgroundSync
  // (which no longer depends on syncingOffline) does not restart the mount effect.
  useEffect(() => {
    if (typeof window === "undefined") return;

    setIsOnline(navigator.onLine);
    if (navigator.onLine) triggerBackgroundSync();

    const handleOnline = () => {
      setIsOnline(true);
      triggerBackgroundSync();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [triggerBackgroundSync]);

  // Idle Auto-lock Timeout (5 minutes)
  useEffect(() => {
    if (typeof window === "undefined" || isTerminalLocked) return;

    let timeoutId: NodeJS.Timeout;

    const resetTimer = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        setIsTerminalLocked(true);
        showSystemToast("Terminal locked due to inactivity");
      }, 300000); // 5 minutes
    };

    window.addEventListener("mousemove", resetTimer);
    window.addEventListener("keydown", resetTimer);
    window.addEventListener("click", resetTimer);
    
    resetTimer();

    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener("mousemove", resetTimer);
      window.removeEventListener("keydown", resetTimer);
      window.removeEventListener("click", resetTimer);
    };
  }, [isTerminalLocked]);

  // Lockout penalty timer countdown
  useEffect(() => {
    if (lockoutTime <= 0) return;
    const interval = setInterval(() => {
      setLockoutTime(prev => prev - 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [lockoutTime]);

  const [cachedStaffList, setCachedStaffList] = useState<any[]>([]);

  // Load cached staff from IndexedDB when locked or synced
  const loadCachedStaff = useCallback(async () => {
    try {
      const list = await dbGetAll<any>("staff");
      setCachedStaffList(list);

      const managers = list.filter((s: any) => (s.role === "manager" || s.role === "owner") && s.isActive !== false && !!s.pinHash);
      setManagersWithPinCount(managers.length);

      if (list.length > 0 && !activeCashierId) {
        setActiveCashierId(list[0].staffId);
        setActiveCashierName(list[0].staffName);
        setActiveCashierRole(list[0].role);
      }
    } catch (err) {
      console.error("Failed to load offline staff cache list:", err);
    }
  }, [activeCashierId]);

  useEffect(() => {
    loadCachedStaff();
  }, [isTerminalLocked, loadCachedStaff]);

  const handleSaveCashierPin = async () => {
    if (!selectedCashierForPin) return;
    setCashierPinError(null);

    // Validate input
    if (selectedCashierForPin.pinHash) {
      if (!cashierPinOld || cashierPinOld.length !== 4) {
        setCashierPinError("Please enter your current 4-digit PIN");
        return;
      }
      // Verify old PIN locally
      const isOldMatch = await verifyOfflinePin(cashierPinOld, selectedCashierForPin.pinSalt, selectedCashierForPin.pinHash);
      if (!isOldMatch) {
        setCashierPinError("Incorrect current PIN passcode");
        return;
      }
    }

    if (!/^\d{4}$/.test(cashierPinNew)) {
      setCashierPinError("New PIN must be exactly 4 digits");
      return;
    }

    if (cashierPinNew !== cashierPinConfirm) {
      setCashierPinError("New PIN confirmation does not match");
      return;
    }

    setCashierPinSubmitting(true);
    try {
      const res = await fetch(`/api/admin/staff/${selectedCashierForPin.staffId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: cashierPinNew }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCashierPinError(data.error ?? "Failed to save PIN");
        return;
      }

      showSystemToast("PIN code updated successfully!");
      setShowCashierPinModal(false);
      setSelectedCashierForPin(null);
      setPinInput("");

      // Trigger background sync immediately to download new pinHash and pinSalt
      const syncRes = await fetch(`/api/admin/pos/staff-sync`);
      const syncData = await syncRes.json();
      if (syncData.staff && Array.isArray(syncData.staff)) {
        for (const member of syncData.staff) {
          if (!member.isActive) {
            await dbDelete("staff", member.staffId);
          } else {
            await dbPut("staff", member);
          }
        }
        await loadCachedStaff();
      }

    } catch (err) {
      setCashierPinError("Failed to update PIN due to a network error.");
    } finally {
      setCashierPinSubmitting(false);
    }
  };

  const handleKeypadPress = (val: string) => {
    if (lockoutTime > 0) return;
    setPinError(null);
    if (pinInput.length < 4) {
      const newPin = pinInput + val;
      setPinInput(newPin);
      if (newPin.length === 4) {
        setTimeout(() => triggerUnlock(newPin), 80);
      }
    }
  };

  const handleOfflineUnlock = () => {
    if (pinInput.length !== 4) {
      setPinError("Enter exactly 4 digits");
      return;
    }
    triggerUnlock(pinInput);
  };

  const triggerUnlock = async (pin: string) => {
    if (lockoutTime > 0) return;
    
    // Fallback path: if they enter standard owner details and there are zero offline staff cached yet
    if (cachedStaffList.length === 0 && activeCashierId === staffId) {
      setIsTerminalLocked(false);
      setPinInput("");
      showSystemToast(`Welcome back, ${activeCashierName} (Offline Bypass Mode)`);
      return;
    }

    const staffMember = cachedStaffList.find(x => x.staffId === activeCashierId) || 
                         (activeCashierId === staffId ? { staffId, staffName, role: "owner", pinSalt: "", pinHash: "", isActive: true } : null);

    if (!staffMember) {
      setPinError("Staff member not found");
      setPinInput("");
      return;
    }

    if (!staffMember.pinHash) {
      setPinError("No PIN configured. Click 'Setup PIN' below to configure your passcode.");
      setPinInput("");
      return;
    }

    const isMatch = await verifyOfflinePin(pin, staffMember.pinSalt, staffMember.pinHash);

    if (isMatch) {
      setIsTerminalLocked(false);
      setPinInput("");
      setFailedAttempts(0);
      showSystemToast(`Welcome back, ${staffMember.staffName}!`);
    } else {
      const newFailed = failedAttempts + 1;
      setFailedAttempts(newFailed);
      setPinInput("");

      if (newFailed >= 5) {
        setLockoutTime(30);
        setPinError("Too many failed attempts. Terminal locked for 30s.");
        setFailedAttempts(0);
      } else {
        setPinError(`Incorrect PIN passcode. Attempt ${newFailed}/5`);
      }
    }
  };

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

  // Listen for new online orders in the background to alert POS cashier
  useEffect(() => {
    let firstLoadDone = false;
    const q = query(
      collection(db, "orders"),
      where("restaurantId", "==", restaurant.slug),
      where("status", "==", "pending")
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      // Exclude walk-in counter orders
      const newOnlineOrders = snapshot.docs.filter(
        (doc) => (doc.data().orderSource as string | undefined) !== "counter"
      );

      if (newOnlineOrders.length > 0) {
        if (firstLoadDone) {
          try {
            const AC = window.AudioContext || (window as any).webkitAudioContext;
            if (AC) {
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
            }
          } catch { /* skip autoplay blocks */ }

          setOnlineAlertCount(newOnlineOrders.length);
          setShowOnlineOrderAlert(true);
        } else {
          firstLoadDone = true;
        }
      } else {
        setShowOnlineOrderAlert(false);
        firstLoadDone = true;
      }
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
    setPaymentStatus("unpaid");
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

        // Open bills: all unpaid/part-paid POS orders (counter + dine-in)
        const bills = data.filter(
          (o) =>
            o.orderSource === "counter" &&
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
  const verifyPin = async () => {
    if (!pinInput || pinInput.length !== 4) {
      setPinError("Enter exactly 4 digits");
      return;
    }

    const list = cachedStaffList.length > 0 ? cachedStaffList : await dbGetAll<any>("staff").catch(() => []);
    const managers = list.filter((s: any) => (s.role === "manager" || s.role === "owner") && s.isActive !== false);

    let approvedMember: any = null;
    for (const member of managers) {
      if (member.pinHash && member.pinSalt) {
        const isMatch = await verifyOfflinePin(pinInput, member.pinSalt, member.pinHash);
        if (isMatch) {
          approvedMember = member;
          break;
        }
      }
    }

    if (approvedMember) {
      showSystemToast(`Manager override approved by ${approvedMember.staffName}!`);
      setVerifyingAction(null);
      setPinInput("");
      setPinError(null);
      if (pendingActionCallback) {
        pendingActionCallback();
        setPendingActionCallback(null);
      }
    } else {
      setPinError("Invalid manager PIN code.");
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
    setPaymentStatus("unpaid");
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
      staffName: activeCashierName,
      serviceMode,
      tableLabel: finalTableLabel,
      waiterName: selectedWaiterName,
      pricingMode,
      auditLog,
    };

    setSubmitting(true);
    setError(null);
    try {
      // When offline, skip the API entirely and go straight to the IndexedDB queue.
      // The API route verifies the session cookie against Firebase (checkRevoked: true),
      // which requires internet — so it returns 401 even for valid sessions when offline.
      if (!navigator.onLine) throw new Error("offline");

      const url = editingOrderId ? `/api/admin/pos/${editingOrderId}` : "/api/admin/pos";
      const method = editingOrderId ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(orderPayload),
      });
      const data = await res.json();
      if (!res.ok) {
        // 401 means Firebase couldn't verify the session (network flaky or session expired).
        // For new counter/dine-in orders, fall through to the offline queue so the order
        // isn't lost. For edits, show the error — we can't safely queue an edit offline.
        if (res.status === 401 && !editingOrderId) throw new Error("offline");
        setError(res.status === 401 ? "Session expired — please sign out and back in." : (data.error ?? "Failed to save order"));
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
      
      localStorage.removeItem("rf_pos_draft_cart");

      // New unpaid counter order → print kitchen slip, stay in Open Bills
      if (!editingOrderId && serviceMode === "counter" && paymentStatus === "unpaid") {
        openKitchenSlip(completed, restaurant.name, activeCashierName);
        // Reset cart and show Open Bills so cashier can track the order
        setCart([]);
        setCustomerName("");
        setNote("");
        setEditingOrderId(null);
        setRightTab("bills");
        showSystemToast(`Order #${data.orderId.slice(-6).toUpperCase()} placed — awaiting payment`);
        return;
      }

      // Paid or dine-in → full payment receipt
      setCompletedOrder(completed);
      openPOSReceiptWindow(completed, restaurant.name, activeCashierName, printCopies);
    } catch (err) {
      // Robust Offline Fallback: Write complete audit stamped transaction into IndexedDB.
      // If we are editing an existing offline order, reuse its localOrderId to overwrite/update it,
      // avoiding duplicate order creation in IndexedDB.
      const mockOfflineId = editingOrderId || `offline-${Math.random().toString(36).substring(2, 9)}-${Date.now()}`;
      
      const offlineOrderRecord = {
        localOrderId: mockOfflineId,
        items: cart.map((c) => ({
          id: c.id,
          name: c.name,
          price: itemUnitPrice(c),
          quantity: c.quantity,
          selectedSize: c.selectedSize,
          selectedModifiers: c.selectedModifiers,
          itemNote: c.itemNote,
        })),
        total: cartTotal,
        cashierId: activeCashierId,
        cashierName: activeCashierName,
        deviceId: terminalId,
        terminalName: termName,
        syncStatus: "pending" as const,
        createdAt: Date.now(),
        orderSource: "counter" as const,
        // Full context so the order can be displayed and settled while offline
        paymentMethod,
        paymentStatus,
        customerName: customerName.trim() || (serviceMode === "dine_in" ? finalTableLabel : "Walk-in Guest"),
        note: note.trim(),
        waiterName: selectedWaiterName,
        pricingMode,
        serviceMode,
        tableLabel: finalTableLabel,
      };

      try {
        await dbPut("ordersQueue", offlineOrderRecord);
        
        // Update count of pending orders
        const queue = await dbGetAll("ordersQueue");
        setPendingOfflineCount(queue.filter((o: any) => o.syncStatus === "pending" || o.syncStatus === "failed").length);

        const completed = {
          orderId: mockOfflineId,
          items: offlineOrderRecord.items,
          itemsTotal: cartTotal,
          total: cartTotal,
          paymentMethod,
          paymentStatus,
          customerName: customerName.trim() || (serviceMode === "dine_in" ? finalTableLabel : "Walk-in Guest"),
          note: note.trim(),
          serviceMode,
          tableLabel: finalTableLabel,
          waiterName: selectedWaiterName,
          pricingMode,
          createdAt: new Date(),
          isOffline: true,
        };

        // Force reload the offline queue state so it populates the Open Bills list immediately
        await loadOfflineQueueBills();

        // Offline + unpaid counter → kitchen slip + Open Bills (same UX as online path)
        if (!editingOrderId && serviceMode === "counter" && paymentStatus === "unpaid") {
          openKitchenSlip(completed, restaurant.name, activeCashierName);
          setCart([]);
          setCustomerName("");
          setNote("");
          setEditingOrderId(null);
          setRightTab("bills");
          showSystemToast(`Order #${mockOfflineId.slice(-6).toUpperCase()} saved offline — awaiting payment`);
        } else {
          setCompletedOrder(completed);
          openPOSReceiptWindow(completed, restaurant.name, activeCashierName, printCopies);
          showSystemToast("Internet offline. Order stored locally.");
        }
        localStorage.removeItem("rf_pos_draft_cart");
      } catch (dbErr) {
        console.error("IndexedDB write failed:", dbErr);
        setError("Failed to save offline order to local database storage");
      }
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
      {/* Real-time floating Online Order alerts overlay for cashiers taking walk-ins */}
      {showOnlineOrderAlert && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[999999] w-full max-w-sm px-4 select-none pointer-events-auto">
          <div className="bg-gradient-to-r from-orange-600 to-amber-600 border border-orange-400 text-white p-4 rounded-3xl shadow-2xl flex items-center gap-3 animate-bounce">
            <span className="w-2.5 h-2.5 bg-white rounded-full animate-ping flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-black uppercase tracking-wider">🔔 New Online Order!</p>
              <p className="text-[10px] text-white/80 font-medium">
                {onlineAlertCount} pending order{onlineAlertCount > 1 ? "s" : ""} requiring acceptance.
              </p>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <a
                href={`/admin/${restaurant.slug}/orders`}
                className="bg-white/20 hover:bg-white/30 text-white font-black text-[9px] uppercase tracking-widest px-3 py-1.5 rounded-xl transition-all active:scale-95"
              >
                View
              </a>
              <button
                onClick={() => setShowOnlineOrderAlert(false)}
                className="text-white/60 hover:text-white font-bold p-1 text-xs"
              >
                ✕
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Offline PWA Lock Screen keypads and settings configuration overlays ── */}
      {showTerminalSetup && (
        <div className="fixed inset-0 bg-slate-900/90 backdrop-blur-sm z-[99999] flex items-center justify-center p-4 select-none">
          <div className="w-full max-w-sm bg-white p-6 rounded-3xl shadow-xl border border-gray-100 flex flex-col">
            <div className="w-12 h-12 rounded-xl bg-orange-50/50 flex items-center justify-center text-xl mb-4 border border-orange-100">
              🖥️
            </div>
            <h3 className="text-lg font-black text-gray-900 mb-1">
              Configure Terminal Name
            </h3>
            <p className="text-gray-500 text-xs mb-4">
              Give this register a human-readable name (e.g. "Main Register", "Bar iPad") so the manager can track offline sales.
            </p>

            <input
              type="text"
              className="w-full border border-gray-200 rounded-2xl px-4 py-3 text-sm font-bold outline-none focus:border-orange-500 transition-all mb-4 bg-gray-50 text-gray-800"
              placeholder="Main Register"
              value={terminalNameInput}
              onChange={(e) => setTerminalNameInput(e.target.value)}
            />

            <button
              onClick={() => {
                const name = terminalNameInput.trim() || "Terminal 1";
                setTerminalName(name);
                setTermName(name);
                setShowTerminalSetup(false);
                showSystemToast(`Terminal name configured to: ${name}`);
              }}
              className="w-full py-3 bg-orange-500 hover:bg-orange-600 active:scale-98 text-white font-black text-sm rounded-2xl transition-all shadow-sm shadow-orange-500/10"
            >
              Save Configuration
            </button>
          </div>
        </div>
      )}

      {isTerminalLocked && (
        <div className="fixed inset-0 bg-slate-900/98 backdrop-blur-md z-[9999] flex flex-col items-center justify-center p-4 select-none">
          <div className="w-full max-w-md bg-slate-800/80 border border-slate-700/50 p-8 rounded-3xl shadow-2xl flex flex-col items-center">
            <div className="w-16 h-16 rounded-2xl bg-orange-500/10 flex items-center justify-center border border-orange-500/20 mb-6">
              <span className="text-3xl">🔒</span>
            </div>

            <h2 className="text-2xl font-black text-white tracking-tight mb-1">
              Terminal Locked
            </h2>
            <p className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-8 text-center">
              {termName} • {restaurant.name}
            </p>

            {lockoutTime > 0 ? (
              <div className="w-full text-center bg-red-500/10 border border-red-500/20 py-3 px-4 rounded-2xl mb-6">
                <p className="text-red-400 text-xs font-bold uppercase tracking-wide">
                  Terminal Lockout Active
                </p>
                <p className="text-red-300 text-[10px] mt-0.5">
                  Too many failed attempts. Retry in {lockoutTime} seconds.
                </p>
              </div>
            ) : pinError ? (
              <div className="w-full text-center bg-red-500/10 border border-red-500/20 py-2 px-4 rounded-xl mb-4">
                <p className="text-red-400 text-xs font-bold">{pinError}</p>
              </div>
            ) : null}

            {staffSyncFailed && cachedStaffList.length === 0 && (
              <div className="w-full text-center bg-yellow-500/10 border border-yellow-500/20 py-3 px-4 rounded-2xl mb-6">
                <p className="text-yellow-400 text-xs font-bold uppercase tracking-wide">
                  Offline Login Not Ready
                </p>
                <p className="text-yellow-300/80 text-[10px] mt-1 leading-relaxed">
                  Cashier profiles have not been synced to this device yet. Connect to the internet once to enable PIN login for your staff.
                </p>
              </div>
            )}

            <div className="w-full mb-6">
              <label className="block text-slate-400 text-[10px] font-black uppercase tracking-wider mb-2">
                Select Cashier / Staff
              </label>
              <div className="relative mb-2">
                <select
                  value={activeCashierId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setActiveCashierId(id);
                    const s = cachedStaffList.find(x => x.staffId === id);
                    if (s) {
                      setActiveCashierName(s.staffName);
                      setActiveCashierRole(s.role);
                    } else if (id === staffId) {
                      setActiveCashierName(staffName);
                      setActiveCashierRole(role);
                    }
                    setPinInput("");
                    setPinError(null);
                  }}
                  className="w-full bg-slate-900 border border-slate-700 rounded-2xl px-4 py-3.5 pr-10 text-white font-bold text-sm outline-none focus:border-orange-500 transition-all cursor-pointer appearance-none text-white"
                  style={{ color: "white", WebkitTextFillColor: "white" }}
                >
                  {cachedStaffList.length === 0 ? (
                    <option value={staffId} className="bg-slate-900 text-white">{staffName} (Default Owner)</option>
                  ) : (
                    <>
                      {cachedStaffList.map((s: any) => (
                        <option key={s.staffId} value={s.staffId} className="bg-slate-900 text-white">
                          {s.staffName} ({s.role.toUpperCase()})
                        </option>
                      ))}
                      {!cachedStaffList.some((x: any) => x.staffId === staffId) && (
                        <option value={staffId} className="bg-slate-900 text-white">{staffName} ({role.toUpperCase()})</option>
                      )}
                    </>
                  )}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-4 text-slate-400">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>

              {/* Show Setup PIN option if the selected staff has no PIN configured */}
              {(() => {
                const sMember = cachedStaffList.find(x => x.staffId === activeCashierId) ||
                                (activeCashierId === staffId ? { staffId, staffName, role: "owner", pinSalt: "", pinHash: "", isActive: true } : null);
                if (sMember && !sMember.pinHash) {
                  return (
                    <div className="flex items-center justify-between bg-yellow-500/10 border border-yellow-500/20 px-3.5 py-2.5 rounded-2xl mt-2 animate-fade-in">
                      <span className="text-[10px] text-yellow-400 font-bold">⚠️ PIN Passcode not configured</span>
                      <button
                        onClick={() => {
                          setSelectedCashierForPin(sMember);
                          setCashierPinOld("");
                          setCashierPinNew("");
                          setCashierPinConfirm("");
                          setCashierPinError(null);
                          setShowCashierPinModal(true);
                        }}
                        className="text-[9px] font-black uppercase tracking-wider bg-yellow-500 hover:bg-yellow-600 text-slate-900 px-2 py-1 rounded-lg transition-colors border-none cursor-pointer"
                      >
                        Setup PIN
                      </button>
                    </div>
                  );
                }
                return null;
              })()}
            </div>

            <div className="flex gap-4 mb-8 justify-center">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className={`w-4 h-4 rounded-full border-2 transition-all duration-150 ${
                    i < pinInput.length
                      ? "bg-orange-500 border-orange-500 scale-110 shadow-lg shadow-orange-500/20"
                      : "border-slate-600 bg-transparent"
                  }`}
                />
              ))}
            </div>

            <div className="grid grid-cols-3 gap-3 w-full max-w-[280px]">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((num) => (
                <button
                  key={num}
                  onClick={() => handleKeypadPress(num)}
                  disabled={lockoutTime > 0}
                  className="aspect-square bg-slate-800 hover:bg-slate-700/80 active:bg-slate-700 border border-slate-700/50 rounded-2xl text-white font-black text-xl flex items-center justify-center transition-all duration-100 shadow-sm active:scale-95 disabled:opacity-50 disabled:active:scale-100"
                >
                  {num}
                </button>
              ))}
              <button
                onClick={() => setPinInput("")}
                className="aspect-square rounded-2xl text-slate-400 font-bold text-xs flex items-center justify-center hover:bg-slate-700/30 active:scale-95 transition-all"
              >
                Clear
              </button>
              <button
                key="0"
                onClick={() => handleKeypadPress("0")}
                disabled={lockoutTime > 0}
                className="aspect-square bg-slate-800 hover:bg-slate-700/80 active:bg-slate-700 border border-slate-700/50 rounded-2xl text-white font-black text-xl flex items-center justify-center transition-all duration-100 shadow-sm active:scale-95 disabled:opacity-50"
              >
                0
              </button>
              <button
                onClick={handleOfflineUnlock}
                disabled={lockoutTime > 0}
                className="aspect-square bg-orange-500 hover:bg-orange-600 text-white font-black text-sm rounded-2xl flex items-center justify-center transition-all active:scale-95 disabled:opacity-50"
              >
                Enter
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ── Settle Bill Modal overlay ─────────────────────────────── */}
      {settleOrder && !settlementResult && (
        <SettleBillModal
          order={settleOrder}
          restaurant={restaurant}
          staffName={staffName}
          onClose={() => setSettleBillId(null)}
          onSettled={(result) => {
            setSettledOrder(settleOrder);
            setSettlementResult(result);
            // Remove from open bills immediately (optimistic)
            setOpenBills((prev) => prev.filter((o) => o.id !== result.orderId));
          }}
        />
      )}
      {/* ── Void Bill Modal overlay ─────────────────────────────── */}
      {voidingOrder && (
        <VoidBillModal
          order={voidingOrder}
          cashierName={activeCashierName}
          onClose={() => setVoidingOrder(null)}
          onVoidComplete={async (orderId, reason) => {
            const executeOfflineVoidLocal = async (id: string, rsn: string) => {
              openCancellationSlip(voidingOrder, restaurant.name, activeCashierName, rsn);
              await dbDelete("ordersQueue", id);
              loadOfflineQueueBills();
              showSystemToast("Offline order deleted successfully.");
              setVoidingOrder(null);
            };

            const executeVoidOrderLocal = async (id: string, rsn: string) => {
              const res = await fetch(`/api/orders/${id}/status`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  status: "rejected",
                  voidReason: rsn,
                  voidedByStaffName: activeCashierName,
                }),
              });
              if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.error || "Failed to void order");
              }
              openCancellationSlip(voidingOrder, restaurant.name, activeCashierName, rsn);
              showSystemToast("Bill voided successfully.");
              setVoidingOrder(null);
            };

            const executeRequestCancellationLocal = async (id: string, rsn: string) => {
              const res = await fetch(`/api/orders/${id}/status`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  requestCancellation: true,
                  voidReason: rsn,
                  voidedByStaffName: activeCashierName,
                }),
              });
              if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.error || "Failed to send cancellation request");
              }
              showSystemToast("Cancellation request sent to owner.");
              setVoidingOrder(null);
            };

            // Check authorization rules
            const isStaff = role === "staff" || activeCashierRole === "staff";
            const managerPin = restaurant.cancellationManagerPinEnabled !== false;
            const ownerApproval = restaurant.cancellationOwnerApprovalEnabled !== false;
            const isOffline = voidingOrder.isOffline;

            if (isStaff && !isOffline) {
              if (managerPin && ownerApproval) {
                setPendingVoidParams({ orderId, reason });
                setVoidAuthChoiceOpen(true);
                return;
              } else if (managerPin) {
                setPendingVoidParams({ orderId, reason });
                setVerifyingAction("void_order");
                setPendingActionCallback(() => () => {
                  setVerifyingAction(null);
                  setPinInput("");
                  setPinError(null);
                  executeVoidOrderLocal(orderId, reason);
                });
                return;
              } else if (ownerApproval) {
                await executeRequestCancellationLocal(orderId, reason);
                return;
              }
            } else if (isStaff && isOffline) {
              if (managerPin) {
                setPendingVoidParams({ orderId, reason });
                setVerifyingAction("void_order");
                setPendingActionCallback(() => () => {
                  setVerifyingAction(null);
                  setPinInput("");
                  setPinError(null);
                  executeOfflineVoidLocal(orderId, reason);
                });
                return;
              }
            }

            // Normal void logic for managers, owners, offline/online fallback
            if (isOffline) {
              await executeOfflineVoidLocal(orderId, reason);
            } else {
              await executeVoidOrderLocal(orderId, reason);
            }
          }}
        />
      )}
      {/* ── Void Auth Choice Modal overlay ────────────────────────── */}
      {voidAuthChoiceOpen && pendingVoidParams && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden flex flex-col border border-gray-100 animate-in fade-in duration-200">
            <div className="px-6 py-4 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="font-black text-gray-900 text-sm uppercase tracking-wider">🔒 Approval Required</h3>
                <p className="text-[10px] text-gray-400 font-semibold mt-0.5">Select how to authorize this cancellation</p>
              </div>
              <button onClick={() => { setVoidAuthChoiceOpen(false); setPendingVoidParams(null); setVoidingOrder(null); }} className="text-gray-400 hover:text-gray-600 p-1">✕</button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-xs text-gray-500 font-medium leading-relaxed font-semibold">
                Both security methods are enabled for order voiding. You can request remote approval from the owner or get a local manager to enter their PIN.
              </p>
              <div className="grid grid-cols-1 gap-2.5">
                <button
                  type="button"
                  onClick={async () => {
                    const { orderId, reason } = pendingVoidParams;
                    setVoidAuthChoiceOpen(false);
                    // Trigger remote approval
                    const res = await fetch(`/api/orders/${orderId}/status`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        requestCancellation: true,
                        voidReason: reason,
                        voidedByStaffName: activeCashierName,
                      }),
                    });
                    if (!res.ok) {
                      const errData = await res.json();
                      alert(errData.error || "Failed to request cancellation");
                    } else {
                      showSystemToast("Cancellation request sent to owner.");
                    }
                    setVoidingOrder(null);
                    setPendingVoidParams(null);
                  }}
                  className="w-full p-4 bg-orange-600 hover:bg-orange-500 text-white rounded-2xl flex items-center gap-3 transition-all hover:scale-[1.02] active:scale-95"
                >
                  <span className="text-2xl">⏳</span>
                  <div className="text-left">
                    <p className="text-xs font-black uppercase tracking-wider">Request Owner Approval</p>
                    <p className="text-[10px] text-orange-200 font-bold mt-0.5">Sends a real-time notification to the owner dashboard</p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const { orderId, reason } = pendingVoidParams;
                    setVoidAuthChoiceOpen(false);
                    setVerifyingAction("void_order");
                    setPendingActionCallback(() => () => {
                      setVerifyingAction(null);
                      setPinInput("");
                      setPinError(null);
                      
                      // Now execute actual void
                      fetch(`/api/orders/${orderId}/status`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          status: "rejected",
                          voidReason: reason,
                          voidedByStaffName: activeCashierName,
                        }),
                      }).then((res) => {
                        if (res.ok) {
                          openCancellationSlip(voidingOrder!, restaurant.name, activeCashierName, reason);
                          showSystemToast("Bill voided successfully via manager override.");
                        } else {
                          res.json().then(e => alert(e.error || "Failed to void order"));
                        }
                        setVoidingOrder(null);
                        setPendingVoidParams(null);
                      });
                    });
                  }}
                  className="w-full p-4 bg-teal-700 hover:bg-teal-650 text-white rounded-2xl flex items-center gap-3 transition-all hover:scale-[1.02] active:scale-95"
                >
                  <span className="text-2xl">🔑</span>
                  <div className="text-left">
                    <p className="text-xs font-black uppercase tracking-wider">Manager PIN Override</p>
                    <p className="text-[10px] text-teal-200 font-bold mt-0.5">A manager or owner enters their passcode locally</p>
                  </div>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {settleBillId && settlementResult && (
        <SettlementSuccessModal
          order={settledOrder}
          result={settlementResult}
          restaurantName={restaurant.name}
          onClose={() => {
            setSettleBillId(null);
            setSettlementResult(null);
            setSettledOrder(null);
          }}
          onPrint={() =>
            openSettledBillWindow(
              settledOrder!,
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
            openPOSReceiptWindow(order, restaurant.name, staffName, 1)
          }
        />
      )}

      {/* ── Two-column POS layout ─────────────────────────────────── */}
      <div className="flex flex-col lg:flex-row flex-1 overflow-hidden min-h-0">
        {/* LEFT: Menu — hidden on mobile when cart is open */}
        <div className={`flex-col min-w-0 overflow-hidden bg-gray-50 ${mobileCartOpen ? "hidden lg:flex" : "flex"} flex-1`}>
          {/* Top bar with offline status pills */}
          <div className="bg-white border-b border-gray-200 px-4 py-3 flex flex-wrap items-center justify-between flex-shrink-0 gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-black text-gray-900 text-base whitespace-nowrap hidden xl:block">
                POS / Counter Sales
              </h1>
              
              {/* Terminal identity pill */}
              <button
                onClick={() => {
                  setTerminalNameInput(termName);
                  setShowTerminalSetup(true);
                }}
                className="flex items-center gap-1.5 px-3 py-1 bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-700 rounded-full font-bold text-[10px] uppercase tracking-wider transition-all"
                title="Click to rename terminal"
              >
                🖥️ {termName}
              </button>

              {/* Active Cashier pill */}
              <div className="flex items-center gap-2 px-3 py-1 bg-gray-50 border border-gray-200 text-gray-700 rounded-full font-bold text-[10px] uppercase tracking-wider">
                👤 {activeCashierName}
                <button
                  onClick={() => {
                    const currentStaff = cachedStaffList.find(x => x.staffId === activeCashierId) ||
                                         (activeCashierId === staffId ? { staffId, staffName, role: "owner", pinSalt: "", pinHash: "", isActive: true } : null);
                    setSelectedCashierForPin(currentStaff);
                    setCashierPinOld("");
                    setCashierPinNew("");
                    setCashierPinConfirm("");
                    setCashierPinError(null);
                    setShowCashierPinModal(true);
                  }}
                  className="ml-1 bg-orange-100 hover:bg-orange-200 text-orange-700 px-1.5 py-0.5 rounded-md text-[8px] transition-all font-black"
                  title="Set/Change PIN"
                >
                  🔑 PIN
                </button>
                <button
                  onClick={() => setIsTerminalLocked(true)}
                  className="bg-gray-200 hover:bg-gray-300 text-gray-700 w-4 h-4 rounded-full flex items-center justify-center text-[8px] transition-all"
                  title="Lock terminal or switch cashier"
                >
                  🔒
                </button>
              </div>

              {/* Connection status pill */}
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-gray-100 text-[10px] font-bold uppercase tracking-wider">
                <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? "bg-green-500 animate-pulse" : "bg-amber-500 animate-pulse"}`} />
                <span className={isOnline ? "text-green-700" : "text-amber-700"}>
                  {isOnline ? "Online" : "Offline Mode"}
                </span>
              </div>

              {/* Sync status indicators */}
              {pendingOfflineCount > 0 && (
                <button
                  onClick={triggerBackgroundSync}
                  disabled={syncingOffline || !isOnline}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full font-black text-[10px] uppercase tracking-wider transition-all border shrink-0 ${
                    syncFailed 
                      ? "bg-red-50 hover:bg-red-100 text-red-700 border-red-200" 
                      : "bg-amber-50 hover:bg-amber-100 text-amber-700 border-amber-200 animate-pulse"
                  }`}
                >
                  {syncFailed ? "⚠️ Sync Failed" : syncingOffline ? "🔄 Syncing..." : `⚠️ ${pendingOfflineCount} Offline Sales`}
                </button>
              )}

              {/* Last sync time */}
              <span className="text-[9px] text-gray-400 font-bold uppercase tracking-wider">
                Sync: {lastSyncText}
              </span>
            </div>
            <div className="flex-1 max-w-md">
              <input
                type="text"
                name="pos-search-query"
                autoComplete="off"
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
              {(openBills.length + offlineQueueBills.length) > 0 && (
                <span className={`ml-1.5 text-[10px] font-black px-1.5 py-0.5 rounded-full ${
                  rightTab === "bills" ? "bg-teal-600 text-white" : "bg-teal-100 text-teal-700"
                }`}>
                  {openBills.length + offlineQueueBills.length}
                </span>
              )}
            </button>
          </div>

          {/* ── Open Bills panel ──────────────────────────────────── */}
          {rightTab === "bills" && (
            <OpenBillsPanel
              bills={[
                // Offline queue orders first (most urgent — no internet)
                ...offlineQueueBills,
                // Then Firestore live orders (dedup by id in case both appear briefly during sync)
                ...openBills.filter(b => !offlineQueueBills.some(o => o.id === b.id)),
              ]}
              onSettle={(id) => {
                setSettleBillId(id);
                setSettlementResult(null);
                setSettledOrder(null);
              }}
              onSettleOffline={(localOrderId, method, note) =>
                settleOfflineOrder(localOrderId, method, note, restaurant.name, activeCashierName)
              }
              onEdit={handleEditOrder}
              onPrintReceipt={(bill) => {
                openPOSReceiptWindow(bill, restaurant.name, activeCashierName, printCopies);
              }}
              onVoid={(bill) => {
                if (bill.cancellationRequested) {
                  setPendingVoidParams({ orderId: bill.id, reason: bill.cancellationReason || "Manager PIN Override" });
                  setVerifyingAction("void_order");
                  setPendingActionCallback(() => () => {
                    setVerifyingAction(null);
                    setPinInput("");
                    setPinError(null);
                    
                    fetch(`/api/orders/${bill.id}/status`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        status: "rejected",
                        voidReason: bill.cancellationReason || "Manager PIN Override",
                        voidedByStaffName: activeCashierName,
                      }),
                    }).then((res) => {
                      if (res.ok) {
                        openCancellationSlip(bill, restaurant.name, activeCashierName, bill.cancellationReason || "Manager PIN Override");
                        showSystemToast("Bill voided successfully via manager override.");
                      } else {
                        res.json().then(e => alert(e.error || "Failed to void order"));
                      }
                      setVoidingOrder(null);
                      setPendingVoidParams(null);
                    });
                  });
                } else {
                  setVoidingOrder(bill);
                }
              }}
              cancellationManagerPinEnabled={restaurant.cancellationManagerPinEnabled !== false}
            />
          )}

          {rightTab === "order" && (
            <>
              {/* ── Scrollable middle layout container ──────────────────────── */}
              <div className="flex-1 overflow-y-auto min-h-0 p-3 space-y-3 bg-gray-50/20">
                
                {/* Card 1: Context Header (Service Mode & Pricing Mode & Table) */}
                <div className="bg-white border border-gray-200/80 rounded-2xl p-3.5 space-y-3.5 shadow-sm">
                  <div>
                    <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1.5">
                      Service / Ordering Mode
                    </p>
                    <div className="flex rounded-xl overflow-hidden border border-gray-200 bg-gray-50 p-0.5">
                      <button
                        type="button"
                        onClick={() => switchServiceMode("counter")}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-black transition-all ${
                          serviceMode === "counter"
                            ? "bg-white text-gray-900 shadow-sm border border-gray-200/50"
                            : "text-gray-500 hover:text-gray-800"
                        }`}
                      >
                        Counter Pickup
                      </button>
                      <button
                        type="button"
                        onClick={() => switchServiceMode("dine_in")}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-black transition-all ${
                          serviceMode === "dine_in"
                            ? "bg-teal-600 text-white shadow-sm"
                            : "text-gray-500 hover:text-teal-700 hover:bg-teal-50/50"
                        }`}
                      >
                        Dine-In
                      </button>
                    </div>
                  </div>

                  <div>
                    <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1.5">
                      Pricing Tier Selector
                    </p>
                    <div className="flex rounded-xl overflow-hidden border border-gray-200 bg-gray-50 p-0.5">
                      <button
                        type="button"
                        onClick={() => setPricingMode("regular")}
                        className={`flex-1 py-1.5 rounded-lg text-[10px] font-black transition-all ${
                          pricingMode === "regular"
                            ? "bg-white text-gray-900 shadow-sm border border-gray-200/50"
                            : "text-gray-500 hover:text-gray-800"
                        }`}
                      >
                        Regular (Inside)
                      </button>
                      <button
                        type="button"
                        onClick={() => setPricingMode("indoor")}
                        className={`flex-1 py-1.5 rounded-lg text-[10px] font-black transition-all ${
                          pricingMode === "indoor"
                            ? "bg-orange-600 text-white shadow-sm border border-orange-700/10"
                            : "text-gray-500 hover:bg-orange-50/50 hover:text-orange-700"
                        }`}
                      >
                        Outside Price
                      </button>
                    </div>
                  </div>

                  {/* Table selector — dine-in only */}
                  {serviceMode === "dine_in" && (
                    <div className="pt-2 border-t border-gray-100 space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">
                          Assign Table
                        </p>
                        {(tableLabel || tableLabelInput) && (
                          <span className="text-[10px] font-black text-teal-700 bg-teal-50 px-2.5 py-0.5 rounded-full border border-teal-100">
                            {tableLabelInput.trim() || tableLabel}
                          </span>
                        )}
                      </div>
                      {/* Quick-tap table numbers */}
                      <div className="flex flex-wrap gap-1.5 justify-between">
                        {QUICK_TABLES.map((n) => {
                          const label = `Table ${n}`;
                          const isActive =
                            !tableLabelInput.trim() && tableLabel === label;
                          return (
                            <button
                              key={n}
                              type="button"
                              onClick={() => {
                                setTableLabel(label);
                                setTableLabelInput("");
                                setOpenTabPromptDismissed(false);
                                if (tabMode === "continue" && activeTab?.tableLabel !== label) {
                                  setTabMode("new");
                                  setActiveTab(null);
                                }
                              }}
                              className={`w-8 h-8 rounded-xl text-xs font-black transition-all flex items-center justify-center ${
                                isActive
                                  ? "bg-teal-600 text-white shadow-sm"
                                  : "bg-gray-50 text-gray-700 hover:bg-teal-50 hover:text-teal-700 border border-gray-200/60"
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
                        placeholder="Or type custom: VIP 1, Deck A..."
                        value={tableLabelInput}
                        onChange={(e) => {
                          setTableLabelInput(e.target.value);
                          setOpenTabPromptDismissed(false);
                          if (tabMode === "continue") { setTabMode("new"); setActiveTab(null); }
                        }}
                        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs font-semibold outline-none focus:border-teal-500 bg-gray-50/50 focus:bg-white transition-all placeholder-gray-400"
                      />
                    </div>
                  )}
                </div>

                {/* Active Edit Order Card Alert */}
                {editingOrderId && (
                  <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 flex items-center justify-between gap-3 shadow-sm animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                        <p className="text-[10px] font-black text-amber-800 uppercase tracking-widest">Active Editing Mode</p>
                      </div>
                      <p className="text-[11px] text-amber-600 font-bold font-mono mt-0.5">Order ID: #{editingOrderId.slice(-6).toUpperCase()}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingOrderId(null);
                        resetPOS();
                        showSystemToast("Order editing cancelled");
                      }}
                      className="bg-amber-100 hover:bg-amber-200 active:bg-amber-300 text-amber-800 text-[10px] font-black px-3 py-1.5 rounded-lg transition-colors border border-amber-200"
                    >
                      Cancel Edit
                    </button>
                  </div>
                )}

                {/* ── Open tab prompt ─────────────────────────────────────── */}
                {serviceMode === "dine_in" && resolvedTable && tabMode !== "continue" && openTabForTable && !openTabPromptDismissed && (
                  <div className="rounded-2xl border-2 border-teal-300 bg-teal-50 overflow-hidden flex-shrink-0">
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
                          type="button"
                          onClick={() => {
                            setActiveTab(openTabForTable);
                            setTabMode("continue");
                          }}
                          className="flex-[2] bg-teal-600 hover:bg-teal-500 text-white font-black text-xs py-2 rounded-xl transition-colors"
                        >
                          Continue Tab
                        </button>
                        <button
                          type="button"
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
                  <div className="rounded-xl bg-teal-700 px-3 py-2 flex items-center justify-between flex-shrink-0">
                    <div>
                      <p className="text-white font-black text-sm leading-tight">{activeTab.tableLabel}</p>
                      <p className="text-teal-200 text-[11px] font-bold">
                        Running tab · {fmt(activeTab.total)} · Adding on
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => { setTabMode("new"); setActiveTab(null); setOpenTabPromptDismissed(true); }}
                      className="text-teal-300 hover:text-white text-xs font-bold underline transition-colors flex-shrink-0 ml-2"
                    >
                      New Tab
                    </button>
                  </div>
                )}

                {/* Cart list card */}
                <div className="bg-white border border-gray-200/80 rounded-2xl overflow-hidden shadow-sm">
                  {/* Cart header */}
                  <div className="px-4 py-3 border-b border-gray-150 flex items-center justify-between">
                    <h2 className="font-black text-gray-900 text-sm flex items-center gap-1.5">
                      <span>🛒</span>
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
                        type="button"
                        onClick={() => setCart([])}
                        className="text-xs font-bold text-red-400 hover:text-red-600 transition-colors"
                      >
                        Clear all
                      </button>
                    )}
                  </div>

                  {/* Cart items mapping */}
                  <div className="divide-y divide-gray-100 max-h-[360px] overflow-y-auto min-h-0 bg-white">
                    {cart.length === 0 ? (
                      <div className="py-10 text-center text-gray-400 text-sm px-6">
                        <p className="text-2xl mb-1">🛒</p>
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
                          <div key={item.cartItemId} className="flex flex-col gap-1 px-4 py-3 bg-white hover:bg-gray-50/50 transition-colors">
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
                                      type="button"
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
                              <div className="flex items-center gap-1.5 flex-shrink-0">
                                <button
                                  type="button"
                                  onClick={() => updateQuantity(item.cartItemId, -1)}
                                  className="w-6 h-6 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-black text-sm flex items-center justify-center leading-none transition-colors"
                                >
                                  −
                                </button>
                                <span className="w-6 text-center font-black text-xs tabular-nums">
                                  {item.quantity}
                                </span>
                                <button
                                  type="button"
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
                                type="button"
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
                </div>

                {/* Card 2: Attribution (Guest + Attendant) */}
                <div className="bg-white border border-gray-200/80 rounded-2xl p-3 space-y-3 shadow-sm">
                  <div className="flex justify-between items-center border-b border-gray-50 pb-2">
                    <span className="text-xs font-black text-gray-800 uppercase tracking-widest">Attribution Details</span>
                    {tabMode === "continue" && activeTab && (
                      <span className="text-[10px] font-black bg-teal-50 text-teal-700 px-2 py-0.5 rounded-full border border-teal-100">
                        Adding to Tab
                      </span>
                    )}
                  </div>

                  {tabMode !== "continue" && (
                    <div>
                      <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1.5">
                        Customer Reference
                      </p>
                      <input
                        type="text"
                        placeholder="Enter guest/customer name (optional)"
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs font-semibold outline-none focus:border-orange-500 bg-gray-50/50 focus:bg-white transition-all placeholder-gray-400"
                      />
                    </div>
                  )}

                  <div>
                    <div className="flex justify-between items-center mb-1.5">
                      <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">
                        Attendant / Waiter
                      </p>
                    </div>
                    <select
                      value={selectedWaiterName || ""}
                      onChange={(e) => setSelectedWaiterName(e.target.value || null)}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs font-semibold outline-none focus:border-orange-500 bg-gray-50/50 focus:bg-white transition-all"
                    >
                      <option value="">-- Select Assigned Attendant --</option>
                      {waiters.map((w) => (
                        <option key={w.id} value={w.name}>
                          {w.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Card 3: Settlement details */}
                {tabMode !== "continue" && (
                  <div className="bg-white border border-gray-200/80 rounded-2xl p-3 space-y-3.5 shadow-sm">
                    <div className="flex justify-between items-center border-b border-gray-50 pb-2">
                      <span className="text-xs font-black text-gray-800 uppercase tracking-widest">Settlement Info</span>
                    </div>

                    {/* Payment method */}
                    <div>
                      <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1.5">
                        Payment Method
                      </p>
                      <div className="grid grid-cols-2 gap-1.5">
                        {(
                          ["cash", "bank_transfer", "card", "unpaid"] as PaymentMethod[]
                        ).map((pm) => {
                          const isActive = paymentMethod === pm;
                          return (
                            <button
                              key={pm}
                              type="button"
                              onClick={() => setPaymentMethod(pm)}
                              className={`py-2 px-2 rounded-xl text-[11px] font-black transition-all text-center leading-tight border ${
                                isActive
                                  ? "bg-gray-900 border-gray-900 text-white shadow-sm"
                                  : "bg-gray-50 border-gray-200/60 text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                              }`}
                            >
                              {PAYMENT_METHOD_LABELS[pm]}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Payment status */}
                    <div>
                      <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1.5">
                        Payment Status
                      </p>
                      <div className="grid grid-cols-4 gap-1">
                        {(
                          ["paid", "unpaid", "part_paid", "cancelled"] as PaymentStatus[]
                        ).map((ps) => {
                          const isActive = paymentStatus === ps;
                          return (
                            <button
                              key={ps}
                              type="button"
                              onClick={() => setPaymentStatus(ps)}
                              className={`py-1.5 rounded-lg text-[9px] font-black transition-all text-center border ${
                                isActive
                                  ? ps === "paid"
                                    ? "bg-green-600 border-green-600 text-white shadow-sm"
                                    : ps === "cancelled"
                                    ? "bg-red-600 border-red-600 text-white shadow-sm"
                                    : "bg-yellow-500 border-yellow-500 text-white shadow-sm"
                                  : "bg-gray-50 border-gray-200/60 text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                              }`}
                            >
                              {PAYMENT_STATUS_LABELS[ps]}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {/* Note & Print Options Card */}
                <div className="bg-white border border-gray-200/80 rounded-2xl p-3 space-y-3.5 shadow-sm">
                  <div>
                    <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1.5">
                      Order Note / Modifier
                    </p>
                    <input
                      type="text"
                      placeholder={tabMode === "continue" ? "E.g. Extra hot, extra sauce..." : "E.g. No onions, well done..."}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs font-semibold outline-none focus:border-orange-500 bg-gray-50/50 focus:bg-white transition-all placeholder-gray-400"
                    />
                  </div>

                  {/* Print copies selector */}
                  <div>
                    <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1.5">
                      Physical Printer Tickets
                    </p>
                    <div className="flex rounded-xl overflow-hidden border border-gray-200 bg-gray-50 p-0.5">
                      {([1, 2, 3] as const).map((copies) => {
                        const isActive = printCopies === copies;
                        return (
                          <button
                            key={copies}
                            type="button"
                            onClick={() => setPrintCopies(copies)}
                            className={`flex-1 py-1.5 rounded-lg text-[9px] font-black transition-all ${
                              isActive
                                ? "bg-white text-gray-900 shadow-sm border border-gray-200/50"
                                : "text-gray-500 hover:text-gray-800"
                            }`}
                          >
                            {copies === 1 ? "1 Copy" : copies === 2 ? "2 Copies (KOT)" : "3 Copies (Audit)"}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

              {/* ── Sticky Bottom payment Total & Checkout triggers ────────── */}
              <div className="border-t border-gray-100 p-3.5 space-y-2 flex-shrink-0 bg-white shadow-[0_-4px_16px_rgba(0,0,0,0.03)] z-10">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                    {tabMode === "continue" ? "Running Additions" : "Total Invoice Amount"}
                  </span>
                  <span className="text-2xl font-black text-gray-900 tabular-nums">
                    {fmt(cartTotal)}
                  </span>
                </div>

                {tabMode === "continue" && activeTab && cartTotal > 0 && (
                  <div className="bg-teal-50 border border-teal-200 rounded-xl px-3 py-2 flex justify-between items-center">
                    <span className="text-[10px] font-black text-teal-700 uppercase tracking-wider">New Combined Tab Total</span>
                    <span className="text-base font-black text-teal-700 tabular-nums">
                      {fmt(activeTab.total + cartTotal)}
                    </span>
                  </div>
                )}

                {error && (
                  <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-700 font-bold">
                    ⚠️ {error}
                  </div>
                )}

                {/* Confirm / Add-to-tab button */}
                <button
                  onClick={handleSubmit}
                  disabled={cart.length === 0 || submitting || (serviceMode === "dine_in" && tabMode === "new" && !resolvedTable)}
                  className={`w-full disabled:opacity-40 disabled:cursor-not-allowed text-white font-black py-4 rounded-xl transition-all shadow-md active:translate-y-0.5 text-sm ${
                    editingOrderId
                      ? "bg-amber-600 hover:bg-amber-500 hover:shadow-amber-600/10 active:bg-amber-700"
                      : tabMode === "continue"
                      ? "bg-teal-700 hover:bg-teal-600 hover:shadow-teal-700/10 active:bg-teal-800"
                      : serviceMode === "dine_in"
                      ? "bg-teal-600 hover:bg-teal-500 hover:shadow-teal-600/10 active:bg-teal-700"
                      : "bg-orange-600 hover:bg-orange-500 hover:shadow-orange-600/10 active:bg-orange-700"
                  }`}
                >
                  {submitting
                    ? editingOrderId
                      ? "Saving Changes…"
                      : tabMode === "continue"
                      ? "Adding to Tab…"
                      : serviceMode === "counter" && paymentStatus === "unpaid"
                      ? "Placing Order…"
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
                    : paymentStatus === "unpaid"
                    ? `Place Order · ${fmt(cartTotal)}`
                    : `Confirm & Pay · ${fmt(cartTotal)}`}
                </button>

                <p className="text-center text-[10px] text-gray-400">
                  Cashier:{" "}
                  <span className="font-bold text-gray-600 uppercase">{staffName}</span>
                </p>
              </div>
            </>
          )}
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
          <form
            onSubmit={(e) => {
              e.preventDefault();
              verifyPin();
            }}
            className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden p-6 text-center animate-scale-in border border-gray-100"
            autoComplete="off"
          >
            {/* Dummy credentials inputs to catch browser autofill */}
            <input type="text" name="username" style={{ display: 'none' }} autoComplete="username" />
            <input type="password" name="password" style={{ display: 'none' }} autoComplete="new-password" />

            <div className="w-12 h-12 bg-amber-50 text-amber-500 rounded-2xl flex items-center justify-center mx-auto mb-4 text-xl border border-amber-200">
              🔑
            </div>
            <h3 className="font-black text-gray-900 text-lg">Manager Override Required</h3>
            <p className="text-xs text-gray-400 mt-1 font-bold">
              {verifyingAction === "void_item"
                ? "Manager approval is needed to VOID an item from active tray."
                : verifyingAction === "void_order"
                ? "Manager approval is needed to VOID / CANCEL an active bill."
                : "Manager approval is needed to APPLY custom manual pricing overrides."}
            </p>

            <div className="mt-5">
              <input
                type="password"
                autoComplete="new-password"
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
                type="button"
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
                type="submit"
                className="flex-1 bg-amber-500 hover:bg-amber-600 text-white font-black py-3 rounded-xl transition-colors text-xs"
              >
                Authorize Action
              </button>
            </div>
            {managersWithPinCount === 0 ? (
              <p className="text-[10px] text-red-500 bg-red-50 border border-red-150 p-2.5 rounded-xl mt-4 font-bold leading-normal">
                ⚠️ No manager PIN configured. Please set a PIN in Staff Settings or POS settings.
              </p>
            ) : (
              <p className="text-[9px] text-gray-400 mt-4 uppercase tracking-wider font-bold">
                Enter your 4-digit manager authorization PIN
              </p>
            )}
          </form>
        </div>
      )}

      {/* ── Cashier PIN Settings Modal ── */}
      {showCashierPinModal && selectedCashierForPin && (
        <div className="fixed inset-0 bg-black/60 z-[10000] flex items-center justify-center p-4 animate-fade-in">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSaveCashierPin();
            }}
            className="bg-white rounded-3xl p-6 w-full max-w-sm border border-gray-100 shadow-2xl space-y-4 text-left"
            autoComplete="off"
          >
            {/* Dummy credentials inputs to catch browser autofill */}
            <input type="text" name="username" style={{ display: 'none' }} autoComplete="username" />
            <input type="password" name="password" style={{ display: 'none' }} autoComplete="new-password" />

            <div>
              <h3 className="text-lg font-black text-gray-900">Configure POS PIN Code</h3>
              <p className="text-xs text-gray-400 mt-1">
                For cashier <strong>{selectedCashierForPin.staffName}</strong>.
              </p>
            </div>

            {cashierPinError && (
              <div className="bg-red-50 border border-red-200 text-red-600 text-xs px-3.5 py-2.5 rounded-xl font-bold leading-normal">
                {cashierPinError}
              </div>
            )}

            {!isOnline && (
              <div className="bg-amber-50 border border-amber-250 text-amber-800 text-[10px] px-3.5 py-2 rounded-xl font-bold leading-relaxed">
                ⚠️ Internet connection is required to update credentials on the server.
              </div>
            )}

            {selectedCashierForPin.pinHash && (
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide">
                  Current PIN Passcode
                </label>
                <input
                  type="password"
                  autoComplete="new-password"
                  pattern="\d*"
                  maxLength={4}
                  value={cashierPinOld}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, "");
                    if (val.length <= 4) setCashierPinOld(val);
                  }}
                  placeholder="••••"
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-md text-center tracking-widest outline-none focus:border-orange-500 font-bold font-mono text-slate-800 bg-white"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide">
                New 4-Digit PIN
              </label>
              <input
                type="password"
                autoComplete="new-password"
                pattern="\d*"
                maxLength={4}
                value={cashierPinNew}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, "");
                  if (val.length <= 4) setCashierPinNew(val);
                }}
                placeholder="••••"
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-md text-center tracking-widest outline-none focus:border-orange-500 font-bold font-mono text-slate-800 bg-white"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide">
                Confirm New PIN
              </label>
              <input
                type="password"
                autoComplete="new-password"
                pattern="\d*"
                maxLength={4}
                value={cashierPinConfirm}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, "");
                  if (val.length <= 4) setCashierPinConfirm(val);
                }}
                placeholder="••••"
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-md text-center tracking-widest outline-none focus:border-orange-500 font-bold font-mono text-slate-800 bg-white"
              />
            </div>

            <div className="flex gap-2.5 pt-2">
              <button
                type="submit"
                disabled={cashierPinSubmitting || !isOnline}
                className="flex-1 bg-orange-600 hover:bg-orange-500 text-white font-bold text-sm py-3 rounded-xl disabled:opacity-50 transition-colors"
              >
                {cashierPinSubmitting ? "Saving..." : "Save PIN"}
              </button>
              <button
                type="button"
                disabled={cashierPinSubmitting}
                onClick={() => {
                  setShowCashierPinModal(false);
                  setSelectedCashierForPin(null);
                }}
                className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-sm py-3 rounded-xl transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
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
  onSettleOffline,
  onEdit,
  onVoid,
  onPrintReceipt,
  cancellationManagerPinEnabled,
}: {
  bills: TodayOrder[];
  onSettle: (orderId: string) => void;
  onSettleOffline: (localOrderId: string, method: string, note: string) => void;
  onEdit: (bill: TodayOrder) => void;
  onVoid: (bill: TodayOrder) => void;
  onPrintReceipt: (bill: TodayOrder) => void;
  cancellationManagerPinEnabled?: boolean;
}) {
  const [offlineSettleId, setOfflineSettleId] = useState<string | null>(null);
  const [offlineMethod, setOfflineMethod] = useState<"cash" | "bank_transfer" | "card">("cash");

  if (bills.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-12">
        <p className="text-3xl mb-3">🧾</p>
        <p className="text-sm font-bold text-gray-400">No open bills</p>
        <p className="text-xs text-gray-300 mt-1">
          Unpaid counter and dine-in orders will appear here.
        </p>
      </div>
    );
  }

  const isDineIn = (bill: TodayOrder) =>
    bill.serviceMode === "dine_in" || bill.deliveryType === "dine_in";

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-0">
      {bills.map((bill) => {
        const shortId = bill.id.slice(-6).toUpperCase();
        const dineIn = isDineIn(bill);
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

        // Primary heading: table for dine-in, customer name for counter
        const heading = dineIn
          ? (bill.tableLabel || `#${shortId}`)
          : (bill.customerName && bill.customerName !== "Walk-in Customer" && bill.customerName !== "Walk-in Guest"
              ? bill.customerName
              : `#${shortId}`);

        return (
          <div
            key={bill.id}
            className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm"
          >
            {/* Heading row */}
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-black text-teal-700 text-xl leading-tight truncate">
                    {heading}
                  </p>
                  <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-wide ${
                    dineIn
                      ? "bg-purple-100 text-purple-700"
                      : "bg-blue-100 text-blue-700"
                  }`}>
                    {dineIn ? "Dine-In" : "Counter"}
                  </span>
                </div>
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

            {/* Meta row: customer (if dine-in heading was table), waiter, pricing */}
            {(
              (dineIn && bill.customerName && bill.customerName !== bill.tableLabel) ||
              (!dineIn && bill.customerName && bill.customerName !== heading) ||
              bill.waiterName ||
              bill.pricingMode === "indoor"
            ) && (
              <div className="bg-gray-50 rounded-xl px-3 py-2 text-[11px] space-y-1 text-gray-600 font-semibold mb-3 border border-gray-100">
                {bill.customerName && bill.customerName !== bill.tableLabel && bill.customerName !== heading && (
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

            {/* Item preview for counter orders */}
            {!dineIn && (
              <div className="mb-3 space-y-0.5">
                {bill.items.slice(0, 3).map((item: any, i: number) => (
                  <div key={i} className="flex justify-between text-xs text-gray-500">
                    <span className="truncate">{item.quantity}× {item.name}</span>
                    <span className="font-semibold text-gray-700 ml-2 flex-shrink-0">{fmt(item.price * item.quantity)}</span>
                  </div>
                ))}
                {bill.items.length > 3 && (
                  <p className="text-[10px] text-gray-400">+{bill.items.length - 3} more item{bill.items.length - 3 !== 1 ? "s" : ""}</p>
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

            {/* Offline badge */}
            {bill.isOffline && (
              <div className="mb-2 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block"></span>
                <span className="text-[10px] font-bold text-amber-600 uppercase tracking-wide">Saved Offline · Syncs when online</span>
              </div>
            )}

            {/* Inline payment method picker for offline orders */}
            {bill.isOffline && offlineSettleId === bill.id && (
              <div className="mb-3 bg-teal-50 border border-teal-200 rounded-2xl p-3">
                <p className="text-[10px] font-black text-teal-700 uppercase tracking-wider mb-2">Payment Method</p>
                <div className="grid grid-cols-3 gap-1.5 mb-3">
                  {(["cash","bank_transfer","card"] as const).map(m => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setOfflineMethod(m)}
                      className={`text-[10px] font-black py-2 rounded-xl border transition-all ${
                        offlineMethod === m
                          ? "bg-teal-600 text-white border-teal-600"
                          : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
                      }`}
                    >
                      {m === "cash" ? "Cash" : m === "bank_transfer" ? "Transfer" : "Card"}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setOfflineSettleId(null)}
                    className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-black text-xs py-2.5 rounded-xl border border-gray-200"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => { onSettleOffline(bill.id, offlineMethod, ""); setOfflineSettleId(null); }}
                    className="flex-1 bg-teal-600 hover:bg-teal-500 text-white font-black text-xs py-2.5 rounded-xl"
                  >
                    Confirm Payment
                  </button>
                </div>
              </div>
            )}

            {bill.cancellationRequested && (
              <div className="bg-orange-50 border border-orange-200 rounded-2xl p-3 mb-2 flex flex-col gap-2">
                <div className="flex items-center gap-1.5 text-orange-700 font-bold text-[11px] uppercase tracking-wide">
                  <span className="animate-pulse text-base">⏳</span>
                  <span>Cancellation Pending Owner Approval</span>
                </div>
                {bill.cancellationReason && (
                  <p className="text-[10px] text-gray-500 font-bold leading-relaxed">
                    Reason: "{bill.cancellationReason}"
                  </p>
                )}
                {cancellationManagerPinEnabled && (
                  <button
                    type="button"
                    onClick={() => onVoid(bill)}
                    className="w-full bg-teal-700 hover:bg-teal-650 text-white font-black text-xs py-2.5 rounded-xl transition-colors text-center flex items-center justify-center gap-1.5 shadow-sm active:scale-95"
                  >
                    🔑 Enter Manager PIN Override
                  </button>
                )}
              </div>
            )}

            {!bill.cancellationRequested && (
              <>
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
                    onClick={() => {
                      if (bill.isOffline) {
                        setOfflineMethod("cash");
                        setOfflineSettleId(offlineSettleId === bill.id ? null : bill.id);
                      } else {
                        onSettle(bill.id);
                      }
                    }}
                    className="flex-1 bg-teal-600 hover:bg-teal-500 active:bg-teal-700 text-white font-black text-sm py-3.5 rounded-xl transition-colors"
                  >
                    Settle Bill
                  </button>
                </div>
                <div className="flex gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() => onPrintReceipt(bill)}
                    className="flex-1 bg-white hover:bg-teal-50 active:bg-teal-100 text-teal-700 font-black text-xs py-2.5 rounded-xl transition-colors border border-teal-200 text-center flex items-center justify-center gap-1.5 animate-fade-in"
                  >
                    🖨️ Print Receipt
                  </button>
                  <button
                    type="button"
                    onClick={() => onVoid(bill)}
                    className="flex-1 bg-red-50 hover:bg-red-100 active:bg-red-200 text-red-600 font-black text-xs py-2.5 rounded-xl transition-colors border border-red-100 text-center flex items-center justify-center gap-1.5"
                  >
                    ⚠️ Void Bill
                  </button>
                </div>
              </>
            )}
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
            {order.waiterName && (
              <ReceiptRow label="Waiter/Attendant" value={order.waiterName} accent />
            )}
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

// ── Void Bill Modal ───────────────────────────────────────────────────────────

function VoidBillModal({
  order,
  cashierName,
  onClose,
  onVoidComplete,
}: {
  order: TodayOrder;
  cashierName: string;
  onClose: () => void;
  onVoidComplete: (orderId: string, reason: string) => Promise<void>;
}) {
  const [selectedReason, setSelectedReason] = useState("");
  const [customReason, setCustomReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleVoid = async () => {
    const finalReason = selectedReason === "other" ? customReason.trim() : selectedReason;
    if (!finalReason) return;
    setSubmitting(true);
    setError(null);
    try {
      await onVoidComplete(order.id, finalReason);
    } catch (e: any) {
      setError(e.message || "Failed to void order. Please try again.");
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden flex flex-col border border-gray-100 animate-in fade-in duration-200">
        <div className="px-6 py-4 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="font-black text-gray-900 text-sm uppercase tracking-wider">⚠️ Void / Cancel Bill</h3>
            <p className="text-[10px] text-gray-400 font-semibold mt-0.5">Order #{order.id.slice(-6).toUpperCase()}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">✕</button>
        </div>

        <div className="p-6 space-y-4">
          <div className="bg-red-50/60 border border-red-100 rounded-2xl p-4 text-xs text-red-700 space-y-1">
            <p className="font-extrabold">Warning: voiding this bill will cancel it in the system.</p>
            <p className="font-semibold text-[11px] leading-relaxed">
              This action will keep a permanent record of the cancellation under cashier <span className="underline">{cashierName}</span> for auditing purposes.
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block">Select Void Reason</label>
            <select
              value={selectedReason}
              onChange={(e) => {
                setSelectedReason(e.target.value);
                if (e.target.value !== "other") {
                  setCustomReason("");
                }
              }}
              className="w-full px-4 py-3 rounded-2xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 text-sm font-bold text-gray-700 bg-white"
            >
              <option value="">-- Choose a reason --</option>
              <option value="Customer walked out / left">Customer walked out / left</option>
              <option value="Order entered in error">Order entered in error</option>
              <option value="Kitchen delayed / changed mind">Kitchen delayed / changed mind</option>
              <option value="other">Other (specify reason)</option>
            </select>
          </div>

          {selectedReason === "other" && (
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block">Specify Custom Reason</label>
              <textarea
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                placeholder="Type the cancellation details here..."
                className="w-full px-4 py-3 rounded-2xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 text-sm font-semibold text-gray-700"
                rows={2}
              />
            </div>
          )}

          {error && (
            <p className="text-xs font-bold text-red-600 bg-red-50 border border-red-100 rounded-xl p-3">{error}</p>
          )}
        </div>

        <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-3 border border-gray-200 hover:bg-gray-100 text-gray-600 rounded-2xl text-sm font-black transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleVoid}
            disabled={submitting || !selectedReason || (selectedReason === "other" && !customReason.trim())}
            className="flex-1 py-3 bg-red-600 hover:bg-red-500 disabled:bg-gray-200 disabled:text-gray-400 text-white rounded-2xl text-sm font-black transition-colors flex items-center justify-center gap-2"
          >
            {submitting ? "Voiding..." : "Confirm Void"}
          </button>
        </div>
      </div>
    </div>
  );
}
