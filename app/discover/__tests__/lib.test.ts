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
} from "../lib";
import type { DishCardData, RestaurantCardData } from "../types";

let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`  ✓ ${name}`); };

const rmini = (openNow: boolean) => ({
  slug: "r1", name: "R1", logo: "", coverImage: "", fulfillment: { delivery: true, pickup: true, dineIn: false },
  deliveryFee: null, feeDynamic: true, payments: ["Cash"], location: null, geoStatus: "none", openNow,
});
const dish = (id: string, openNow: boolean): DishCardData => ({
  id, name: id, description: "", price: 1000, priceHidden: false, image: null, category: "cat", tags: [], available: true, promo: null,
  restaurant: rmini(openNow), distanceKm: null, approximate: false,
});
const resto = (slug: string, openNow: boolean): RestaurantCardData => ({
  slug, name: slug, description: "", logo: "", coverImage: "", fulfillment: { delivery: true, pickup: false, dineIn: false },
  deliveryFee: null, feeDynamic: true, payments: ["Cash"], serviceAreas: [], location: null, geoStatus: "none", geoConfirmedAt: null,
  openNow, promo: null, tags: [], distanceKm: null, approximate: false,
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

console.log(`\n${passed} checks passed`);
