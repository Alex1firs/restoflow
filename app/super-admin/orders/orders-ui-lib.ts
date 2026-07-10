// Pure helpers for the super-admin Live Orders list UI. No React/DOM — unit
// testable with tsx. Keeps querystring/date/format logic out of the component.

export type OrdersUiFilters = {
  restaurantId?: string;
  status?: string;
  paymentStatus?: string;
  paymentMethod?: string;
  fromMs?: number | null;
  toMs?: number | null;
  phone?: string;
  limit?: number;
  cursor?: number | null;
};

/** Build the /api/super-admin/orders querystring, omitting empty values. */
export function buildOrdersQuery(f: OrdersUiFilters): string {
  const p = new URLSearchParams();
  if (f.restaurantId) p.set("restaurantId", f.restaurantId);
  if (f.status) p.set("status", f.status);
  if (f.paymentStatus) p.set("paymentStatus", f.paymentStatus);
  if (f.paymentMethod) p.set("paymentMethod", f.paymentMethod);
  if (f.fromMs != null) p.set("from", String(f.fromMs));
  if (f.toMs != null) p.set("to", String(f.toMs));
  if (f.phone && f.phone.trim()) p.set("phone", f.phone.trim());
  if (f.limit != null) p.set("limit", String(f.limit));
  if (f.cursor != null) p.set("cursor", String(f.cursor));
  return p.toString();
}

/** Convert a yyyy-mm-dd input pair to an inclusive [startMs, endMs] range (UTC). */
export function dayRangeMs(from: string, to: string): { fromMs: number | null; toMs: number | null } {
  const fromMs = from ? Date.parse(`${from}T00:00:00.000Z`) : NaN;
  const toMs = to ? Date.parse(`${to}T23:59:59.999Z`) : NaN;
  return {
    fromMs: Number.isFinite(fromMs) ? fromMs : null,
    toMs: Number.isFinite(toMs) ? toMs : null,
  };
}

/** Client-side exact order-id filter (used for the "Order ID" search mode). */
export function filterRowsByOrderId<T extends { orderId: string }>(rows: T[], id: string): T[] {
  const q = (id ?? "").trim();
  if (!q) return rows;
  return rows.filter((r) => r.orderId === q);
}

/** Naira amount formatting for the table; null → em dash. */
export function formatAmount(total: number | null): string {
  if (total == null) return "—";
  return `₦${total.toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;
}

/** Absolute timestamp label (deterministic from ms; no Date.now in render). */
export function formatWhen(ms: number | null): string {
  if (ms == null) return "—";
  const d = new Date(ms);
  return d.toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" });
}
