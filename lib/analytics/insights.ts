// Pure analytics aggregation + insight logic (no firebase / no server-only) so
// it is fully unit-testable. Consumes daily rollup docs and produces the numbers
// and rule-based recommendations the restaurant dashboard renders.

import { COUNTER_FIELDS } from "./events";

// Nigeria (Africa/Lagos) is UTC+1 with no DST, so a fixed offset is exact.
const LAGOS_OFFSET_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 366;

export type Counters = Record<string, number>;

export type AggregatedStats = {
  counters: Counters;
  itemViews: Record<string, number>;
  itemAdds: Record<string, number>;
  fulfillmentCounts: Record<string, number>;
  methodCounts: Record<string, number>;
};

export type DailyDoc = Partial<AggregatedStats> & Record<string, unknown>;

export type ResolvedRange = {
  dateKeys: string[];
  startKey: string;
  endKey: string;
  startInstant: Date;
  endInstant: Date;
};

// ── Lagos day helpers ─────────────────────────────────────────────────────────
export function lagosKeyFromInstant(d: Date): string {
  const s = new Date(d.getTime() + LAGOS_OFFSET_MS);
  const y = s.getUTCFullYear();
  const m = String(s.getUTCMonth() + 1).padStart(2, "0");
  const day = String(s.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function lagosDayStartInstant(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  // Lagos 00:00 == UTC 23:00 the previous day.
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - LAGOS_OFFSET_MS);
}

const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Resolve a range preset into Lagos day keys (for daily-rollup doc ids) plus the
 * matching UTC instant window (for the orders query). Pure; `now` is injected.
 */
export function resolveAnalyticsRange(
  range: string,
  now: Date,
  fromStr?: string,
  toStr?: string
): ResolvedRange {
  const endKeyToday = lagosKeyFromInstant(now);
  let startKey: string;
  let endKey: string = endKeyToday;

  switch (range) {
    case "today":
      startKey = endKeyToday;
      break;
    case "week":
      startKey = lagosKeyFromInstant(new Date(lagosDayStartInstant(endKeyToday).getTime() - 6 * DAY_MS));
      break;
    case "month":
      startKey = `${endKeyToday.slice(0, 8)}01`;
      break;
    case "custom":
      if (!fromStr || !toStr || !KEY_RE.test(fromStr) || !KEY_RE.test(toStr) || fromStr > toStr) {
        throw new Error("Invalid custom range");
      }
      startKey = fromStr;
      endKey = toStr;
      break;
    default:
      throw new Error("Invalid range");
  }

  const startInstant = lagosDayStartInstant(startKey);
  const endInstant = new Date(lagosDayStartInstant(endKey).getTime() + DAY_MS - 1);

  const dateKeys: string[] = [];
  const endStart = lagosDayStartInstant(endKey).getTime();
  for (let t = lagosDayStartInstant(startKey).getTime(); t <= endStart; t += DAY_MS) {
    dateKeys.push(lagosKeyFromInstant(new Date(t)));
    if (dateKeys.length >= MAX_RANGE_DAYS) break;
  }

  return { dateKeys, startKey, endKey, startInstant, endInstant };
}

// ── Aggregation ────────────────────────────────────────────────────────────────
function addInto(target: Record<string, number>, src: unknown): void {
  if (!src || typeof src !== "object") return;
  for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v)) target[k] = (target[k] ?? 0) + v;
  }
}

/** Merge a set of daily rollup docs into a single aggregate. */
export function mergeDailyDocs(docs: DailyDoc[]): AggregatedStats {
  const counters: Counters = {};
  for (const f of COUNTER_FIELDS) counters[f] = 0;
  const itemViews: Record<string, number> = {};
  const itemAdds: Record<string, number> = {};
  const fulfillmentCounts: Record<string, number> = {};
  const methodCounts: Record<string, number> = {};

  for (const doc of docs) {
    for (const f of COUNTER_FIELDS) {
      const v = doc[f];
      if (typeof v === "number" && Number.isFinite(v)) counters[f] += v;
    }
    addInto(itemViews, doc.itemViews);
    addInto(itemAdds, doc.itemAdds);
    addInto(fulfillmentCounts, doc.fulfillmentCounts);
    addInto(methodCounts, doc.methodCounts);
  }
  return { counters, itemViews, itemAdds, fulfillmentCounts, methodCounts };
}

const ratio = (a: number, b: number): number => (b > 0 ? a / b : 0);

export type Conversions = {
  visitToAddToCart: number;
  addToCartToCheckout: number;
  checkoutToOrder: number;
  orderToPaymentSuccess: number;
};

export function computeConversions(c: Counters): Conversions {
  return {
    visitToAddToCart: ratio(c.add_to_cart ?? 0, c.visits ?? 0),
    addToCartToCheckout: ratio(c.checkout_started ?? 0, c.add_to_cart ?? 0),
    checkoutToOrder: ratio(c.order_submitted ?? 0, c.checkout_started ?? 0),
    // "where applicable" — payment_successful only exists for online orders.
    orderToPaymentSuccess: ratio(c.payment_successful ?? 0, c.order_submitted ?? 0),
  };
}

export function computeAbandonedCheckout(c: Counters): number {
  return Math.max(0, (c.checkout_started ?? 0) - (c.order_submitted ?? 0));
}

export type RankedItem = { id: string; name: string; count: number };

export function topItems(
  map: Record<string, number>,
  names: Record<string, string>,
  n = 5
): RankedItem[] {
  return Object.entries(map)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([id, count]) => ({ id, name: names[id] ?? "Removed item", count }));
}

// ── Rule-based recommendations ──────────────────────────────────────────────────
export type Recommendation = { id: string; severity: "info" | "warn"; title: string; detail: string };

