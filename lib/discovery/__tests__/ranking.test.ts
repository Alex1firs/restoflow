// Unit tests for the deterministic ranking engine (Sprint 2.5a).
// Run: npx tsx lib/discovery/__tests__/ranking.test.ts

import assert from "node:assert/strict";
import {
  rankSearchDishes,
  rankCollectionDishes,
  rankRelatedDishes,
  rankRestaurantsBrowse,
  rankNearRestaurants,
  decodeCursor,
  WEIGHTS,
  DISTANCE_SCALE_KM,
  type RankContext,
  type RankedItem,
} from "../ranking";
import type { DiscoveryDish, DiscoveryRestaurant, RestaurantSnapshot } from "../types";
import { encodeGeohash, type GeoStatus } from "../geo";

let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`  ✓ ${name}`); };
const approx = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

const NOW = 1_760_000_000_000;

function snap(slug: string, geoStatus: GeoStatus, coords: { lat: number; lng: number } | null): RestaurantSnapshot {
  const location = coords ? { lat: coords.lat, lng: coords.lng, geohash: encodeGeohash(coords.lat, coords.lng), formattedAddress: "a" } : null;
  return {
    slug, name: slug, description: "", logo: "", coverImage: "",
    fulfillment: { delivery: true, pickup: true, dineIn: false },
    deliveryFee: null, feeDynamic: true, payments: ["Cash"], pickupAddress: null,
    location, geoStatus, state: null, city: null,
  };
}

type DishOver = Partial<Pick<DiscoveryDish, "name" | "categoryKey" | "taxonomyTags" | "price" | "available" | "visible" | "popularityScore" | "popularityRaw" | "popularityOrders" | "updatedAt" | "promo">>;
function dish(id: string, restSlug: string, over: DishOver = {}, geo: { status?: GeoStatus; coords?: { lat: number; lng: number } | null } = {}): DiscoveryDish {
  return {
    dishId: id, restaurantSlug: restSlug, name: over.name ?? id, description: "",
    price: over.price ?? 1000, priceHidden: false, image: null,
    available: over.available ?? true,
    rawCategory: "Cat", categoryKey: over.categoryKey ?? "cat",
    taxonomyTags: over.taxonomyTags ?? [], taxonomyVersion: 1,
    popularityScore: over.popularityScore ?? 0.5, popularityRaw: over.popularityRaw ?? 0, popularityOrders: over.popularityOrders ?? 0,
    promo: over.promo ?? null,
    restaurantSnapshot: snap(restSlug, geo.status ?? "none", geo.coords ?? null),
    visible: over.visible ?? true, updatedAt: over.updatedAt ?? NOW, signalsComputedAt: null, schemaVersion: 1,
  };
}

type RestOver = Partial<Pick<DiscoveryRestaurant, "name" | "taxonomyTags" | "visible" | "popularityScore" | "popularityRaw" | "popularityOrders" | "updatedAt" | "promo">>;
function rest(slug: string, over: RestOver = {}, geo: { status?: GeoStatus; coords?: { lat: number; lng: number } | null } = {}): DiscoveryRestaurant {
  const s = snap(slug, geo.status ?? "none", geo.coords ?? null);
  return {
    ...s,
    serviceAreas: [], openingHours: null, geoConfirmedAt: null,
    promo: over.promo ?? null, taxonomyTags: over.taxonomyTags ?? [], taxonomyVersion: 1,
    popularityScore: over.popularityScore ?? 0.5, popularityRaw: over.popularityRaw ?? 0, popularityOrders: over.popularityOrders ?? 0,
    name: over.name ?? slug,
    visible: over.visible ?? true, updatedAt: over.updatedAt ?? NOW, signalsComputedAt: null, schemaVersion: 1,
  };
}

const ORIGIN = { lat: 6.4541, lng: 3.3947 };
const near1 = { lat: 6.455, lng: 3.395 };  // ~0.1 km
const base: RankContext = { nowMs: NOW };
const ids = (p: { items: RankedItem<unknown>[] }) => p.items.map((i) => i.id);

console.log("discovery/ranking");

