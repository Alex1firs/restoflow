// Pure, Firestore-free mapping + filtering for the super-admin "Live Orders"
// view. NO React, NO firebase — unit-testable with tsx. This module NEVER runs
// on a public surface: it is only imported by the super-admin-gated orders API.
// The row DTO intentionally includes the FULL customer phone (super-admin only).

import { normalizePhone } from "../campaigns/logic";

/** Loose shape of a raw Firestore order doc (only fields we read). */
export type RawOrder = Record<string, unknown>;

/** A single super-admin order row. `phone` is the COMPLETE number (super-admin only). */
export type SuperAdminOrderRow = {
  orderId: string;              // canonical, globally-unique key (Firestore doc id)
  orderNumber: number | null;   // per-restaurant counter — NOT globally unique
  restaurantId: string;         // equals the slug
  restaurantSlug: string;       // alias of restaurantId, for clarity
  restaurantName: string | null; // joined from restaurants/{id}.name (never written back)
  customerName: string;
  phone: string;                // FULL phone — super-admin only
  itemsSummary: string;         // "2× Prime Rib, 1× Fries"
  itemsCount: number;
  total: number | null;
  paymentMethod: string;
  paymentStatus: string;
  status: string;
  campaignId: string | null;
  source: "campaign" | null;    // derived: campaign when a campaignId is present
  createdAtMs: number | null;
  updatedAtMs: number | null;   // null when the order has never been updated
};

/** Filters applied server-side (in the gated route) over the fetched page. */
export type OrderFilters = {
  restaurantId?: string;
  status?: string;
  paymentStatus?: string;
  paymentMethod?: string;
  fromMs?: number | null;
  toMs?: number | null;
  phone?: string; // exact, normalized match only
};

/** Coerce Firestore Timestamp | number | {seconds} → millis, else null. */
export function toMillis(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const o = (v ?? {}) as { toMillis?: () => number; seconds?: number; _seconds?: number };
  if (typeof o.toMillis === "function") return o.toMillis();
  if (typeof o.seconds === "number") return o.seconds * 1000;
  if (typeof o._seconds === "number") return o._seconds * 1000;
  return null;
}

/** Safe "qty× name" summary from an order's items array. */
export function itemsSummary(items: unknown): string {
  if (!Array.isArray(items)) return "";
  return items
    .map((it) => {
      const i = (it ?? {}) as { name?: unknown; quantity?: unknown };
      const name = typeof i.name === "string" && i.name.trim() ? i.name.trim() : "item";
      const qty = typeof i.quantity === "number" && Number.isFinite(i.quantity) ? i.quantity : 1;
      return `${qty}× ${name}`;
    })
    .join(", ");
}

function itemsCount(items: unknown): number {
  if (!Array.isArray(items)) return 0;
  return items.reduce((sum, it) => {
    const q = (it as { quantity?: unknown })?.quantity;
    return sum + (typeof q === "number" && Number.isFinite(q) ? q : 1);
  }, 0);
}

/**
 * Map a raw order doc → super-admin row DTO. `orderId` is the canonical key;
 * `restaurantName` is the joined name (or null). Never mutates the source.
 */
export function toOrderRow(orderId: string, data: RawOrder, restaurantName: string | null = null): SuperAdminOrderRow {
  const restaurantId = String(data.restaurantId ?? "");
  const campaignId = typeof data.campaignId === "string" && data.campaignId.trim() ? data.campaignId.trim() : null;
  return {
    orderId,
    orderNumber: typeof data.orderNumber === "number" && Number.isFinite(data.orderNumber) ? data.orderNumber : null,
    restaurantId,
    restaurantSlug: restaurantId,
    restaurantName: restaurantName ?? null,
    customerName: typeof data.customerName === "string" ? data.customerName : "",
    phone: typeof data.phone === "string" ? data.phone : "",
    itemsSummary: itemsSummary(data.items),
    itemsCount: itemsCount(data.items),
    total: typeof data.total === "number" && Number.isFinite(data.total) ? data.total : null,
    paymentMethod: String(data.paymentMethod ?? ""),
    paymentStatus: String(data.paymentStatus ?? ""),
    status: String(data.status ?? ""),
    campaignId,
    source: campaignId ? "campaign" : null,
    createdAtMs: toMillis(data.createdAt),
    updatedAtMs: toMillis(data.updatedAt),
  };
}

// ── Detail view (Slice 3) ─────────────────────────────────────────────────

