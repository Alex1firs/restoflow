// Unit tests for the pure /discover helpers.
// Run: npx tsx app/discover/__tests__/lib.test.ts

import assert from "node:assert/strict";
import {
  buildQuery,
  dishRequest,
  restaurantRequest,
  formatPrice,
  formatDistance,
  fulfillmentLabel,
  statusLabel,
  filterOpenNowDishes,
  filterOpenNowRestaurants,
  dishHref,
  restaurantHref,
  locationLabel,
  sameState,
  partitionByArea,
  normalizeStateParam,
} from "../lib";
import type { DishCardData, RestaurantCardData } from "../types";

let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`  ✓ ${name}`); };

const rmini = (openNow: boolean, state: string | null = null, city: string | null = null) => ({
  slug: "r1", name: "R1", logo: "", coverImage: "", fulfillment: { delivery: true, pickup: true, dineIn: false },
  deliveryFee: null, feeDynamic: true, payments: ["Cash"], location: null, geoStatus: "none", state, city, openNow,
});
const dish = (id: string, openNow: boolean, state: string | null = null): DishCardData => ({
  id, name: id, description: "", price: 1000, priceHidden: false, image: null, category: "cat", tags: [], available: true, promo: null,
  restaurant: rmini(openNow, state), distanceKm: null, approximate: false,
});
const resto = (slug: string, openNow: boolean, state: string | null = null): RestaurantCardData => ({
  slug, name: slug, description: "", logo: "", coverImage: "", fulfillment: { delivery: true, pickup: false, dineIn: false },
  deliveryFee: null, feeDynamic: true, payments: ["Cash"], serviceAreas: [], location: null, geoStatus: "none", geoConfirmedAt: null,
  state, city: null, openNow, promo: null, tags: [], distanceKm: null, approximate: false,
});

console.log("discover/lib");

test("buildQuery skips null/undefined/empty, encodes the rest", () => {
  assert.equal(buildQuery({ q: "jollof rice", tag: null, limit: 10, cursor: undefined, blank: "" }), "?q=jollof+rice&limit=10");
  assert.equal(buildQuery({}), "");
});

test("dishRequest: query beats tag beats trending; geo passed when present", () => {
  assert.equal(dishRequest({ query: "grill", tag: "rice-jollof", origin: null }), "/api/discovery/search?q=grill&limit=24");
  assert.equal(dishRequest({ query: "", tag: "rice-jollof", origin: null }), "/api/discovery/collections?tag=rice-jollof&limit=24");
  assert.equal(dishRequest({ query: "", tag: null, origin: null }), "/api/discovery/search?limit=24");
  assert.equal(dishRequest({ query: "", tag: null, origin: { lat: 6.45, lng: 3.39 } }), "/api/discovery/search?limit=24&lat=6.45&lng=3.39");
});

test("restaurantRequest: near when origin present, else browse", () => {
  assert.equal(restaurantRequest({ query: "", tag: null, origin: { lat: 6.45, lng: 3.39 } }), "/api/discovery/near?lat=6.45&lng=3.39&radiusKm=15&limit=12");
  assert.equal(restaurantRequest({ query: "pasta", tag: null, origin: null }), "/api/discovery/restaurants?q=pasta&limit=12");
  assert.equal(restaurantRequest({ query: "", tag: "drinks", origin: null }), "/api/discovery/restaurants?tag=drinks&limit=12");
});

test("formatPrice: naira, or 'See menu' when hidden/null", () => {
  assert.equal(formatPrice(4500, false), "₦4,500");
  assert.equal(formatPrice(null, false), "See menu");
  assert.equal(formatPrice(1000, true), "See menu");
});

test("formatDistance: meters under 1km, km above, approx marker, null when absent", () => {
  assert.equal(formatDistance(0.3, false), "300 m");
  assert.equal(formatDistance(2.4, false), "2.4 km");
  assert.equal(formatDistance(2.4, true), "~2.4 km");
  assert.equal(formatDistance(null, false), null);
});

test("fulfillmentLabel: honest, never invents 'free'", () => {
  assert.equal(fulfillmentLabel({ fulfillment: { delivery: true, pickup: true, dineIn: false }, deliveryFee: 1500, feeDynamic: false }), "Delivery ₦1,500 · Pickup");
  assert.equal(fulfillmentLabel({ fulfillment: { delivery: true, pickup: false, dineIn: false }, deliveryFee: 0, feeDynamic: true }), "Delivery");
  assert.equal(fulfillmentLabel({ fulfillment: { delivery: false, pickup: false, dineIn: false }, deliveryFee: null, feeDynamic: false }), "See restaurant");
});

