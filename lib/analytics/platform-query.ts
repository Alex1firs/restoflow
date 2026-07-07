import "server-only";
import { getAdminDb } from "@/lib/firebase-admin";
import {
  resolveAnalyticsRange,
  mergeDailyDocs,
  computeConversions,
  computeAbandonedCheckout,
  restaurantStatusLabel,
  buildPlatformInsights,
  type DailyDoc,
  type PlatformRow,
} from "./insights";

// Server-only, SUPER-ADMIN-ONLY cross-tenant analytics. Reads every restaurant's
// daily rollups + orders. Guarded upstream by getSuperAdminUser in the route.
//
// Behaviour/funnel numbers come from storefront_stats_daily; completed orders and
// revenue come from the `orders` collection (source of truth). No PII.

const STATS_COLLECTION = "storefront_stats_daily";

function toMs(v: unknown): number | null {
  if (!v || typeof v !== "object") return null;
  const o = v as { toDate?: () => Date; seconds?: number; _seconds?: number };
  if (typeof o.toDate === "function") return o.toDate().getTime();
  if (typeof o.seconds === "number") return o.seconds * 1000;
  if (typeof o._seconds === "number") return o._seconds * 1000;
  return null;
}

export async function getPlatformAnalytics(range: string, fromStr?: string, toStr?: string) {
  const r = resolveAnalyticsRange(range, new Date(), fromStr, toStr);
  const db = getAdminDb();

  // 1) All daily rollups in range (single-field `date` index), grouped by slug.
  const statsSnap = await db
    .collection(STATS_COLLECTION)
    .where("date", ">=", r.startKey)
    .where("date", "<=", r.endKey)
    .get();

  const perSlugDocs = new Map<string, DailyDoc[]>();
  const allDocs: DailyDoc[] = [];
  statsSnap.forEach((doc) => {
    const d = doc.data() as DailyDoc & { slug?: string };
    allDocs.push(d);
    const s = d.slug;
    if (!s) return;
    const list = perSlugDocs.get(s);
    if (list) list.push(d);
    else perSlugDocs.set(s, [d]);
  });

  // 2) All orders in range (single-field `createdAt` index), grouped by restaurant.
  const ordersSnap = await db
    .collection("orders")
    .where("createdAt", ">=", r.startInstant)
    .where("createdAt", "<=", r.endInstant)
    .orderBy("createdAt", "desc")
    .get();

  const perSlugOrders = new Map<string, { completed: number; revenue: number }>();
  let totalCompletedOrders = 0;
  let totalRevenue = 0;
  ordersSnap.forEach((doc) => {
    const d = doc.data();
    if (!(d.paymentStatus === "paid" && d.status !== "rejected")) return;
    const s = d.restaurantId as string;
    if (!s) return;
    const cur = perSlugOrders.get(s) ?? { completed: 0, revenue: 0 };
    cur.completed += 1;
    cur.revenue += (d.total as number) ?? 0;
    perSlugOrders.set(s, cur);
    totalCompletedOrders += 1;
    totalRevenue += (d.total as number) ?? 0;
  });

  // 3) All restaurants → one row each (so "no activity" restaurants surface too).
  const restSnap = await db.collection("restaurants").get();
  const now = Date.now();
  const rows: PlatformRow[] = [];

  restSnap.forEach((doc) => {
    const slug = doc.id;
    const d = doc.data();
    const name = (d.name as string) ?? slug;

    // Subscription status — same derivation as the Subscriptions/Overview pages.
    let subscriptionStatus = (d.subscriptionStatus as string) ?? "trialing";
    const endMs = toMs(d.subscriptionEndDate);
    if (subscriptionStatus !== "suspended" && endMs && endMs < now) subscriptionStatus = "expired";

    const agg = mergeDailyDocs(perSlugDocs.get(slug) ?? []);
    const c = agg.counters;
    const ord = perSlugOrders.get(slug) ?? { completed: 0, revenue: 0 };
    const abandonedCheckout = computeAbandonedCheckout(c);
    const conversionRate = c.visits > 0 ? c.order_submitted / c.visits : 0;

    const base = {
      visits: c.visits,
      orderSubmitted: c.order_submitted,
      completedOrders: ord.completed,
      checkoutStarted: c.checkout_started,
      abandonedCheckout,
      paymentFailed: c.payment_failed,
      conversionRate,
    };

    rows.push({
      slug,
      name,
      subscriptionStatus,
      visits: c.visits,
      addToCart: c.add_to_cart,
      checkoutStarted: c.checkout_started,
      orderSubmitted: c.order_submitted,
      paymentFailed: c.payment_failed,
      completedOrders: ord.completed,
      revenue: ord.revenue,
      abandonedCheckout,
      conversionRate,
      statusLabel: restaurantStatusLabel(base),
    });
  });

  rows.sort((a, b) => b.revenue - a.revenue || b.visits - a.visits || a.name.localeCompare(b.name));

  // 4) Platform totals.
  const totals = mergeDailyDocs(allDocs);
  const totalEvents = Object.values(totals.counters).reduce((a, b) => a + b, 0);

  return {
    range: { key: range, from: r.startKey, to: r.endKey },
    totals: {
      funnel: totals.counters,
      abandonedCheckout: computeAbandonedCheckout(totals.counters),
      conversions: computeConversions(totals.counters),
      completedOrders: totalCompletedOrders,
      revenue: totalRevenue,
    },
    restaurants: rows,
    insights: buildPlatformInsights(rows),
    hasData: totalEvents > 0 || totalCompletedOrders > 0,
  };
}
