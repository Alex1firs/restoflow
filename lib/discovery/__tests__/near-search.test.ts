// Tests for /near inclusion/exclusion and /search inclusion (Sprint 2.4).
// Run: npx tsx lib/discovery/__tests__/near-search.test.ts

import assert from "node:assert/strict";
import { selectNearby, searchDiscovery } from "../near-search";
import type { DiscoveryRestaurant } from "../types";
import type { GeoStatus } from "../geo";
import { encodeGeohash } from "../geo";

let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`  ✓ ${name}`); };

// Minimal DiscoveryRestaurant builder — only the fields near/search read matter.
function rest(slug: string, geoStatus: GeoStatus, coords: { lat: number; lng: number } | null): DiscoveryRestaurant {
  const location = coords ? { lat: coords.lat, lng: coords.lng, geohash: encodeGeohash(coords.lat, coords.lng), formattedAddress: "addr" } : null;
  return {
    slug, name: slug, description: "", logo: "", coverImage: "",
    fulfillment: { delivery: true, pickup: true, dineIn: false },
    deliveryFee: null, feeDynamic: true, payments: ["Cash"], pickupAddress: null,
    location, geoStatus, state: null, city: null,
    serviceAreas: [], openingHours: null, geoConfirmedAt: geoStatus === "confirmed" ? 1 : null,
    promo: null, taxonomyTags: [], taxonomyVersion: 1,
    popularityScore: 0.5, popularityRaw: 0, popularityOrders: 0,
    visible: true, updatedAt: 0, signalsComputedAt: null, schemaVersion: 1,
  };
}

// Lagos-ish origin.
const ORIGIN = { lat: 6.4541, lng: 3.3947 };
const near1 = { lat: 6.4550, lng: 3.3950 };   // ~0.1 km
const near2 = { lat: 6.4700, lng: 3.4100 };   // ~2.3 km
const far = { lat: 9.0765, lng: 7.3986 };      // Abuja ~525 km

console.log("discovery/near-search");

// ── /near inclusion/exclusion ──
test("/near includes confirmed + geocoded, sorted nearest-first, within radius", () => {
  const list = [
    rest("far-confirmed", "confirmed", far),      // out of radius
    rest("mid-geocoded", "geocoded", near2),
    rest("close-confirmed", "confirmed", near1),
  ];
  const res = selectNearby(list, ORIGIN, { radiusKm: 10 });
  assert.deepEqual(res.results.map((r) => r.slug), ["close-confirmed", "mid-geocoded"]);
  assert.ok(res.results[0].distanceKm < res.results[1].distanceKm);
});

test("/near EXCLUDES missing / failed / none locations and reports the count", () => {
  const list = [
    rest("ok", "confirmed", near1),
    rest("no-coords", "none", null),
    rest("failed", "failed", near1),   // has coords but untrusted
    rest("nostatus", "none", near1),   // coords but status none
  ];
  const res = selectNearby(list, ORIGIN, { radiusKm: 10 });
  assert.deepEqual(res.results.map((r) => r.slug), ["ok"]);
  assert.equal(res.excludedNoUsableLocation, 3); // honest exclusion accounting
  assert.equal(res.totalConsidered, 4);
});

test("/near flags geocoded-not-confirmed as approximate; confirmed is not", () => {
  const res = selectNearby([rest("g", "geocoded", near1), rest("c", "confirmed", near2)], ORIGIN, { radiusKm: 10 });
  const bySlug = Object.fromEntries(res.results.map((r) => [r.slug, r.approximate]));
  assert.equal(bySlug["g"], true);
  assert.equal(bySlug["c"], false);
});

test("/near radius filter: out-of-radius is dropped but NOT counted as no-location", () => {
  const res = selectNearby([rest("abuja", "confirmed", far)], ORIGIN, { radiusKm: 10 });
  assert.equal(res.results.length, 0);
  assert.equal(res.excludedNoUsableLocation, 0); // it HAS a usable location, just too far
});

test("/near respects limit", () => {
  const list = [rest("a", "confirmed", near1), rest("b", "confirmed", near2)];
  assert.equal(selectNearby(list, ORIGIN, { radiusKm: 100, limit: 1 }).results.length, 1);
});

// ── /search inclusion (coordinate-independent) ──
test("/search INCLUDES every visible restaurant regardless of coordinates", () => {
  const list = [
    rest("has-geo", "confirmed", near1),
    rest("no-geo", "none", null),
    rest("failed-geo", "failed", null),
  ];
  const res = searchDiscovery(list); // no origin
  assert.equal(res.length, 3);
  assert.deepEqual(res.map((r) => r.slug).sort(), ["failed-geo", "has-geo", "no-geo"]);
  for (const r of res) assert.equal(r.distanceKm, null); // no origin → no distance
});

test("/search preserves input order (no distance reranking — that's Phase 2.5)", () => {
  const list = [rest("z", "confirmed", far), rest("a", "confirmed", near1)];
  const res = searchDiscovery(list, ORIGIN);
  assert.deepEqual(res.map((r) => r.slug), ["z", "a"]); // order unchanged despite z being farther
});

test("/search annotates distance only for usable pins when origin supplied", () => {
  const res = searchDiscovery([rest("ok", "confirmed", near1), rest("none", "none", null), rest("failed", "failed", near1)], ORIGIN);
  const bySlug = Object.fromEntries(res.map((r) => [r.slug, r.distanceKm]));
  assert.ok(typeof bySlug["ok"] === "number");
  assert.equal(bySlug["none"], null);    // no location
  assert.equal(bySlug["failed"], null);  // untrusted location → no distance claim
});

console.log(`\n${passed} checks passed`);
