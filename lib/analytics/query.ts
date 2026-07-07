import "server-only";
import { getAdminDb } from "@/lib/firebase-admin";
import {
  resolveAnalyticsRange,
  mergeDailyDocs,
  computeConversions,
  computeAbandonedCheckout,
  topItems,
  buildRecommendations,
  type DailyDoc,
  type ItemStat,
} from "./insights";

// Server-only read layer for the RESTAURANT-scoped analytics dashboard. The slug
// is always supplied by the authenticated session (never the client), so this
// function can only ever read one restaurant's data.
//
// Funnel/behaviour numbers come from storefront_stats_daily. Completed orders and
// revenue come from the `orders` collection (source of truth) — never from events.

const STATS_COLLECTION = "storefront_stats_daily";

export type RestaurantAnalytics = Awaited<ReturnType<typeof getRestaurantAnalytics>>;

export async function getRestaurantAnalytics(
  slug: string,
  range: string,
  fromStr?: string,
  toStr?: string
) {
  const r = resolveAnalyticsRange(range, new Date(), fromStr, toStr);
  const db = getAdminDb();

  // 1) Daily funnel rollups — read by computed doc id (no composite index needed).
  const refs = r.dateKeys.map((k) => db.collection(STATS_COLLECTION).doc(`${slug}__${k}`));
  const snaps = refs.length ? await db.getAll(...refs) : [];
  const dailyDocs: DailyDoc[] = snaps.filter((s) => s.exists).map((s) => s.data() as DailyDoc);
  const agg = mergeDailyDocs(dailyDocs);

  // 2) Orders = source of truth for completed orders + revenue (+ per-item orders).
  // Same equality+range shape as the Reports route, so it reuses that index.
  const ordersSnap = await db
    .collection("orders")
    .where("restaurantId", "==", slug)
    .where("createdAt", ">=", r.startInstant)
    .where("createdAt", "<=", r.endInstant)
    .orderBy("createdAt", "desc")
    .get();

  let completedOrders = 0;
  let revenue = 0;
  const orderedCounts: Record<string, number> = {};
  for (const doc of ordersSnap.docs) {
    const d = doc.data();
    const isRevenue = d.paymentStatus === "paid" && d.status !== "rejected";
    if (!isRevenue) continue;
    completedOrders += 1;
    revenue += (d.total as number) ?? 0;
    for (const it of (d.items as { id: string; quantity: number }[]) ?? []) {
      if (it?.id) orderedCounts[it.id] = (orderedCounts[it.id] ?? 0) + (it.quantity ?? 0);
    }
  }

  // 3) Menu item names for the top-item lists (no PII).
  const menuSnap = await db.collection("menu_items").where("restaurantId", "==", slug).get();
  const names: Record<string, string> = {};
  menuSnap.forEach((doc) => { names[doc.id] = (doc.data().name as string) ?? "Item"; });

  const topViewed = topItems(agg.itemViews, names, 5);
  const topAdded = topItems(agg.itemAdds, names, 5);

  const itemStats: ItemStat[] = topViewed.map((t) => ({
    id: t.id,
    name: t.name,
    views: t.count,
    ordered: orderedCounts[t.id] ?? 0,
  }));

  const totalEvents = Object.values(agg.counters).reduce((a, b) => a + b, 0);

  return {
    range: { key: range, from: r.startKey, to: r.endKey },
    funnel: agg.counters,
    abandonedCheckout: computeAbandonedCheckout(agg.counters),
    conversions: computeConversions(agg.counters),
    fulfillmentBreakdown: agg.fulfillmentCounts,
    paymentMethodBreakdown: agg.methodCounts,
    topViewed,
    topAdded,
    orders: { completedOrders, revenue },
    recommendations: buildRecommendations(agg.counters, itemStats),
    hasData: totalEvents > 0 || completedOrders > 0,
  };
}
