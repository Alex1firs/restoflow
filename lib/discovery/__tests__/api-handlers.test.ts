// Integration tests for the pure discovery API handlers (Sprint 2.5b).
// Run: npx tsx lib/discovery/__tests__/api-handlers.test.ts

import assert from "node:assert/strict";
import {
  searchDishesHandler,
  nearRestaurantsHandler,
  categoriesHandler,
  collectionsHandler,
  restaurantsHandler,
  dishDetailHandler,
  parseListParams,
  type HandlerDeps,
} from "../api-handlers";
import type { DiscoveryDish, DiscoveryRestaurant, RestaurantSnapshot } from "../types";
import { encodeGeohash, type GeoStatus } from "../geo";
import type { DiscoveryStore } from "../store";

let passed = 0;
const test = (name: string, fn: () => Promise<void>) => fn().then(() => { passed++; console.log(`  ✓ ${name}`); });

const NOW = 1_760_000_000_000;

// Fake store — handlers only touch these three reads.
function makeStore(dishes: DiscoveryDish[], restaurants: DiscoveryRestaurant[]): DiscoveryStore {
  return {
    getVisibleDiscoveryDishes: async () => dishes.filter((d) => d.visible),
    getVisibleDiscoveryRestaurants: async () => restaurants.filter((r) => r.visible),
    getDiscoveryDishById: async (id: string) => dishes.find((d) => d.dishId === id) ?? null,
  } as unknown as DiscoveryStore;
}

// isOpenNow stub reads a sentinel on openingHours so tests are deterministic.
const deps = (store: DiscoveryStore): HandlerDeps => ({ store, nowMs: NOW, isOpenNow: (oh) => (oh as { _open?: boolean } | null)?._open !== false });

function snap(slug: string, geoStatus: GeoStatus, coords: { lat: number; lng: number } | null): RestaurantSnapshot {
  const location = coords ? { lat: coords.lat, lng: coords.lng, geohash: encodeGeohash(coords.lat, coords.lng), formattedAddress: "addr" } : null;
  return {
    slug, name: `R ${slug}`, description: "", logo: `${slug}.png`, coverImage: "c.png",
    fulfillment: { delivery: true, pickup: true, dineIn: false },
    deliveryFee: null, feeDynamic: true, payments: ["Cash"], pickupAddress: null, location, geoStatus,
  };
}

function dish(id: string, restSlug: string, over: Partial<DiscoveryDish> = {}, geo: { status?: GeoStatus; coords?: { lat: number; lng: number } | null } = {}): DiscoveryDish {
  return {
    dishId: id, restaurantSlug: restSlug, name: over.name ?? id, description: "d",
    price: over.price ?? 1000, priceHidden: over.priceHidden ?? false, image: over.image ?? null,
    available: over.available ?? true, rawCategory: "Cat", categoryKey: over.categoryKey ?? "cat",
    taxonomyTags: over.taxonomyTags ?? [], taxonomyVersion: 1,
    popularityScore: over.popularityScore ?? 0.5, popularityRaw: over.popularityRaw ?? 0, popularityOrders: over.popularityOrders ?? 0,
    promo: over.promo ?? null, restaurantSnapshot: snap(restSlug, geo.status ?? "none", geo.coords ?? null),
    visible: over.visible ?? true, updatedAt: over.updatedAt ?? NOW, signalsComputedAt: null, schemaVersion: 1,
  };
}

function restaurant(slug: string, over: Partial<DiscoveryRestaurant> & { open?: boolean } = {}, geo: { status?: GeoStatus; coords?: { lat: number; lng: number } | null } = {}): DiscoveryRestaurant {
  const s = snap(slug, geo.status ?? "none", geo.coords ?? null);
  return {
    ...s,
    serviceAreas: over.serviceAreas ?? [], openingHours: { _open: over.open ?? true }, geoConfirmedAt: geo.status === "confirmed" ? NOW : null,
    promo: over.promo ?? null, taxonomyTags: over.taxonomyTags ?? [], taxonomyVersion: 1,
    popularityScore: over.popularityScore ?? 0.5, popularityRaw: over.popularityRaw ?? 0, popularityOrders: over.popularityOrders ?? 0,
    visible: over.visible ?? true, updatedAt: over.updatedAt ?? NOW, signalsComputedAt: null, schemaVersion: 1,
  };
}

