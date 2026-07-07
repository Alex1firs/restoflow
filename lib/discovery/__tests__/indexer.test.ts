// Integration-style tests for the indexer orchestration against an in-memory
// DiscoveryStore fake (no firebase).
// Run: npx tsx lib/discovery/__tests__/indexer.test.ts

import assert from "node:assert/strict";
import { reindexRestaurant, removeFromDiscovery, backfillAll } from "../indexer";
import type { DiscoveryStore } from "../store";
import type { DiscoveryDish, DiscoveryRestaurant, SourceMenuItem, SourceRestaurant } from "../types";

let passed = 0;
const test = (name: string, fn: () => Promise<void> | void) => Promise.resolve(fn()).then(() => { passed++; console.log(`  ✓ ${name}`); });

const NOW = 1_760_000_000_000;

class FakeStore implements DiscoveryStore {
  srcR = new Map<string, SourceRestaurant>();
  srcItems = new Map<string, SourceMenuItem[]>();
  throwItems = new Set<string>();
  discR = new Map<string, DiscoveryRestaurant>();
  discD = new Map<string, DiscoveryDish>();

  async listRestaurantSlugs() { return [...this.srcR.keys()]; }
  async getRestaurant(slug: string) { return this.srcR.get(slug) ?? null; }
  async getMenuItems(slug: string) { if (this.throwItems.has(slug)) throw new Error("boom"); return this.srcItems.get(slug) ?? []; }
  async upsertRestaurant(d: DiscoveryRestaurant) { this.discR.set(d.slug, d); }
  async upsertDishes(docs: DiscoveryDish[]) { for (const d of docs) this.discD.set(d.dishId, d); }
  async deleteDishesNotIn(slug: string, keepIds: string[]) { const keep = new Set(keepIds); for (const [id, d] of this.discD) if (d.restaurantSlug === slug && !keep.has(id)) this.discD.delete(id); }
  async deleteRestaurant(slug: string) { this.discR.delete(slug); }
  async deleteAllDishesForRestaurant(slug: string) { for (const [id, d] of this.discD) if (d.restaurantSlug === slug) this.discD.delete(id); }

  dishesFor(slug: string) { return [...this.discD.values()].filter((d) => d.restaurantSlug === slug); }
}

const live = (slug: string): SourceRestaurant => ({ slug, name: slug, status: "live", subscriptionStatus: "active", subscriptionEndDateMs: NOW + 30 * 86_400_000, deliveryEnabled: true, pickupEnabled: true });
const item = (id: string, slug: string): SourceMenuItem => ({ id, restaurantId: slug, name: `Item ${id}`, price: 1000, category: "Grills", available: true });

console.log("discovery/indexer");

(async () => {
  await test("reindex a live restaurant → snapshot + all dishes, visible", async () => {
    const s = new FakeStore();
    s.srcR.set("k", live("k"));
    s.srcItems.set("k", [item("a", "k"), item("b", "k"), item("c", "k")]);
    const r = await reindexRestaurant(s, "k", NOW);
    assert.equal(r.ok, true);
    assert.equal(r.visible, true);
    assert.equal(r.dishCount, 3);
    assert.equal(s.discR.get("k")?.visible, true);
    assert.equal(s.dishesFor("k").length, 3);
  });

  await test("draft restaurant is still indexed but visible=false", async () => {
    const s = new FakeStore();
    s.srcR.set("k", { ...live("k"), status: "draft" });
    s.srcItems.set("k", [item("a", "k")]);
    const r = await reindexRestaurant(s, "k", NOW);
    assert.equal(r.ok, true);
    assert.equal(r.visible, false);
    assert.equal(s.discR.get("k")?.visible, false);
    assert.equal(s.dishesFor("k")[0].visible, false);
  });

  await test("reindex is idempotent (re-run → identical doc count)", async () => {
    const s = new FakeStore();
    s.srcR.set("k", live("k"));
    s.srcItems.set("k", [item("a", "k"), item("b", "k")]);
    await reindexRestaurant(s, "k", NOW);
    await reindexRestaurant(s, "k", NOW);
    assert.equal(s.dishesFor("k").length, 2);
    assert.equal(s.discR.size, 1);
  });

  await test("removed menu item is reconciled out (stale dish deleted)", async () => {
    const s = new FakeStore();
    s.srcR.set("k", live("k"));
    s.srcItems.set("k", [item("a", "k"), item("b", "k")]);
    await reindexRestaurant(s, "k", NOW);
    assert.equal(s.dishesFor("k").length, 2);
    s.srcItems.set("k", [item("a", "k")]); // "b" removed upstream
    await reindexRestaurant(s, "k", NOW);
    const ids = s.dishesFor("k").map((d) => d.dishId);
    assert.deepEqual(ids, ["a"]);
  });

  await test("restaurant removed upstream → purged from discovery", async () => {
    const s = new FakeStore();
    s.srcR.set("k", live("k"));
    s.srcItems.set("k", [item("a", "k")]);
    await reindexRestaurant(s, "k", NOW);
    s.srcR.delete("k"); // getRestaurant now returns null
    const r = await reindexRestaurant(s, "k", NOW);
    assert.equal(r.purged, true);
    assert.equal(s.discR.has("k"), false);
    assert.equal(s.dishesFor("k").length, 0);
  });

  await test("removeFromDiscovery purges both collections", async () => {
    const s = new FakeStore();
    s.srcR.set("k", live("k"));
    s.srcItems.set("k", [item("a", "k")]);
    await reindexRestaurant(s, "k", NOW);
    const r = await removeFromDiscovery(s, "k");
    assert.equal(r.ok, true);
    assert.equal(s.discR.has("k"), false);
    assert.equal(s.dishesFor("k").length, 0);
  });

  await test("backfillAll is resilient — one failing restaurant doesn't abort the rest", async () => {
    const s = new FakeStore();
    s.srcR.set("good1", live("good1")); s.srcItems.set("good1", [item("a", "good1")]);
    s.srcR.set("bad", live("bad")); s.srcItems.set("bad", [item("x", "bad")]); s.throwItems.add("bad");
    s.srcR.set("good2", live("good2")); s.srcItems.set("good2", [item("b", "good2")]);
    const sum = await backfillAll(s, NOW);
    assert.equal(sum.total, 3);
    assert.equal(sum.ok, 2);
    assert.equal(sum.failed, 1);
    assert.equal(sum.results.find((r) => r.slug === "bad")?.ok, false);
    assert.equal(s.discR.has("good1") && s.discR.has("good2"), true);
  });

  await test("backfillAll can scope to specific slugs", async () => {
    const s = new FakeStore();
    s.srcR.set("k", live("k")); s.srcItems.set("k", [item("a", "k")]);
    s.srcR.set("t", live("t")); s.srcItems.set("t", [item("b", "t")]);
    const sum = await backfillAll(s, NOW, { slugs: ["k"] });
    assert.equal(sum.total, 1);
    assert.equal(s.discR.has("k"), true);
    assert.equal(s.discR.has("t"), false);
  });

  console.log(`\n${passed} checks passed`);
})();
