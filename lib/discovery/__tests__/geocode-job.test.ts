// Tests for the pure geocode reconciliation job + dry-run zero-write guarantee.
// Run: npx tsx lib/discovery/__tests__/geocode-job.test.ts

import assert from "node:assert/strict";
import { geocodeRestaurants, type GeoCandidate, type GeoUpdate } from "../geocode-job";
import type { GeocodeProvider } from "../geocode-provider";
import type { DiscoveryStore } from "../store";
import type { RawGeocode } from "../geo";

let passed = 0;
const test = (name: string, fn: () => Promise<void>) => fn().then(() => { passed++; console.log(`  ✓ ${name}`); });

const NOW = 1_760_000_000_000;

// Fake store: serves candidates, records geo writes.
class Fake implements DiscoveryStore {
  candidates: GeoCandidate[] = [];
  applied: GeoUpdate[][] = [];
  async getRestaurantsForGeocode() { return this.candidates; }
  async applyRestaurantGeo(u: GeoUpdate[]) { this.applied.push(u); }
  // unused surface
  async getVisibleDiscoveryRestaurants() { return []; }
  async getVisibleDiscoveryDishes() { return []; }
  async getDiscoveryDishById() { return null; }
  async listRestaurantSlugs() { return []; }
  async getRestaurant() { return null; }
  async getMenuItems() { return []; }
  async upsertRestaurant() {}
  async upsertDishes() {}
  async deleteDishesNotIn() {}
  async deleteRestaurant() {}
  async deleteAllDishesForRestaurant() {}
  async getRecentOrders() { return []; }
  async listDiscoveryDishIds() { return []; }
  async listDiscoveryRestaurantSlugs() { return []; }
  async applyDishPopularity() {}
  async applyRestaurantPopularity() {}
  get allWrites() { return this.applied.flat(); }
}

// Fake provider keyed by address substring.
const provider = (map: Record<string, RawGeocode>): GeocodeProvider => ({
  async geocode(address: string) {
    const key = Object.keys(map).find((k) => address.includes(k));
    return key ? map[key] : null;
  },
});

const rooftop = (lat: number, lng: number): RawGeocode =>
  ({ lat, lng, formattedAddress: "resolved", confidence: "ROOFTOP", partialMatch: false });

console.log("discovery/geocode-job");

(async () => {
  await test("geocodes only restaurants that need it; confirmed+unchanged are skipped", async () => {
    const s = new Fake();
    s.candidates = [
      { slug: "a", address: "12 Marina", geoStatus: "none", geoQuery: null },              // needs
      { slug: "b", address: "5 Allen", geoStatus: "confirmed", geoQuery: "5 Allen" },       // skip (owner-confirmed)
      { slug: "c", address: "9 Awolowo", geoStatus: "geocoded", geoQuery: "9 Awolowo" },    // skip (already resolved)
    ];
    const sum = await geocodeRestaurants(s, provider({ "12 Marina": rooftop(6.45, 3.39) }), NOW);
    assert.equal(sum.scanned, 3);
    assert.equal(sum.needing, 1);
    assert.equal(sum.skipped, 2);
    assert.equal(sum.geocoded, 1);
    assert.deepEqual(sum.updates.map((u) => u.slug), ["a"]);
    const a = sum.updates[0];
    assert.equal(a.geoStatus, "geocoded");
    assert.equal(a.geoConfidence, "ROOFTOP");
    assert.equal(a.geoQuery, "12 Marina");
    assert.ok(a.latitude === 6.45 && a.longitude === 3.39 && a.geohash);
  });

  await test("address changed since confirmation → re-geocoded (stale pin refreshed)", async () => {
    const s = new Fake();
    s.candidates = [{ slug: "a", address: "99 New Rd", geoStatus: "confirmed", geoQuery: "12 Old Rd" }];
    const sum = await geocodeRestaurants(s, provider({ "99 New Rd": rooftop(6.5, 3.4) }), NOW);
    assert.equal(sum.needing, 1);
    assert.equal(sum.updates[0].geoStatus, "geocoded"); // demoted from confirmed until re-confirmed
    assert.equal(sum.updates[0].geoQuery, "99 New Rd");
  });

  await test("low-confidence / no-result / provider error all classify as failed (never trusted)", async () => {
    const s = new Fake();
    s.candidates = [
      { slug: "low", address: "vague place", geoStatus: "none", geoQuery: null },
      { slug: "miss", address: "nowhere", geoStatus: "none", geoQuery: null },
      { slug: "boom", address: "explodes", geoStatus: "none", geoQuery: null },
    ];
    const p: GeocodeProvider = {
      async geocode(address) {
        if (address.includes("vague")) return { lat: 6.4, lng: 3.4, formattedAddress: "x", confidence: "APPROXIMATE", partialMatch: false };
        if (address.includes("explodes")) throw new Error("provider 500");
        return null; // "nowhere"
      },
    };
    const sum = await geocodeRestaurants(s, p, NOW);
    assert.equal(sum.geocoded, 0);
    assert.equal(sum.failed, 3);
    for (const u of sum.updates) {
      assert.equal(u.geoStatus, "failed");
      assert.equal(u.latitude, null);
      assert.equal(u.longitude, null);
      assert.equal(u.geohash, null);
    }
    // report explains WHY each one failed (honest diagnostics)
    const reason = Object.fromEntries(sum.report.map((r) => [r.slug, r.reason]));
    assert.equal(reason["low"], "low_confidence");
    assert.equal(reason["miss"], "no_result");
    assert.equal(reason["boom"], "no_result"); // provider threw
  });

  await test("DRY-RUN: readOnly wrapper performs ZERO writes but still reports proposed updates", async () => {
    const s = new Fake();
    s.candidates = [{ slug: "a", address: "12 Marina", geoStatus: "none", geoQuery: null }];

    let writeCalls = 0;
    // Mirror the script's dry-run wrapper: reads pass through (via the prototype
    // chain), writes become no-ops. The real script spreads an object literal
    // store; here `s` is a class instance so we delegate through Object.create.
    const readOnly = Object.assign(Object.create(s) as DiscoveryStore, {
      applyRestaurantGeo: async (u: GeoUpdate[]) => { writeCalls++; void u; /* logged no-op */ },
    });

    const sum = await geocodeRestaurants(readOnly, provider({ "12 Marina": rooftop(6.45, 3.39) }), NOW);
    assert.equal(sum.geocoded, 1, "compute still happens");
    assert.equal(sum.updates.length, 1, "proposed updates are reported");
    assert.equal(s.allWrites.length, 0, "underlying store received NO writes");
    assert.equal(writeCalls, 1, "the no-op write hook was invoked (and did nothing)");
  });

  await test("limit caps the number of geocode calls per run", async () => {
    const s = new Fake();
    s.candidates = [
      { slug: "a", address: "addr a", geoStatus: "none", geoQuery: null },
      { slug: "b", address: "addr b", geoStatus: "none", geoQuery: null },
      { slug: "c", address: "addr c", geoStatus: "none", geoQuery: null },
    ];
    const sum = await geocodeRestaurants(s, provider({ addr: rooftop(6.4, 3.4) }), NOW, { limit: 2 });
    assert.equal(sum.needing, 3);
    assert.equal(sum.updates.length, 2);
  });

  console.log(`\n${passed} checks passed`);
})();