test("statusLabel: open vs closed/preorder", () => {
  assert.deepEqual(statusLabel(true), { text: "Open now", open: true });
  assert.deepEqual(statusLabel(false), { text: "Closed · preorder", open: false });
});

test("open-now filters keep only open items when toggled", () => {
  const ds = [dish("a", true), dish("b", false)];
  assert.deepEqual(filterOpenNowDishes(ds, true).map((d) => d.id), ["a"]);
  assert.equal(filterOpenNowDishes(ds, false).length, 2);
  const rs = [resto("x", false), resto("y", true)];
  assert.deepEqual(filterOpenNowRestaurants(rs, true).map((r) => r.slug), ["y"]);
});

test("href helpers deep-link into the existing storefront", () => {
  assert.equal(dishHref(dish("a", true)), "/r/r1#menu");
  assert.equal(restaurantHref("tricias-kitchen"), "/r/tricias-kitchen");
});

test("href helpers carry customer state/city params only when provided (G4)", () => {
  // no loc → unchanged (direct-visit safe)
  assert.equal(dishHref(dish("a", true), undefined), "/r/r1#menu");
  assert.equal(restaurantHref("tricias-kitchen", {}), "/r/tricias-kitchen");
  // state only
  assert.equal(dishHref(dish("a", true), { state: "Anambra" }), "/r/r1?cs=Anambra#menu");
  assert.equal(restaurantHref("food-kapitol", { state: "Anambra" }), "/r/food-kapitol?cs=Anambra");
  // state + city
  assert.equal(restaurantHref("food-kapitol", { state: "Anambra", city: "Onitsha" }), "/r/food-kapitol?cs=Anambra&cc=Onitsha");
  // blank/null state → no params
  assert.equal(dishHref(dish("a", true), { state: null }), "/r/r1#menu");
});

// ── Location (G3) ──
test("locationLabel: 'City, State' / 'State' / null; trims blanks", () => {
  assert.equal(locationLabel({ city: "Onitsha", state: "Anambra" }), "Onitsha, Anambra");
  assert.equal(locationLabel({ city: "  ", state: "Lagos" }), "Lagos");
  assert.equal(locationLabel({ city: "Awoyaya", state: null }), "Awoyaya");
  assert.equal(locationLabel({ city: null, state: null }), null);
});

test("sameState: case/space-insensitive", () => {
  assert.equal(sameState("Anambra", "anambra"), true);
  assert.equal(sameState("  Lagos ", "Lagos"), true);
  assert.equal(sameState("Lagos", "Anambra"), false);
  assert.equal(sameState(null, "Lagos"), false);
});

test("partitionByArea: no state → all-with-state in-area, stateless unknown", () => {
  const items = [resto("a", true, "Anambra"), resto("b", true, null), resto("c", true, "Lagos")];
  const b = partitionByArea(items, null, (r) => r.state);
  assert.deepEqual(b.inArea.map((r) => r.slug), ["a", "c"]);
  assert.deepEqual(b.unknown.map((r) => r.slug), ["b"]);
  assert.deepEqual(b.outOfArea, []);
});

test("partitionByArea: state selected → same=inArea, diff=outOfArea, blank=unknown", () => {
  const items = [resto("a", true, "Anambra"), resto("b", true, "Lagos"), resto("c", true, null), resto("d", true, "anambra")];
  const b = partitionByArea(items, "Anambra", (r) => r.state);
  assert.deepEqual(b.inArea.map((r) => r.slug), ["a", "d"]); // case-insensitive match
  assert.deepEqual(b.outOfArea.map((r) => r.slug), ["b"]);
  assert.deepEqual(b.unknown.map((r) => r.slug), ["c"]);
});

test("partitionByArea works on dishes via restaurant.state accessor", () => {
  const ds = [dish("x", true, "Anambra"), dish("y", true, "Lagos")];
  const b = partitionByArea(ds, "Lagos", (d) => d.restaurant.state);
  assert.deepEqual(b.inArea.map((d) => d.id), ["y"]);
  assert.deepEqual(b.outOfArea.map((d) => d.id), ["x"]);
});

test("normalizeStateParam: canonicalizes valid, rejects unknown/blank", () => {
  const allowed = ["Anambra", "Lagos", "Kano"];
  assert.equal(normalizeStateParam("anambra", allowed), "Anambra");
  assert.equal(normalizeStateParam("  LAGOS ", allowed), "Lagos");
  assert.equal(normalizeStateParam("Atlantis", allowed), null);
  assert.equal(normalizeStateParam("", allowed), null);
  assert.equal(normalizeStateParam(null, allowed), null);
});

console.log(`\n${passed} checks passed`);
