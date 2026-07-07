// Integration-style tests for the popularity recompute job against a fake store.
// Run: npx tsx lib/discovery/__tests__/popularity-job.test.ts

import assert from "node:assert/strict";
import { recomputePopularity } from "../popularity-job";
import type { DiscoveryStore } from "../store";
import type { PopularityOrder, PopularityUpdate } from "../popularity";
import { NEUTRAL_POPULARITY } from "../types";

let passed = 0;
const test = (name: string, fn: () => Promise<void>) => fn().then(() => { passed++; console.log(`  ✓ ${name}`); });

const NOW = 1_760_000_000_000;
const DAY = 86_400_000;

// Minimal fake: serves orders + discovery ids, captures popularity writes.
class Fake implements DiscoveryStore {
  orders: PopularityOrder[] = [];
  dishIds: string[] = [];
  slugs: string[] = [];
  sinceMsSeen = -1;
  dishWrites = new Map<string, PopularityUpdate>();
  restWrites = new Map<string, PopularityUpdate>();

  // popularity surface
  async getRecentOrders(sinceMs: number) { this.sinceMsSeen = sinceMs; return this.orders; }
  async listDiscoveryDishIds() { return this.dishIds; }
  async listDiscoveryRestaurantSlugs() { return this.slugs; }
  async applyDishPopularity(u: PopularityUpdate[]) { for (const x of u) this.dishWrites.set(x.id, x); }
  async applyRestaurantPopularity(u: PopularityUpdate[]) { for (const x of u) this.restWrites.set(x.id, x); }

  // unused indexer surface
  async listRestaurantSlugs() { return []; }
  async getRestaurant() { return null; }
  async getMenuItems() { return []; }
  async upsertRestaurant() {}
  async upsertDishes() {}
  async deleteDishesNotIn() {}
  async deleteRestaurant() {}
  async deleteAllDishesForRestaurant() {}

  // unused geo surface
  async getRestaurantsForGeocode() { return []; }
  async applyRestaurantGeo() {}
  async getVisibleDiscoveryRestaurants() { return []; }
  async getVisibleDiscoveryDishes() { return []; }
  async getDiscoveryDishById() { return null; }
}

const order = (slug: string, ageDays: number, lines: { dishId: string; quantity: number }[]): PopularityOrder =>
  ({ restaurantSlug: slug, createdAtMs: NOW - ageDays * DAY, paymentStatus: "paid", status: "accepted", lines });

console.log("discovery/popularity-job");

(async () => {
  await test("reads orders since now-30d and writes popularity for ALL discovery docs", async () => {
    const s = new Fake();
    s.dishIds = ["A", "B"]; // B has no orders
    s.slugs = ["k"];
    for (let i = 0; i < 6; i++) s.orders.push(order("k", 0, [{ dishId: "A", quantity: 2 }]));

    const summary = await recomputePopularity(s, NOW);
    assert.equal(s.sinceMsSeen, NOW - 30 * DAY, "window start = now - 30 days");
    assert.equal(summary.dishDocs, 2);
    // Every discovery doc got a write.
    assert.equal(s.dishWrites.size, 2);
    const A = s.dishWrites.get("A")!;
    const B = s.dishWrites.get("B")!;
    assert.ok(A.popularityScore > 0.9, `scored dish A high (${A.popularityScore.toFixed(3)})`);
    assert.equal(A.signalsComputedAt, NOW);
    assert.equal(B.popularityScore, NEUTRAL_POPULARITY, "unordered dish B → neutral");
    assert.equal(s.restWrites.get("k")!.signalsComputedAt, NOW);
  });

  await test("a dish that loses all recent orders decays back to neutral on the next run", async () => {
    const s = new Fake();
    s.dishIds = ["A"];
    s.slugs = ["k"];
    for (let i = 0; i < 6; i++) s.orders.push(order("k", 0, [{ dishId: "A", quantity: 2 }]));
    await recomputePopularity(s, NOW);
    assert.ok(s.dishWrites.get("A")!.popularityScore > 0.9);

    // Next nightly run, but the orders have aged out of the window (none qualify).
    s.orders = [];
    await recomputePopularity(s, NOW + DAY);
    const A = s.dishWrites.get("A")!;
    assert.equal(A.popularityScore, NEUTRAL_POPULARITY);
    assert.equal(A.popularityRaw, 0);
    assert.equal(A.popularityOrders, 0);
    assert.equal(A.signalsComputedAt, NOW + DAY);
  });

  console.log(`\n${passed} checks passed`);
})();