const ORIGIN = { lat: 6.4541, lng: 3.3947 };
const near1 = { lat: 6.455, lng: 3.395 };

console.log("discovery/api-handlers");

(async () => {
  // ── Empty index ──
  await test("empty index → all list handlers return valid empty responses (not errors)", async () => {
    const d = deps(makeStore([], []));
    assert.deepEqual(await searchDishesHandler(d, {}), { items: [], nextCursor: null, total: 0 });
    assert.deepEqual(await nearRestaurantsHandler(d, { origin: ORIGIN }), { items: [], nextCursor: null, total: 0, excludedNoUsableLocation: 0 });
    assert.deepEqual(await categoriesHandler(d), { facets: [], total: 0 });
    assert.deepEqual(await restaurantsHandler(d, {}), { items: [], nextCursor: null, total: 0 });
    assert.deepEqual(await collectionsHandler(d, { tag: "soups" }), { collection: "soups", items: [], nextCursor: null, total: 0 });
    assert.equal(await dishDetailHandler(d, "missing", {}), null);
  });

  // ── /search food-first + snapshot ──
  await test("/search returns ranked dishes with a restaurant snapshot, food-first by popularity", async () => {
    const dishes = [dish("hot", "r1", { taxonomyTags: ["t"], popularityScore: 0.9 }), dish("cold", "r2", { taxonomyTags: ["t"], popularityScore: 0.2 })];
    const restos = [restaurant("r1"), restaurant("r2")];
    const res = await searchDishesHandler(deps(makeStore(dishes, restos)), { tags: ["t"] });
    assert.deepEqual(res.items.map((i) => i.id), ["hot", "cold"]);
    assert.equal(res.items[0].restaurant.slug, "r1");
    assert.equal(res.items[0].restaurant.openNow, true);
  });

  await test("/search hard-filters unavailable dishes", async () => {
    const dishes = [dish("ok", "r1", { taxonomyTags: ["t"] }), dish("no", "r1", { taxonomyTags: ["t"], available: false })];
    const res = await searchDishesHandler(deps(makeStore(dishes, [restaurant("r1")])), { tags: ["t"] });
    assert.deepEqual(res.items.map((i) => i.id), ["ok"]);
  });

  await test("openNow is recomputed at read time from the restaurant clock", async () => {
    const res = await searchDishesHandler(deps(makeStore([dish("d", "r1", { taxonomyTags: ["t"] })], [restaurant("r1", { open: false })])), { tags: ["t"] });
    assert.equal(res.items[0].restaurant.openNow, false); // closed at read time
  });

  // ── /near ──
  await test("/near ranks usable-geo restaurants and reports excludedNoUsableLocation", async () => {
    const restos = [
      restaurant("ok", { popularityScore: 0.5 }, { status: "confirmed", coords: near1 }),
      restaurant("nogeo", { popularityScore: 0.9 }),
      restaurant("failed", { popularityScore: 0.9 }, { status: "failed", coords: near1 }),
    ];
    const res = await nearRestaurantsHandler(deps(makeStore([], restos)), { origin: ORIGIN, radiusKm: 10 });
    assert.deepEqual(res.items.map((i) => i.slug), ["ok"]);
    assert.equal(res.excludedNoUsableLocation, 2);
    assert.equal(typeof res.items[0].distanceKm, "number");
  });

  await test("/near with no origin → valid empty response", async () => {
    const res = await nearRestaurantsHandler(deps(makeStore([], [restaurant("ok", {}, { status: "confirmed", coords: near1 })])), {});
    assert.deepEqual(res, { items: [], nextCursor: null, total: 0, excludedNoUsableLocation: 0 });
  });

  // ── /categories ──
  await test("/categories returns facet counts sorted desc, with labels", async () => {
    const dishes = [
      dish("a", "r1", { taxonomyTags: ["rice-jollof", "combos-specials"] }),
      dish("b", "r1", { taxonomyTags: ["rice-jollof"] }),
      dish("c", "r2", { taxonomyTags: ["drinks"] }),
    ];
    const res = await categoriesHandler(deps(makeStore(dishes, [restaurant("r1"), restaurant("r2")])));
    assert.equal(res.total, 3);
    assert.deepEqual(res.facets[0], { tag: "rice-jollof", label: "Rice & Jollof", count: 2 });
    assert.equal(res.facets.find((f) => f.tag === "drinks")?.label, "Drinks");
  });

  // ── /collections ──
  await test("/collections ranks dishes within a tag; unknown tag has no matches", async () => {
    const dishes = [dish("a", "r1", { taxonomyTags: ["soups"], popularityScore: 0.4 }), dish("b", "r2", { taxonomyTags: ["soups"], popularityScore: 0.9 }), dish("c", "r3", { taxonomyTags: ["grill"] })];
    const restos = [restaurant("r1"), restaurant("r2"), restaurant("r3")];
    const res = await collectionsHandler(deps(makeStore(dishes, restos)), { tag: "soups" });
    assert.equal(res.collection, "soups");
    assert.deepEqual(res.items.map((i) => i.id), ["b", "a"]);
  });

  await test("/collections with no tag → valid empty response", async () => {
    const res = await collectionsHandler(deps(makeStore([dish("a", "r1", { taxonomyTags: ["soups"] })], [restaurant("r1")])), {});
    assert.deepEqual(res, { collection: null, items: [], nextCursor: null, total: 0 });
  });

  // ── /dish/[id] ──
  await test("/dish/[id] returns the dish + related same-taxonomy dishes (seed excluded)", async () => {
    const dishes = [
      dish("seed", "r1", { taxonomyTags: ["rice-jollof"] }),
      dish("sib", "r2", { taxonomyTags: ["rice-jollof"], popularityScore: 0.7 }),
      dish("other", "r3", { taxonomyTags: ["grill"], popularityScore: 0.9 }),
    ];
    const restos = [restaurant("r1"), restaurant("r2"), restaurant("r3")];
    const res = await dishDetailHandler(deps(makeStore(dishes, restos)), "seed", {});
    assert.ok(res);
    assert.equal(res!.dish.id, "seed");
    assert.deepEqual(res!.related.items.map((i) => i.id), ["sib"]); // 'other' wrong tag; seed excluded
  });

  await test("/dish/[id] returns null for a hidden or missing dish", async () => {
    const dishes = [dish("hidden", "r1", { visible: false, taxonomyTags: ["t"] })];
    const d = deps(makeStore(dishes, [restaurant("r1")]));
    assert.equal(await dishDetailHandler(d, "hidden", {}), null);
    assert.equal(await dishDetailHandler(d, "nope", {}), null);
  });

  // ── /restaurants ──
  await test("/restaurants browse ranks restaurants by popularity", async () => {
    const restos = [restaurant("quiet", { popularityScore: 0.2 }), restaurant("busy", { popularityScore: 0.9 })];
    const res = await restaurantsHandler(deps(makeStore([], restos)), {});
    assert.deepEqual(res.items.map((i) => i.slug), ["busy", "quiet"]);
  });

  // ── Visibility ──
  await test("hidden docs are never returned (visible filter enforced)", async () => {
    const dishes = [dish("shown", "r1", { taxonomyTags: ["t"] }), dish("hidden", "r1", { taxonomyTags: ["t"], visible: false })];
    const restos = [restaurant("r1"), restaurant("gone", { visible: false })];
    const s = makeStore(dishes, restos);
    assert.deepEqual((await searchDishesHandler(deps(s), { tags: ["t"] })).items.map((i) => i.id), ["shown"]);
    assert.deepEqual((await restaurantsHandler(deps(s), {})).items.map((i) => i.slug), ["r1"]);
  });

  // ── Pagination ──
  await test("pagination cursor round-trips across pages with no gap/overlap", async () => {
    const restos = Array.from({ length: 5 }, (_, i) => restaurant(`r${i}`, { popularityScore: 0.9 - i * 0.1 }));
    const s = deps(makeStore([], restos));
    const p1 = await restaurantsHandler(s, { limit: 2 });
    assert.deepEqual(p1.items.map((i) => i.slug), ["r0", "r1"]);
    const p2 = await restaurantsHandler(s, { limit: 2, cursor: p1.nextCursor });
    assert.deepEqual(p2.items.map((i) => i.slug), ["r2", "r3"]);
    const p3 = await restaurantsHandler(s, { limit: 2, cursor: p2.nextCursor });
    assert.deepEqual(p3.items.map((i) => i.slug), ["r4"]);
    assert.equal(p3.nextCursor, null);
  });

  // ── Explain gating ──
  await test("explain flag toggles the score breakdown in the payload", async () => {
    const dishes = [dish("a", "r1", { taxonomyTags: ["t"] })];
    const s = makeStore(dishes, [restaurant("r1")]);
    const off = await searchDishesHandler(deps(s), { tags: ["t"] });
    assert.equal((off.items[0] as { _score?: number })._score, undefined);
    assert.equal((off.items[0] as { _breakdown?: unknown })._breakdown, undefined);
    const on = await searchDishesHandler(deps(s), { tags: ["t"], explain: true });
    assert.equal(typeof (on.items[0] as { _score?: number })._score, "number");
    assert.ok(Array.isArray((on.items[0] as { _breakdown?: unknown[] })._breakdown));
  });

  // ── No private-field leakage ──
  await test("no private/internal fields leak — even when source docs are polluted", async () => {
    // Pollute source docs with secrets + internal bookkeeping.
    const dirtyDish = { ...dish("a", "r1", { taxonomyTags: ["t"] }), paystackSubaccountCode: "ACCT_secret", ownerEmail: "o@x.com" } as unknown as DiscoveryDish;
    const dirtyResto = { ...restaurant("r1"), paystackSubaccountCode: "ACCT_secret", ownerEmail: "o@x.com", ownerPhone: "08031112222", subscriptionEndDate: 123 } as unknown as DiscoveryRestaurant;
    const s = makeStore([dirtyDish], [dirtyResto]);

    const search = await searchDishesHandler(deps(s), { tags: ["t"], explain: true });
    const browse = await restaurantsHandler(deps(s), { explain: true });
    const blob = JSON.stringify(search) + JSON.stringify(browse);
    for (const secret of ["ACCT_secret", "o@x.com", "08031112222", "paystack", "subscriptionEndDate", "popularityRaw", "signalsComputedAt", "schemaVersion", "taxonomyVersion"]) {
      assert.ok(!blob.includes(secret), `must NOT leak "${secret}"`);
    }
    // Dish card exposes exactly the whitelisted top-level keys.
    const dishKeys = Object.keys(search.items[0]).filter((k) => !k.startsWith("_")).sort();
    assert.deepEqual(dishKeys, ["approximate", "available", "category", "description", "distanceKm", "id", "image", "name", "price", "priceHidden", "promo", "restaurant", "tags"].sort());
    const restoKeys = Object.keys(browse.items[0]).filter((k) => !k.startsWith("_")).sort();
    assert.deepEqual(restoKeys, ["approximate", "coverImage", "deliveryFee", "description", "distanceKm", "feeDynamic", "fulfillment", "geoConfirmedAt", "geoStatus", "location", "logo", "name", "openNow", "payments", "promo", "serviceAreas", "slug", "tags"].sort());
  });

  // ── Param parsing ──
  await test("parseListParams: origin, limit clamp, tags csv, explain, tag/key alias", async () => {
    const p = parseListParams(new URLSearchParams("q=jollof&tags=rice,soups&lat=6.45&lng=3.39&limit=999&explain=1&key=drinks"));
    assert.equal(p.q, "jollof");
    assert.deepEqual(p.tags, ["rice", "soups"]);
    assert.deepEqual(p.origin, { lat: 6.45, lng: 3.39 });
    assert.equal(p.limit, 50); // clamped
    assert.equal(p.explain, true);
    assert.equal(p.tag, "drinks");
    const empty = parseListParams(new URLSearchParams("lat=abc"));
    assert.equal(empty.origin, null); // invalid coord ignored
    assert.equal(empty.explain, false);
  });

  console.log(`\n${passed} checks passed`);
})();