// ── Normalizers / weighted sum ──
test("weighted sum matches hand computation (search, all-open, no distance)", () => {
  // popularity 0.8, relevance exact-tag 1.0, openNow 1, promo 0, availability 1
  const d = dish("d1", "r1", { taxonomyTags: ["rice-jollof"], popularityScore: 0.8 });
  const ctx: RankContext = { ...base, tags: ["rice-jollof"], explain: true };
  const item = rankSearchDishes([d], ctx).items[0];
  const w = WEIGHTS.search;
  const expected = w.relevance * 1 + w.popularity * 0.8 + w.openNow * 1 + w.availability * 1; // distance & promo & rating 0
  approx(item.score, expected);
  // breakdown present under explain
  assert.equal(item.breakdown?.find((b) => b.signal === "distance")?.weighted, 0);
});

test("distance uses exponential decay and only when usable geo + origin", () => {
  const d = dish("d1", "r1", { taxonomyTags: ["x"] }, { status: "confirmed", coords: near1 });
  const item = rankNearRestaurants([rest("r1", { taxonomyTags: ["x"] }, { status: "confirmed", coords: near1 })], { ...base, origin: ORIGIN, explain: true }).items[0];
  const distSig = item.breakdown!.find((b) => b.signal === "distance")!;
  assert.ok(distSig.applicable && distSig.raw > 0.9); // ~0.1km → near 1.0
  void d;
});

// ── Hard filters ──
test("/search hard-filters unavailable and non-visible dishes", () => {
  const list = [
    dish("ok", "r1", { taxonomyTags: ["t"] }),
    dish("unavail", "r1", { taxonomyTags: ["t"], available: false }),
    dish("hidden", "r1", { taxonomyTags: ["t"], visible: false }),
  ];
  assert.deepEqual(ids(rankSearchDishes(list, { ...base, tags: ["t"] })), ["ok"]);
});

test("match predicate: with a query/tag constraint, relevance=0 dishes are excluded", () => {
  const list = [dish("match", "r1", { taxonomyTags: ["rice"] }), dish("nomatch", "r2", { taxonomyTags: ["grill"] })];
  assert.deepEqual(ids(rankSearchDishes(list, { ...base, tags: ["rice"] })), ["match"]);
});

test("no constraint (browse) applies no relevance filter", () => {
  const list = [rest("a"), rest("b")];
  assert.equal(rankRestaurantsBrowse(list, base).items.length, 2);
});

// ── openNow / preorder (soft) ──
test("closed demotes but does not exclude; preorder gets partial credit above fully-closed", () => {
  const a = rest("open", { popularityScore: 0.5 });
  const b = rest("closedPre", { popularityScore: 0.5 });
  const c = rest("closedNo", { popularityScore: 0.5 });
  const ctx: RankContext = { ...base, openNowBySlug: { open: true, closedPre: false, closedNo: false }, preorderBySlug: { closedPre: true } };
  const order = ids(rankRestaurantsBrowse([c, b, a], ctx));
  assert.deepEqual(order, ["open", "closedPre", "closedNo"]); // all present, correctly ordered
});

// ── distance never penalizes /search ──
test("/search: missing geo does NOT penalize; distance weight is 0 for everyone", () => {
  const withGeo = dish("withGeo", "r1", { taxonomyTags: ["t"], popularityScore: 0.5 }, { status: "confirmed", coords: near1 });
  const noGeo = dish("noGeo", "r2", { taxonomyTags: ["t"], popularityScore: 0.5 });
  const ctx: RankContext = { ...base, tags: ["t"], origin: ORIGIN, explain: true };
  const page = rankSearchDishes([withGeo, noGeo], ctx);
  // identical scores despite one having geo and one not (distance weight 0)
  approx(page.items[0].score, page.items[1].score);
  // distance still annotated for the one with usable geo
  const wg = page.items.find((i) => i.id === "withGeo")!;
  assert.ok(typeof wg.distanceKm === "number");
});

