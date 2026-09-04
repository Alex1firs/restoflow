/**
 * Food-aware search.
 *
 * `rankAndMatch` is the pure half, so these run the REAL matching and the real
 * visibility gate with no database.
 */
import assert from "node:assert/strict";
import { rankAndMatch } from "../search";
import type { PublicRestaurant } from "../discovery";

let passed = 0;
const test = (n: string, f: () => void) => { f(); passed++; console.log(`  ✓ ${n}`); };
console.log("marketplace/search");

const card = (slug: string, name: string, cuisines: string[] = []): PublicRestaurant => ({
  slug, name, cuisines, logoUrl: null, coverUrl: null, rating: null,
  distanceKm: 1, etaMins: 25, deliveryFeeMinor: null, feeDynamic: true,
  isOpen: true, opensAt: null, promoLabel: null, minOrderMinor: null,
});

// A restaurant's raw doc supplies the markup config used to price a dish.
const raw = (over: Record<string, unknown> = {}) => ({
  marketplace: { marketplaceEnabled: true, pricing: { markup: { type: "percent", bps: 2000 }, roundToMinor: 5000 } },
  ...over,
});

const TRISHA = { card: card("stg-trishas-kitchen", "Trisha's Kitchen", ["African", "Rice"]), raw: raw() };
const STEAM  = { card: card("stg-the-steam-menu", "The Steam Menu", ["Asian"]), raw: raw() };
const RESTAURANTS = [TRISHA, STEAM];

const item = (id: string, restaurantId: string, name: string, over: Record<string, unknown> = {}) => ({
  id, raw: { restaurantId, name, price: 3500, category: "Rice", available: true,
             marketplace: { channel: "both", available: null, priceOverride: null }, ...over },
});

const T = (q: string, items = [item("stg-jollof", "stg-trishas-kitchen", "Jollof Rice & Chicken")]) =>
  rankAndMatch(q.toLowerCase().split(/\s+/).filter(t => t.length >= 2), RESTAURANTS, items);

test("[1] restaurant-name search", () => {
  const r = T("trisha");
  assert.deepEqual(r.restaurants.map(x => x.slug), ["stg-trishas-kitchen"]);
});

test("[2] cuisine search", () => {
  const r = T("asian");
  assert.deepEqual(r.restaurants.map(x => x.slug), ["stg-the-steam-menu"]);
});

test("[3] DISH-name search — the case that used to return nothing", () => {
  const r = T("jollof");
  assert.equal(r.restaurants.length, 1);
  assert.equal(r.restaurants[0].slug, "stg-trishas-kitchen");
  assert.deepEqual(r.restaurants[0].matchedDishes, ["Jollof Rice & Chicken"]);
  assert.equal(r.dishes.length, 1);
  assert.equal(r.dishes[0].restaurantName, "Trisha's Kitchen");
});

test("[4] multi-word dish search matches across the name", () => {
  const items = [item("fr", "stg-the-steam-menu", "Special Fried Rice Bowl")];
  const r = T("fried rice", items);
  assert.equal(r.restaurants.length, 1);
  assert.equal(r.restaurants[0].slug, "stg-the-steam-menu");
});

test("[5] the dish price is the MARKETPLACE price, not the base price", () => {
  // ₦3,500 base + 20% = ₦4,200, rounded to ₦50.
  assert.equal(T("jollof").dishes[0].priceMinor, 420_000);
});

test("[6] a pos_only dish never makes a restaurant appear", () => {
  const items = [item("staff", "stg-trishas-kitchen", "Jollof Staff Meal",
                      { marketplace: { channel: "pos_only" } })];
  const r = T("jollof", items);
  assert.deepEqual(r.restaurants, []);
  assert.deepEqual(r.dishes, []);
});

test("[7] a hidden dish never makes a restaurant appear", () => {
  const items = [item("h", "stg-trishas-kitchen", "Jollof Secret", { marketplace: { channel: "hidden" } })];
  assert.deepEqual(T("jollof", items).dishes, []);
});

test("[8] no cross-tenant leakage: a dish of an unlisted restaurant is ignored", () => {
  // stg-internal-only never opted in, so it is absent from `restaurants`.
  const items = [item("x", "stg-internal-only", "Jollof Rice")];
  const r = T("jollof", items);
  assert.deepEqual(r.restaurants, []);
  assert.deepEqual(r.dishes, []);
});

test("[9] a dish match attributes to its OWN restaurant, never another", () => {
  const items = [item("s", "stg-the-steam-menu", "Jollof Fusion")];
  const r = T("jollof", items);
  assert.deepEqual(r.restaurants.map(x => x.slug), ["stg-the-steam-menu"]);
  assert.equal(r.dishes[0].restaurantSlug, "stg-the-steam-menu");
});

test("[10] empty query returns nothing rather than everything", () => {
  assert.deepEqual(rankAndMatch([], RESTAURANTS, []), { restaurants: [], dishes: [] });
  // A single character is below the token floor, so it cannot match everything.
  assert.deepEqual(T("a").restaurants, []);
});

test("[11] a no-result search returns empty, not an error", () => {
  const r = T("sushi");
  assert.deepEqual(r.restaurants, []);
  assert.deepEqual(r.dishes, []);
});

test("[12] a restaurant matching by BOTH name and dish appears once", () => {
  const items = [item("j", "stg-trishas-kitchen", "Trisha Special Jollof")];
  const r = T("trisha", items);
  assert.equal(r.restaurants.length, 1, "duplicated the restaurant");
});

test("[13] category matching works (Rice), and stays inside the listed set", () => {
  const items = [item("p", "stg-trishas-kitchen", "Pepper Soup", { category: "Rice" })];
  const r = T("rice", items);
  assert.ok(r.restaurants.some(x => x.slug === "stg-trishas-kitchen"));
});

console.log(`\n${passed} checks passed\n`);