export type OrderLineItem = { name: string; quantity: number; unitPrice: number | null; lineTotal: number | null };
export type TimelineEvent = { key: string; label: string; atMs: number };

/** Full super-admin order detail: the row + line items, totals, fulfilment, a
 *  joined campaign summary, and a derived timeline. `phone` is the full number. */
export type SuperAdminOrderDetail = SuperAdminOrderRow & {
  address: string;
  note: string;
  deliveryType: string;
  serviceMode: string | null;
  tableLabel: string | null;
  deliveryZoneName: string | null;
  orderType: string | null;
  scheduledFor: string | null;
  paymentReference: string | null;
  items: OrderLineItem[];
  itemsTotal: number | null;
  deliveryFee: number | null;
  campaign: { id: string; name: string; threshold: number } | null;
  timeline: TimelineEvent[];
};

function str(v: unknown): string { return typeof v === "string" ? v : ""; }
function strOrNull(v: unknown): string | null { const s = typeof v === "string" ? v.trim() : ""; return s ? s : null; }
function numOrNull(v: unknown): number | null { return typeof v === "number" && Number.isFinite(v) ? v : null; }

/** Map order items into per-line rows with unit price and line total. */
export function toLineItems(items: unknown): OrderLineItem[] {
  if (!Array.isArray(items)) return [];
  return items.map((it) => {
    const i = (it ?? {}) as { name?: unknown; quantity?: unknown; price?: unknown };
    const quantity = typeof i.quantity === "number" && Number.isFinite(i.quantity) ? i.quantity : 1;
    const unitPrice = typeof i.price === "number" && Number.isFinite(i.price) ? i.price : null;
    const name = typeof i.name === "string" && i.name.trim() ? i.name.trim() : "item";
    return { name, quantity, unitPrice, lineTotal: unitPrice != null ? unitPrice * quantity : null };
  });
}

/** Derive an ordered lifecycle timeline from whatever status timestamps exist. */
export function buildTimeline(data: RawOrder): TimelineEvent[] {
  const defs: Array<[string, string]> = [
    ["createdAt", "Order placed"],
    ["preparingAt", "Marked preparing"],
    ["readyAt", "Marked ready"],
    ["completedAt", "Completed"],
    ["rejectedAt", "Rejected"],
  ];
  const out: TimelineEvent[] = [];
  for (const [key, label] of defs) {
    const ms = toMillis(data[key]);
    if (ms != null) out.push({ key, label, atMs: ms });
  }
  out.sort((a, b) => a.atMs - b.atMs);
  return out;
}

/** Map a raw order doc → full super-admin detail DTO (optionally with a joined campaign). */
export function toOrderDetail(
  orderId: string,
  data: RawOrder,
  restaurantName: string | null = null,
  campaign: { id: string; name: string; rule: { threshold: number } } | null = null,
): SuperAdminOrderDetail {
  const row = toOrderRow(orderId, data, restaurantName);
  return {
    ...row,
    address: str(data.address),
    note: str(data.note),
    deliveryType: str(data.deliveryType),
    serviceMode: strOrNull(data.serviceMode),
    tableLabel: strOrNull(data.tableLabel),
    deliveryZoneName: strOrNull(data.deliveryZoneName),
    orderType: strOrNull(data.orderType),
    scheduledFor: strOrNull(data.scheduledFor),
    paymentReference: strOrNull(data.paymentReference),
    items: toLineItems(data.items),
    itemsTotal: numOrNull(data.itemsTotal),
    deliveryFee: numOrNull(data.deliveryFee),
    campaign: campaign ? { id: campaign.id, name: campaign.name, threshold: campaign.rule.threshold } : null,
    timeline: buildTimeline(data),
  };
}

/** True when a row passes all provided filters. Phone uses exact normalized match. */
export function orderMatchesFilters(row: SuperAdminOrderRow, f: OrderFilters): boolean {
  if (f.restaurantId && row.restaurantId !== f.restaurantId) return false;
  if (f.status && row.status !== f.status) return false;
  if (f.paymentStatus && row.paymentStatus !== f.paymentStatus) return false;
  if (f.paymentMethod && row.paymentMethod !== f.paymentMethod) return false;
  if (f.fromMs != null && (row.createdAtMs == null || row.createdAtMs < f.fromMs)) return false;
  if (f.toMs != null && (row.createdAtMs == null || row.createdAtMs > f.toMs)) return false;
  if (f.phone && f.phone.trim()) {
    const target = normalizePhone(f.phone);
    if (!target || normalizePhone(row.phone) !== target) return false;
  }
  return true;
}