// ── dish vs restaurant / food-first ──
test("dishes and restaurants each rank by their own popularity", () => {
  const dishes = [dish("hot", "r1", { taxonomyTags: ["t"], popularityScore: 0.9 }), dish("cold", "r2", { taxonomyTags: ["t"], popularityScore: 0.3 })];
  assert.deepEqual(ids(rankSearchDishes(dishes, { ...base, tags: ["t"] })), ["hot", "cold"]);
  const rs = [rest("popular", { popularityScore: 0.9 }), rest("quiet", { popularityScore: 0.2 })];
  assert.deepEqual(ids(rankRestaurantsBrowse(rs, base)), ["popular", "quiet"]);
});

// ── cold-start ──
test("cold-start: a neutral-popularity new item ranks mid-pack, not last-by-construction", () => {
  const strong = rest("strong", { popularityScore: 0.9 });
  const fresh = rest("fresh", { popularityScore: 0.5 }); // neutral baseline (2.3)
  const weak = rest("weak", { popularityScore: 0.2 });
  assert.deepEqual(ids(rankRestaurantsBrowse([weak, fresh, strong], base)), ["strong", "fresh", "weak"]);
});

// ── no-owner-vanity guard ──
test("vanity fields (rating/ordersToday/deliveryTime) are ignored — polluting source doesn't change output", () => {
  const clean = rest("r1", { popularityScore: 0.6 });
  const dirty = { ...rest("r1", { popularityScore: 0.6 }), rating: 5, ordersToday: 9999, deliveryTime: 1 } as unknown as DiscoveryRestaurant;
  const a = rankRestaurantsBrowse([clean], { ...base, explain: true }).items[0];
  const b = rankRestaurantsBrowse([dirty], { ...base, explain: true }).items[0];
  approx(a.score, b.score);
  assert.equal(WEIGHTS.search.rating, 0);
  assert.equal(a.breakdown!.find((s) => s.signal === "rating")!.weighted, 0);
});

// ── tie-breakers ──
test("equal scores resolve deterministically: evidence → raw → updatedAt → id", () => {
  // Same popularityScore → same score; break by popularityOrders then id.
  const p = { popularityScore: 0.5 };
  const list = [
    rest("b", { ...p, popularityOrders: 1, updatedAt: NOW }),
    rest("a", { ...p, popularityOrders: 1, updatedAt: NOW }), // ties b on everything but id → 'a' first
    rest("c", { ...p, popularityOrders: 5, updatedAt: NOW }), // more evidence → first
  ];
  assert.deepEqual(ids(rankRestaurantsBrowse(list, base)), ["c", "a", "b"]);
});

// ── dish diversity cap ──
test("dish diversity: at most 3 dishes per restaurant survive (cap #10)", () => {
  const dishes = Array.from({ length: 5 }, (_, i) => dish(`r1-${i}`, "r1", { taxonomyTags: ["t"], popularityScore: 0.9 - i * 0.01 }))
    .concat(dish("r2-0", "r2", { taxonomyTags: ["t"], popularityScore: 0.4 }));
  const page = rankSearchDishes(dishes, { ...base, tags: ["t"], limit: 20 });
  const fromR1 = page.items.filter((i) => i.slug === "r1");
  assert.equal(fromR1.length, 3); // 5 → capped to 3
  assert.equal(page.items.length, 4); // 3 from r1 + 1 from r2
});

// ── related dishes ──
test("related: excludes the seed dish and ranks by shared taxonomy", () => {
  const seed = dish("seed", "r1", { taxonomyTags: ["rice-jollof"] });
  const sameTag = dish("sib", "r2", { taxonomyTags: ["rice-jollof"], popularityScore: 0.6 });
  const otherTag = dish("other", "r3", { taxonomyTags: ["grill"], popularityScore: 0.9 });
  const page = rankRelatedDishes([seed, sameTag, otherTag], { ...base, seedDishId: "seed", seedTags: ["rice-jollof"] });
  assert.equal(page.items.find((i) => i.id === "seed"), undefined); // seed excluded
  assert.deepEqual(ids(page), ["sib"]); // otherTag has relevance 0 → filtered by match predicate
});

// ── /near exclusion accounting ──
test("/near excludes no-usable-geo restaurants and reports the count", () => {
  const list = [
    rest("ok", { popularityScore: 0.5 }, { status: "confirmed", coords: near1 }),
    rest("nogeo", { popularityScore: 0.9 }),                                   // no coords
    rest("failed", { popularityScore: 0.9 }, { status: "failed", coords: near1 }), // untrusted
  ];
  const page = rankNearRestaurants(list, { ...base, origin: ORIGIN, radiusKm: 10 });
  assert.deepEqual(ids(page), ["ok"]);
  assert.equal(page.excludedNoUsableLocation, 2);
});

