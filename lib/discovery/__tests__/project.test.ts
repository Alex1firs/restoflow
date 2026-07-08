// Unit tests for the pure discovery projection.
// Run: npx tsx lib/discovery/__tests__/project.test.ts

import assert from "node:assert/strict";
import {
  computeVisibility,
  projectRestaurant,
  restaurantSnapshotOf,
  projectDish,
} from "../project";
import { NEUTRAL_POPULARITY, type SourceMenuItem, type SourceRestaurant } from "../types";

let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`  ✓ ${name}`); };

const NOW = 1_760_000_000_000; // fixed "now"
const DAY = 86_400_000;

const baseR: SourceRestaurant = {
  slug: "kapitol",
  name: "Kapitol Grills",
  description: "African grills",
  logo: "logo.png",
  coverImage: "cover.png",
  address: "12 Marina Rd, Lagos",
  status: "live",
  subscriptionStatus: "active",
  subscriptionEndDateMs: NOW + 30 * DAY,
  deliveryEnabled: true,
  pickupEnabled: true,
  dineInEnabled: false,
  deliveryFee: 0,
  deliveryZones: [],
  payOnDeliveryEnabled: true,
  onlinePaymentEnabled: true,
  whatsappCheckoutEnabled: false,
  hidePrices: false,
  openingHours: { "1": { open: true, from: "09:00", to: "21:00" } },
  serviceAreas: ["Yaba"],
  promo: null,
};

console.log("discovery/project");

// ── Visibility matrix ──
test("live + active subscription → visible", () => {
  assert.equal(computeVisibility(baseR, NOW), true);
});
test("non-live statuses are hidden (draft/pending/rejected/suspended)", () => {
  for (const status of ["draft", "pending", "rejected", "suspended", undefined]) {
    assert.equal(computeVisibility({ ...baseR, status }, NOW), false, `status=${status}`);
  }
});
test("expired subscription (past grace) → hidden", () => {
  assert.equal(computeVisibility({ ...baseR, subscriptionEndDateMs: NOW - 10 * DAY }, NOW), false);
});
test("within 3-day grace window → still visible", () => {
  assert.equal(computeVisibility({ ...baseR, subscriptionEndDateMs: NOW - 2 * DAY }, NOW), true);
});
test("no end date but subscriptionStatus 'expired' → hidden", () => {
  assert.equal(computeVisibility({ ...baseR, subscriptionEndDateMs: null, subscriptionStatus: "expired" }, NOW), false);
});

// ── Restaurant projection ──
test("projects safe restaurant fields with placeholders for later phases", () => {
  const d = projectRestaurant(baseR, NOW);
  assert.equal(d.slug, "kapitol");
  assert.equal(d.visible, true);
  assert.deepEqual(d.fulfillment, { delivery: true, pickup: true, dineIn: false });
  assert.equal(d.pickupAddress, "12 Marina Rd, Lagos");
  assert.deepEqual(d.taxonomyTags, []);           // 2.2
  assert.equal(d.popularityScore, NEUTRAL_POPULARITY); // 2.3 baseline
  assert.equal(d.location, null);                 // 2.4 — no usable geo yet
  assert.equal(d.geoStatus, "none");              // 2.4
  assert.equal(d.geoConfirmedAt, null);           // 2.4
  assert.equal(d.signalsComputedAt, null);
});

// ── Geo projection (2.4) ──
test("location projected ONLY for usable geo (confirmed / high-confidence geocoded)", () => {
  const coords = { latitude: 6.4531, longitude: 3.3958, geohash: "s14fpmk" };
  // failed / none / missing status → no location, even with coords present
  assert.equal(projectRestaurant({ ...baseR, ...coords, geoStatus: "failed" }, NOW).location, null);
  assert.equal(projectRestaurant({ ...baseR, ...coords, geoStatus: "none" }, NOW).location, null);
  // geocoded (approximate) → usable
  const geo = projectRestaurant({ ...baseR, ...coords, geoStatus: "geocoded" }, NOW);
  assert.equal(geo.location?.lat, 6.4531);
  assert.equal(geo.geoStatus, "geocoded");
  assert.equal(geo.geoConfirmedAt, null); // not owner-confirmed
  // confirmed → usable + geoConfirmedAt surfaced
  const conf = projectRestaurant({ ...baseR, ...coords, geoStatus: "confirmed", geoConfirmedAtMs: NOW - DAY }, NOW);
  assert.equal(conf.location?.lng, 3.3958);
  assert.equal(conf.geoConfirmedAt, NOW - DAY);
});

test("invalid coordinates never yield a location even when status says usable", () => {
  assert.equal(projectRestaurant({ ...baseR, latitude: 999, longitude: 3.3, geoStatus: "confirmed" }, NOW).location, null);
});

// ── Structured location (G1) ──
test("state/city projected when present, trimmed; null when absent/blank", () => {
  const d = projectRestaurant({ ...baseR, state: "  Anambra ", city: "Onitsha" }, NOW);
  assert.equal(d.state, "Anambra");
  assert.equal(d.city, "Onitsha");
  const none = projectRestaurant({ ...baseR, state: "   ", city: undefined }, NOW);
  assert.equal(none.state, null);
  assert.equal(none.city, null);
  // dish snapshot carries them too (card labeling)
  const snap = restaurantSnapshotOf({ ...baseR, state: "Lagos", city: "Ajah" });
  assert.equal(snap.state, "Lagos");
  assert.equal(snap.city, "Ajah");
});