export type ItemStat = { id: string; name: string; views: number; ordered: number };

export function buildRecommendations(c: Counters, itemStats: ItemStat[]): Recommendation[] {
  const recs: Recommendation[] = [];
  const visits = c.visits ?? 0;
  const adds = c.add_to_cart ?? 0;
  const checkouts = c.checkout_started ?? 0;
  const submitted = c.order_submitted ?? 0;
  const initialized = c.payment_initialized ?? 0;
  const failed = c.payment_failed ?? 0;

  if (visits >= 20 && ratio(adds, visits) < 0.15) {
    recs.push({
      id: "low-add-to-cart",
      severity: "warn",
      title: "Lots of visits, few add-to-carts",
      detail: "Customers are viewing but not adding items. Improve your food photos and menu descriptions to boost appeal.",
    });
  }
  if (adds >= 15 && ratio(checkouts, adds) < 0.3) {
    recs.push({
      id: "cart-to-checkout-drop",
      severity: "warn",
      title: "Carts aren't turning into checkouts",
      detail: "Many customers add items but don't start checkout. Make delivery options and payment methods clearer.",
    });
  }
  if (checkouts >= 10 && ratio(submitted, checkouts) < 0.5) {
    recs.push({
      id: "checkout-friction",
      severity: "warn",
      title: "Checkout drop-off is high",
      detail: "Customers start checkout but don't complete it. Reduce required fields and simplify the checkout flow.",
    });
  }
  if (initialized >= 5 && ratio(failed, initialized) > 0.2) {
    recs.push({
      id: "payment-failures",
      severity: "warn",
      title: "Payments are failing often",
      detail: "A high share of online payments fail. Check your payment gateway setup and reassure customers it's secure.",
    });
  }
  for (const it of itemStats) {
    if (it.views >= 15 && it.ordered === 0) {
      recs.push({
        id: `item-views-no-orders:${it.id}`,
        severity: "warn",
        title: `"${it.name}" gets views but no orders`,
        detail: "This item is popular to look at but nobody orders it. Review its price, photo, and description.",
      });
      if (recs.filter((r) => r.id.startsWith("item-views-no-orders")).length >= 2) break;
    }
  }

  if (recs.length === 0 && visits > 0) {
    recs.push({
      id: "healthy",
      severity: "info",
      title: "Your storefront funnel looks healthy",
      detail: "No major drop-offs detected in this period. Keep sharing your storefront link to grow visits.",
    });
  }
  return recs;
}

// ── Platform (super-admin) analytics ────────────────────────────────────────────
export type PlatformRow = {
  slug: string;
  name: string;
  subscriptionStatus: string;
  visits: number;
  addToCart: number;
  checkoutStarted: number;
  orderSubmitted: number;
  paymentFailed: number;
  completedOrders: number;
  revenue: number;
  abandonedCheckout: number;
  conversionRate: number; // orderSubmitted / visits
  statusLabel: string;
};

/** Single primary label for the per-restaurant table (most-severe first). */
export function restaurantStatusLabel(r: {
  visits: number; orderSubmitted: number; completedOrders: number;
  checkoutStarted: number; abandonedCheckout: number; paymentFailed: number; conversionRate: number;
}): string {
  if (r.visits === 0 && r.orderSubmitted === 0 && r.completedOrders === 0) return "No activity";
  if (r.visits >= 10 && r.completedOrders === 0) return "Visits, no orders";
  if (r.paymentFailed >= 3) return "Payment failures";
  if (r.checkoutStarted >= 10 && ratio(r.abandonedCheckout, r.checkoutStarted) > 0.5) return "High abandonment";
  if (r.orderSubmitted >= 5 && r.conversionRate >= 0.1) return "Strong";
  return "OK";
}

export type PlatformInsights = {
  bestPerforming: PlatformRow[];
  visitsButNoOrders: PlatformRow[];
  highAbandonment: PlatformRow[];
  paymentFailures: PlatformRow[];
  strongConversion: PlatformRow[];
  noActivity: PlatformRow[];
  subscribedPoorPerformance: PlatformRow[];
  expiredWithActivity: PlatformRow[];
};

const isActiveSub = (s: string) => s === "active" || s === "trialing";
const isInactiveSub = (s: string) => s === "expired" || s === "suspended";

/** Bucket restaurants into attention/insight groups for the super-admin view. */
export function buildPlatformInsights(rows: PlatformRow[]): PlatformInsights {
  return {
    bestPerforming: rows
      .filter((r) => r.completedOrders > 0)
      .sort((a, b) => b.revenue - a.revenue || b.completedOrders - a.completedOrders)
      .slice(0, 5),
    visitsButNoOrders: rows.filter((r) => r.visits >= 10 && r.completedOrders === 0),
    highAbandonment: rows.filter((r) => r.checkoutStarted >= 10 && ratio(r.abandonedCheckout, r.checkoutStarted) > 0.5),
    paymentFailures: rows.filter((r) => r.paymentFailed >= 3),
    strongConversion: rows
      .filter((r) => r.orderSubmitted >= 5 && r.conversionRate >= 0.1)
      .sort((a, b) => b.conversionRate - a.conversionRate),
    noActivity: rows.filter((r) => r.visits === 0 && r.orderSubmitted === 0 && r.completedOrders === 0),
    subscribedPoorPerformance: rows.filter((r) => isActiveSub(r.subscriptionStatus) && r.visits >= 20 && r.completedOrders === 0),
    expiredWithActivity: rows.filter((r) => isInactiveSub(r.subscriptionStatus) && (r.visits > 0 || r.completedOrders > 0)),
  };
}