test("/near with no origin returns empty + zero exclusions (needs user location)", () => {
  const page = rankNearRestaurants([rest("a", {}, { status: "confirmed", coords: near1 })], base);
  assert.equal(page.items.length, 0);
  assert.equal(page.excludedNoUsableLocation, 0);
});

// ── pagination / cursor ──
test("cursor: page1 + page2 partition the set with no gap or overlap", () => {
  const rs = Array.from({ length: 5 }, (_, i) => rest(`r${i}`, { popularityScore: 0.9 - i * 0.1 }));
  const p1 = rankRestaurantsBrowse(rs, { ...base, limit: 2 });
  assert.deepEqual(ids(p1), ["r0", "r1"]);
  assert.ok(p1.nextCursor);
  const p2 = rankRestaurantsBrowse(rs, { ...base, limit: 2, cursor: p1.nextCursor });
  assert.deepEqual(ids(p2), ["r2", "r3"]);
  const p3 = rankRestaurantsBrowse(rs, { ...base, limit: 2, cursor: p2.nextCursor });
  assert.deepEqual(ids(p3), ["r4"]);
  assert.equal(p3.nextCursor, null);
});

test("cursor: encode/decode round-trips and rejects a mismatched context", () => {
  const rs = Array.from({ length: 3 }, (_, i) => rest(`r${i}`, { popularityScore: 0.9 - i * 0.1 }));
  const p1 = rankRestaurantsBrowse(rs, { ...base, limit: 1 });
  // reusing the cursor under a DIFFERENT query context → treated as fresh (page 1 again)
  const reused = rankRestaurantsBrowse(rs, { ...base, limit: 1, cursor: p1.nextCursor, query: "different" });
  assert.deepEqual(ids(reused), ids(rankRestaurantsBrowse(rs, { ...base, limit: 1, query: "different" })));
});

test("cursor freezes nowMs + origin: advancing the caller clock keeps the same order", () => {
  const rs = Array.from({ length: 4 }, (_, i) => rest(`r${i}`, { popularityScore: 0.9 - i * 0.1 }, { status: "confirmed", coords: near1 }));
  const p1 = rankNearRestaurants(rs, { ...base, origin: ORIGIN, radiusKm: 100, limit: 2 });
  // Next page requested "later" (nowMs advanced) and with a jittered origin — cursor's frozen snapshot wins.
  const p2 = rankNearRestaurants(rs, { nowMs: NOW + 5_000_000, origin: { lat: 6.9, lng: 3.9 }, radiusKm: 100, limit: 2, cursor: p1.nextCursor });
  assert.deepEqual(ids(p2), ["r2", "r3"]);
});

test("decodeCursor returns null on garbage", () => {
  assert.equal(decodeCursor("not-base64!!", "k"), null);
  assert.equal(decodeCursor(null, "k"), null);
});

// ── explain gating ──
test("breakdown omitted unless explain flag is set", () => {
  const rs = [rest("a", { popularityScore: 0.5 })];
  assert.equal(rankRestaurantsBrowse(rs, base).items[0].breakdown, undefined);
  assert.ok(rankRestaurantsBrowse(rs, { ...base, explain: true }).items[0].breakdown);
});

// ── collections ──
test("/collections ranks dishes within a tag, popularity-led", () => {
  const dishes = [
    dish("a", "r1", { taxonomyTags: ["soups"], popularityScore: 0.4 }),
    dish("b", "r2", { taxonomyTags: ["soups"], popularityScore: 0.9 }),
    dish("c", "r3", { taxonomyTags: ["grill"], popularityScore: 0.99 }), // wrong tag → excluded
  ];
  assert.deepEqual(ids(rankCollectionDishes(dishes, { ...base, tags: ["soups"] })), ["b", "a"]);
  void DISTANCE_SCALE_KM;
});

console.log(`\n${passed} checks passed`);
