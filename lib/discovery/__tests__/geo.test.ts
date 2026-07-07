// Unit tests for the pure geo helpers (Sprint 2.4).
// Run: npx tsx lib/discovery/__tests__/geo.test.ts

import assert from "node:assert/strict";
import {
  isValidCoord,
  isPlausibleCoord,
  encodeGeohash,
  geohashPrefixLength,
  haversineKm,
  classifyGeocode,
  isUsableForDistance,
  isApproximateLocation,
  needsGeocode,
  confirmGeo,
  reconcileOnAddressChange,
  type RawGeocode,
} from "../geo";

let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`  ✓ ${name}`); };
const approx = (a: number, b: number, eps: number) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b} (±${eps})`);

console.log("discovery/geo");

// ── Coordinate validation ──
test("isValidCoord accepts in-range, rejects out-of-range / NaN / non-number", () => {
  assert.equal(isValidCoord(6.45, 3.39), true);
  assert.equal(isValidCoord(90, 180), true);
  assert.equal(isValidCoord(91, 0), false);   // lat > 90
  assert.equal(isValidCoord(0, 181), false);  // lng > 180
  assert.equal(isValidCoord(NaN, 0), false);
  assert.equal(isValidCoord("6.4" as unknown as number, 3), false);
  assert.equal(isValidCoord(Infinity, 0), false);
});

test("isPlausibleCoord additionally rejects null-island (0,0)", () => {
  assert.equal(isPlausibleCoord(0, 0), false);
  assert.equal(isPlausibleCoord(6.45, 3.39), true);
});

// ── Geohash ──
test("encodeGeohash matches the canonical fixture", () => {
  // Classic reference point 57.64911,10.40744 → u4pruydqqvj
  assert.equal(encodeGeohash(57.64911, 10.40744, 11), "u4pruydqqvj");
});

test("encodeGeohash is deterministic and honours precision", () => {
  const a = encodeGeohash(6.4531, 3.3958, 9);
  const b = encodeGeohash(6.4531, 3.3958, 9);
  assert.equal(a, b);
  assert.equal(a.length, 9);
  assert.equal(encodeGeohash(6.4531, 3.3958, 5).length, 5);
  assert.ok(a.startsWith(encodeGeohash(6.4531, 3.3958, 5))); // shorter is a prefix of longer
});

test("encodeGeohash throws on invalid coordinates (callers gate first)", () => {
  assert.throws(() => encodeGeohash(999, 0));
});

test("geohashPrefixLength counts shared leading chars", () => {
  assert.equal(geohashPrefixLength("s14fpmk", "s14fzzz"), 4);
  assert.equal(geohashPrefixLength("abc", "xyz"), 0);
});

// ── Distance ──
test("haversineKm ~0 for identical points, known distance for a city pair", () => {
  approx(haversineKm({ lat: 6.45, lng: 3.39 }, { lat: 6.45, lng: 3.39 }), 0, 1e-9);
  // Lagos (6.4541,3.3947) → Abuja (9.0765,7.3986) ≈ 525 km
  approx(haversineKm({ lat: 6.4541, lng: 3.3947 }, { lat: 9.0765, lng: 7.3986 }), 525, 10);
});

// ── Geocode classification (only ROOFTOP is trusted) ──
const raw = (over: Partial<NonNullable<RawGeocode>> = {}): RawGeocode => ({
  lat: 6.45, lng: 3.39, formattedAddress: "12 Marina Rd, Lagos", confidence: "ROOFTOP", partialMatch: false, ...over,
});

test("classifyGeocode: ROOFTOP → geocoded; everything else → failed (with reason)", () => {
  assert.deepEqual(classifyGeocode(raw()), { status: "geocoded", confidence: "ROOFTOP", reason: "resolved" });
  assert.deepEqual(classifyGeocode(raw({ confidence: "RANGE_INTERPOLATED" })), { status: "failed", confidence: "RANGE_INTERPOLATED", reason: "low_confidence" });
  assert.equal(classifyGeocode(raw({ confidence: "GEOMETRIC_CENTER" })).status, "failed");
  assert.equal(classifyGeocode(raw({ confidence: "APPROXIMATE" })).status, "failed");
});

test("classifyGeocode: partial match or null result or bad coords → failed with the right reason", () => {
  // A ROOFTOP-precision result that is a partial match is still rejected — reason makes that explicit.
  assert.deepEqual(classifyGeocode(raw({ partialMatch: true })), { status: "failed", confidence: "ROOFTOP", reason: "partial_match" });
  assert.deepEqual(classifyGeocode(null), { status: "failed", confidence: "NONE", reason: "no_result" });
  assert.equal(classifyGeocode(raw({ lat: 0, lng: 0 })).reason, "invalid_coord"); // null-island
});

// ── Usability / approximate labelling ──
test("isUsableForDistance: confirmed + geocoded usable; none/failed not", () => {
  assert.equal(isUsableForDistance("confirmed"), true);
  assert.equal(isUsableForDistance("geocoded"), true);
  assert.equal(isUsableForDistance("failed"), false);
  assert.equal(isUsableForDistance("none"), false);
  assert.equal(isUsableForDistance(null), false);
});

test("isApproximateLocation: only geocoded (not owner-confirmed) is approximate", () => {
  assert.equal(isApproximateLocation("geocoded"), true);
  assert.equal(isApproximateLocation("confirmed"), false);
});

// ── geoStatus transitions ──
test("needsGeocode: true for none/failed/address-changed; false when resolved for current address", () => {
  assert.equal(needsGeocode({ address: "12 Marina", geoStatus: "none", geoQuery: null }), true);
  assert.equal(needsGeocode({ address: "12 Marina", geoStatus: "failed", geoQuery: "12 Marina" }), true);
  assert.equal(needsGeocode({ address: "", geoStatus: "none", geoQuery: null }), false); // nothing to geocode
  assert.equal(needsGeocode({ address: "12 Marina", geoStatus: "geocoded", geoQuery: "12 Marina" }), false);
  assert.equal(needsGeocode({ address: "12 Marina", geoStatus: "confirmed", geoQuery: "12 Marina" }), false);
  // address changed since it was confirmed → must re-geocode (stale)
  assert.equal(needsGeocode({ address: "99 New Rd", geoStatus: "confirmed", geoQuery: "12 Marina" }), true);
});

test("confirmGeo promotes to confirmed with a recomputed geohash + timestamp", () => {
  const r = confirmGeo({ lat: 6.4531, lng: 3.3958 }, 1000);
  assert.equal(r.geoStatus, "confirmed");
  assert.equal(r.geoConfirmedAtMs, 1000);
  assert.equal(r.geohash, encodeGeohash(6.4531, 3.3958));
});

test("reconcileOnAddressChange downgrades trusted state when the address no longer matches", () => {
  // confirmed pin, address changed → downgrade to none, drop confirmation
  const a = reconcileOnAddressChange({ geoStatus: "confirmed", geoQuery: "12 Marina" }, "99 New Rd");
  assert.deepEqual(a, { changed: true, geoStatus: "none", geoConfirmedAtMs: null });
  // geocoded pin, address changed → downgrade
  assert.equal(reconcileOnAddressChange({ geoStatus: "geocoded", geoQuery: "12 Marina" }, "99 New Rd").geoStatus, "none");
  // address unchanged → no downgrade
  assert.equal(reconcileOnAddressChange({ geoStatus: "confirmed", geoQuery: "12 Marina" }, "12 Marina").changed, false);
  // failed/none are not "trusted" → nothing to downgrade
  assert.equal(reconcileOnAddressChange({ geoStatus: "failed", geoQuery: "x" }, "y").changed, false);
});

console.log(`\n${passed} checks passed`);