test("payments list only enabled methods", () => {
  assert.deepEqual(projectRestaurant(baseR, NOW).payments, ["Pay online", "Cash"]);
  assert.deepEqual(projectRestaurant({ ...baseR, hidePrices: true }, NOW).payments, ["Cash"]);
  assert.deepEqual(projectRestaurant({ ...baseR, onlinePaymentEnabled: false, whatsappCheckoutEnabled: true }, NOW).payments, ["Cash", "WhatsApp order"]);
});

test("delivery fee: flat>0 known, zones dynamic, 0/unset dynamic (never 'free')", () => {
  assert.deepEqual((() => { const d = projectRestaurant({ ...baseR, deliveryFee: 1500 }, NOW); return [d.deliveryFee, d.feeDynamic]; })(), [1500, false]);
  assert.deepEqual((() => { const d = projectRestaurant({ ...baseR, deliveryZones: [{ id: "a", name: "VI", fee: 1000 }] }, NOW); return [d.deliveryFee, d.feeDynamic]; })(), [null, true]);
  assert.deepEqual((() => { const d = projectRestaurant({ ...baseR, deliveryFee: 0, deliveryZones: [] }, NOW); return [d.deliveryFee, d.feeDynamic]; })(), [null, true]);
});

test("pickupAddress only when pickup enabled + address present", () => {
  assert.equal(projectRestaurant({ ...baseR, pickupEnabled: false }, NOW).pickupAddress, null);
  assert.equal(projectRestaurant({ ...baseR, address: "" }, NOW).pickupAddress, null);
});

test("serviceAreas merge zone names + seo areas (deduped)", () => {
  const d = projectRestaurant({ ...baseR, deliveryZones: [{ id: "a", name: "Yaba", fee: 500 }, { id: "b", name: "Surulere", fee: 700 }], serviceAreas: ["Yaba", "Ikeja"] }, NOW);
  assert.deepEqual(d.serviceAreas, ["Yaba", "Surulere", "Ikeja"]);
});

// ── Dish projection ──
const item: SourceMenuItem = { id: "d1", restaurantId: "kapitol", name: "Jollof Rice", description: "party jollof", price: 4500, category: "Rice Dishes", available: true, image: "jollof.png" };

test("dish projection: normalized categoryKey, availability, snapshot embed", () => {
  const snap = restaurantSnapshotOf(baseR);
  const d = projectDish(item, snap, true, NOW, false, null);
  assert.equal(d.dishId, "d1");
  assert.equal(d.restaurantSlug, "kapitol");
  assert.equal(d.price, 4500);
  assert.equal(d.priceHidden, false);
  assert.equal(d.rawCategory, "Rice Dishes"); // preserved un-normalized (non-destructive)
  assert.equal(d.categoryKey, "rice dishes"); // normalizeCategoryKey
  assert.deepEqual(d.taxonomyTags, ["rice-jollof"]); // derived at index time
  assert.equal(d.available, true);
  assert.equal(d.visible, true);
  assert.equal(d.restaurantSnapshot.slug, "kapitol");
  assert.equal(d.popularityScore, NEUTRAL_POPULARITY);
});

test("hidePrices → dish price null", () => {
  const snap = restaurantSnapshotOf({ ...baseR, hidePrices: true });
  const d = projectDish(item, snap, true, NOW, true, null);
  assert.equal(d.price, null);
  assert.equal(d.priceHidden, true);
});

test("dish image falls back to cover/logo when item has none", () => {
  const snap = restaurantSnapshotOf(baseR);
  const d = projectDish({ ...item, image: undefined }, snap, true, NOW, false, null);
  assert.equal(d.image, "cover.png");
});

// ── Whitelist / no-PII guarantee ──
test("projected RESTAURANT contains ONLY allowlisted keys (no PII can leak)", () => {
  // Hand the projector a fat source object with sensitive junk.
  const dirty = { ...baseR, phone: "0803...", ownerEmail: "a@b.com", paystackSubaccountCode: "ACCT_x", subscriptionEndDateMs: NOW + DAY } as SourceRestaurant;
  const d = projectRestaurant(dirty, NOW);
  const allowed = ["slug","name","description","logo","coverImage","fulfillment","deliveryFee","feeDynamic","payments","pickupAddress","location","geoStatus","state","city","geoConfirmedAt","serviceAreas","openingHours","promo","taxonomyTags","taxonomyVersion","popularityScore","popularityRaw","popularityOrders","visible","updatedAt","signalsComputedAt","schemaVersion"].sort();
  assert.deepEqual(Object.keys(d).sort(), allowed);
  const blob = JSON.stringify(d);
  for (const secret of ["0803", "a@b.com", "ACCT_x", "paystack"]) assert.ok(!blob.includes(secret), `must not contain ${secret}`);
});

test("projected DISH contains ONLY allowlisted keys", () => {
  const snap = restaurantSnapshotOf(baseR);
  const d = projectDish({ ...item, restaurantId: "kapitol" }, snap, true, NOW, false, null);
  const allowed = ["dishId","restaurantSlug","name","description","price","priceHidden","image","available","rawCategory","categoryKey","taxonomyTags","taxonomyVersion","popularityScore","popularityRaw","popularityOrders","promo","restaurantSnapshot","visible","updatedAt","signalsComputedAt","schemaVersion"].sort();
  assert.deepEqual(Object.keys(d).sort(), allowed);
});

console.log(`\n${passed} checks passed`);
