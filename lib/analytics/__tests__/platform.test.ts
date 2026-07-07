// Unit tests for the pure platform (super-admin) insight logic.
// Run: npx tsx lib/analytics/__tests__/platform.test.ts

import assert from "node:assert/strict";
import { restaurantStatusLabel, buildPlatformInsights, type PlatformRow } from "../insights";

let passed = 0;
function test(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }

function row(p: Partial<PlatformRow>): PlatformRow {
  return {
    slug: p.slug ?? "r", name: p.name ?? "R", subscriptionStatus: p.subscriptionStatus ?? "active",
    visits: p.visits ?? 0, addToCart: p.addToCart ?? 0, checkoutStarted: p.checkoutStarted ?? 0,
    orderSubmitted: p.orderSubmitted ?? 0, paymentFailed: p.paymentFailed ?? 0,
    completedOrders: p.completedOrders ?? 0, revenue: p.revenue ?? 0,
    abandonedCheckout: p.abandonedCheckout ?? 0, conversionRate: p.conversionRate ?? 0,
    statusLabel: "",
  };
}

console.log("platform: status label");

test("no activity → 'No activity'", () => {
  assert.equal(restaurantStatusLabel({ visits: 0, orderSubmitted: 0, completedOrders: 0, checkoutStarted: 0, abandonedCheckout: 0, paymentFailed: 0, conversionRate: 0 }), "No activity");
});
test("visits but no orders → 'Visits, no orders'", () => {
  assert.equal(restaurantStatusLabel({ visits: 30, orderSubmitted: 2, completedOrders: 0, checkoutStarted: 1, abandonedCheckout: 1, paymentFailed: 0, conversionRate: 0 }), "Visits, no orders");
});
test("payment failures outrank abandonment", () => {
  assert.equal(restaurantStatusLabel({ visits: 50, orderSubmitted: 20, completedOrders: 10, checkoutStarted: 20, abandonedCheckout: 15, paymentFailed: 5, conversionRate: 0.4 }), "Payment failures");
});
test("high abandonment label", () => {
  assert.equal(restaurantStatusLabel({ visits: 50, orderSubmitted: 12, completedOrders: 8, checkoutStarted: 20, abandonedCheckout: 12, paymentFailed: 0, conversionRate: 0.24 }), "High abandonment");
});
test("strong label", () => {
  assert.equal(restaurantStatusLabel({ visits: 100, orderSubmitted: 20, completedOrders: 18, checkoutStarted: 25, abandonedCheckout: 5, paymentFailed: 0, conversionRate: 0.2 }), "Strong");
});

console.log("platform: insight buckets");

test("best performing sorted by revenue desc, orders>0 only", () => {
  const rows = [
    row({ slug: "a", revenue: 5000, completedOrders: 3 }),
    row({ slug: "b", revenue: 12000, completedOrders: 6 }),
    row({ slug: "c", revenue: 0, completedOrders: 0 }),
  ];
  const ins = buildPlatformInsights(rows);
  assert.deepEqual(ins.bestPerforming.map((r) => r.slug), ["b", "a"]);
});

test("visits but no orders bucket", () => {
  const ins = buildPlatformInsights([
    row({ slug: "a", visits: 40, completedOrders: 0 }),
    row({ slug: "b", visits: 40, completedOrders: 3 }),
    row({ slug: "c", visits: 5, completedOrders: 0 }),
  ]);
  assert.deepEqual(ins.visitsButNoOrders.map((r) => r.slug), ["a"]);
});

test("high abandonment bucket (>50% of checkouts)", () => {
  const ins = buildPlatformInsights([
    row({ slug: "a", checkoutStarted: 20, abandonedCheckout: 12 }),
    row({ slug: "b", checkoutStarted: 20, abandonedCheckout: 8 }),
    row({ slug: "c", checkoutStarted: 5, abandonedCheckout: 5 }),
  ]);
  assert.deepEqual(ins.highAbandonment.map((r) => r.slug), ["a"]);
});

test("payment failures bucket (>=3)", () => {
  const ins = buildPlatformInsights([row({ slug: "a", paymentFailed: 4 }), row({ slug: "b", paymentFailed: 2 })]);
  assert.deepEqual(ins.paymentFailures.map((r) => r.slug), ["a"]);
});

test("subscribed-but-not-converting (active + visits>=20 + 0 orders)", () => {
  const ins = buildPlatformInsights([
    row({ slug: "a", subscriptionStatus: "active", visits: 30, completedOrders: 0 }),
    row({ slug: "b", subscriptionStatus: "expired", visits: 30, completedOrders: 0 }),
    row({ slug: "c", subscriptionStatus: "active", visits: 30, completedOrders: 2 }),
  ]);
  assert.deepEqual(ins.subscribedPoorPerformance.map((r) => r.slug), ["a"]);
});

test("expired/suspended with activity", () => {
  const ins = buildPlatformInsights([
    row({ slug: "a", subscriptionStatus: "expired", visits: 12 }),
    row({ slug: "b", subscriptionStatus: "suspended", completedOrders: 2 }),
    row({ slug: "c", subscriptionStatus: "expired", visits: 0, completedOrders: 0 }),
    row({ slug: "d", subscriptionStatus: "active", visits: 50 }),
  ]);
  assert.deepEqual(ins.expiredWithActivity.map((r) => r.slug).sort(), ["a", "b"]);
});

test("no activity bucket", () => {
  const ins = buildPlatformInsights([
    row({ slug: "a" }),
    row({ slug: "b", visits: 3 }),
  ]);
  assert.deepEqual(ins.noActivity.map((r) => r.slug), ["a"]);
});

console.log(`\n${passed} checks passed`);
