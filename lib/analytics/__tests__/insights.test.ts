// Unit tests for the pure analytics insight logic (range, merge, conversions,
// recommendations). Run: npx tsx lib/analytics/__tests__/insights.test.ts

import assert from "node:assert/strict";
import {
  resolveAnalyticsRange,
  mergeDailyDocs,
  computeConversions,
  computeAbandonedCheckout,
  topItems,
  buildRecommendations,
  lagosKeyFromInstant,
  type DailyDoc,
} from "../insights";

let passed = 0;
function test(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }

console.log("analytics: range resolution");

test("today → single Lagos day key", () => {
  const now = new Date("2026-07-07T09:00:00Z"); // 10:00 Lagos
  const r = resolveAnalyticsRange("today", now);
  assert.deepEqual(r.dateKeys, ["2026-07-07"]);
  assert.equal(r.startKey, "2026-07-07");
  assert.equal(r.endKey, "2026-07-07");
});

test("Lagos day rolls over at UTC+1 (23:30 UTC is already next Lagos day)", () => {
  // 2026-07-07T23:30Z == 2026-07-08 00:30 Lagos
  assert.equal(lagosKeyFromInstant(new Date("2026-07-07T23:30:00Z")), "2026-07-08");
  assert.equal(lagosKeyFromInstant(new Date("2026-07-07T22:30:00Z")), "2026-07-07");
});

test("week → 7 consecutive day keys ending today", () => {
  const r = resolveAnalyticsRange("week", new Date("2026-07-07T09:00:00Z"));
  assert.equal(r.dateKeys.length, 7);
  assert.equal(r.dateKeys[0], "2026-07-01");
  assert.equal(r.dateKeys[6], "2026-07-07");
});

test("month → 1st of Lagos month to today", () => {
  const r = resolveAnalyticsRange("month", new Date("2026-07-07T09:00:00Z"));
  assert.equal(r.startKey, "2026-07-01");
  assert.equal(r.endKey, "2026-07-07");
  assert.equal(r.dateKeys.length, 7);
});

test("custom range enumerates inclusive keys; orders window spans full days", () => {
  const r = resolveAnalyticsRange("custom", new Date("2026-07-07T09:00:00Z"), "2026-06-29", "2026-07-01");
  assert.deepEqual(r.dateKeys, ["2026-06-29", "2026-06-30", "2026-07-01"]);
  // start = Lagos midnight of 06-29 = 23:00Z on 06-28
  assert.equal(r.startInstant.toISOString(), "2026-06-28T23:00:00.000Z");
  // end = last ms of Lagos 07-01 = 22:59:59.999Z on 07-01
  assert.equal(r.endInstant.toISOString(), "2026-07-01T22:59:59.999Z");
});

test("invalid custom range throws", () => {
  const now = new Date("2026-07-07T09:00:00Z");
  assert.throws(() => resolveAnalyticsRange("custom", now, "2026-07-05", "2026-07-01")); // from>to
  assert.throws(() => resolveAnalyticsRange("custom", now, "bad", "2026-07-01"));
  assert.throws(() => resolveAnalyticsRange("bogus", now));
});

console.log("analytics: aggregation & conversions");

test("mergeDailyDocs sums counters and merges maps", () => {
  const docs: DailyDoc[] = [
    { visits: 10, add_to_cart: 3, itemViews: { a: 5 }, itemAdds: { a: 2 }, fulfillmentCounts: { delivery: 4 }, methodCounts: { online: 3 } },
    { visits: 5, add_to_cart: 2, itemViews: { a: 1, b: 4 }, methodCounts: { online: 1, cash: 2 } },
  ];
  const agg = mergeDailyDocs(docs);
  assert.equal(agg.counters.visits, 15);
  assert.equal(agg.counters.add_to_cart, 5);
  assert.equal(agg.counters.payment_successful, 0); // absent → 0
  assert.deepEqual(agg.itemViews, { a: 6, b: 4 });
  assert.deepEqual(agg.itemAdds, { a: 2 });
  assert.deepEqual(agg.fulfillmentCounts, { delivery: 4 });
  assert.deepEqual(agg.methodCounts, { online: 4, cash: 2 });
});

test("conversions compute ratios and guard divide-by-zero", () => {
  const c = { visits: 100, add_to_cart: 40, checkout_started: 20, order_submitted: 10, payment_successful: 8 };
  const conv = computeConversions(c);
  assert.equal(conv.visitToAddToCart, 0.4);
  assert.equal(conv.addToCartToCheckout, 0.5);
  assert.equal(conv.checkoutToOrder, 0.5);
  assert.equal(conv.orderToPaymentSuccess, 0.8);
  assert.equal(computeConversions({}).visitToAddToCart, 0); // no divide-by-zero
});

test("abandoned checkout = checkout_started - order_submitted (never negative)", () => {
  assert.equal(computeAbandonedCheckout({ checkout_started: 20, order_submitted: 13 }), 7);
  assert.equal(computeAbandonedCheckout({ checkout_started: 3, order_submitted: 9 }), 0);
});

test("topItems ranks, maps names, marks removed items", () => {
  const top = topItems({ a: 5, b: 9, c: 0 }, { a: "Jollof", b: "Suya" }, 5);
  assert.deepEqual(top, [
    { id: "b", name: "Suya", count: 9 },
    { id: "a", name: "Jollof", count: 5 },
  ]);
  assert.equal(topItems({ x: 3 }, {}, 5)[0].name, "Removed item");
});

console.log("analytics: recommendations");

test("high visits / low add-to-cart → warn", () => {
  const recs = buildRecommendations({ visits: 100, add_to_cart: 5 }, []);
  assert.ok(recs.some((r) => r.id === "low-add-to-cart" && r.severity === "warn"));
});

test("high checkout / low submit → checkout friction warn", () => {
  const recs = buildRecommendations({ checkout_started: 20, order_submitted: 4 }, []);
  assert.ok(recs.some((r) => r.id === "checkout-friction"));
});

test("high add-to-cart / low checkout → clarity warn", () => {
  const recs = buildRecommendations({ add_to_cart: 40, checkout_started: 5 }, []);
  assert.ok(recs.some((r) => r.id === "cart-to-checkout-drop"));
});

test("high payment failure → payment warn", () => {
  const recs = buildRecommendations({ payment_initialized: 10, payment_failed: 4 }, []);
  assert.ok(recs.some((r) => r.id === "payment-failures"));
});

test("item with many views but no orders → item warn (capped at 2)", () => {
  const recs = buildRecommendations({ visits: 5 }, [
    { id: "a", name: "Salad", views: 20, ordered: 0 },
    { id: "b", name: "Wrap", views: 18, ordered: 0 },
    { id: "c", name: "Soup", views: 16, ordered: 0 },
  ]);
  const itemRecs = recs.filter((r) => r.id.startsWith("item-views-no-orders"));
  assert.equal(itemRecs.length, 2);
});

test("healthy funnel → single positive info card when nothing wrong", () => {
  const recs = buildRecommendations({ visits: 50, add_to_cart: 30, checkout_started: 20, order_submitted: 18 }, []);
  assert.deepEqual(recs.map((r) => r.id), ["healthy"]);
  assert.equal(recs[0].severity, "info");
});

test("no data → no recommendations at all", () => {
  assert.deepEqual(buildRecommendations({}, []), []);
});

console.log(`\n${passed} checks passed`);
