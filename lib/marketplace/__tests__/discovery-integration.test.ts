/**
 * Customer discovery integration — the product rules, as assertions.
 *
 * Every test here corresponds to a decision that was made deliberately, and
 * most of them correspond to a defect that was live before this work:
 * restaurants that had not opted in were eligible to appear, a configured
 * delivery radius did nothing, and a restaurant with no opening hours was
 * advertised as Open.
 *
 *   npx tsx lib/marketplace/__tests__/discovery-integration.test.ts
 */
import assert from "node:assert/strict";
import { buildHomeFeed } from "../feed";
import { deliverabilityOf, toCard, etaMinsFor } from "../deliverability";
import { searchMarketplaceRestaurants } from "../discovery-search";
import { computeMarketplaceVisibility, projectRestaurant, projectDish, restaurantSnapshotOf } from "@/lib/discovery/project";
import { openStateOf } from "@/lib/restaurant-utils";
import type { DiscoveryDish, DiscoveryRestaurant, SourceRestaurant } from "@/lib/discovery/types";

let passed = 0;
const test = (name: string, fn: () => void) => {
  try { fn(); passed++; console.log("  ✓ " + name); }
  catch (e) { console.error("  ✗ " + name + "\n    " + (e as Error).message); process.exitCode = 1; }
};
// ── Index maintenance ────────────────────────────────────────────────────────

test("[23] every menu write nudges the index", () => {
  // Menu edits are written to Firestore straight from the admin client, so
  // nothing server-side observes them. A write path that forgets this call is
  // a dish that stays invisible until the nightly reconcile.
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const { join } = require("node:path") as typeof import("node:path");
  const root = join(__dirname, "..", "..", "..");
  const client = readFileSync(join(root, "app/admin/[slug]/menu/AdminMenuClient.tsx"), "utf8");

  const writes = (client.match(/await (addDoc|updateDoc|deleteDoc)\(/g) ?? []).length;
  const nudges = (client.match(/void refreshDiscovery\(\)/g) ?? []).length;
  assert.ok(writes > 0, "guard: expected menu writes in the admin client");
  assert.equal(nudges, writes, `${writes} menu writes but ${nudges} index refreshes`);
  assert.match(client, /\/api\/admin\/discovery\/reindex/);
});

test("[24] the reindex endpoint takes its slug from the session, not the caller", () => {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const { join } = require("node:path") as typeof import("node:path");
  const route = readFileSync(join(__dirname, "..", "..", "..", "app/api/admin/discovery/reindex/route.ts"), "utf8");
  assert.match(route, /user\.restaurantSlug/);
  assert.ok(!/req\.json\(\)/.test(route),
    "accepting a caller-supplied slug would let anyone ask the server to read another restaurant's menu");
});

test("[25] a scheduled reconcile exists as the backstop", () => {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const { join } = require("node:path") as typeof import("node:path");
  const root = join(__dirname, "..", "..", "..");
  const vercel = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8")) as { crons?: { path: string }[] };
  assert.ok((vercel.crons ?? []).some((c) => c.path === "/api/cron/discovery"),
    "no scheduled reconcile — popularity would never be recomputed");
  const cron = readFileSync(join(root, "app/api/cron/discovery/route.ts"), "utf8");
  assert.match(cron, /CRON_SECRET/);
  assert.match(cron, /recomputePopularity/);
});

test("[26] no CLI script hardcodes which environment it writes to", () => {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const { join } = require("node:path") as typeof import("node:path");
  const root = join(__dirname, "..", "..", "..");
  for (const f of ["scripts/discovery-backfill.ts", "scripts/discovery-popularity.ts", "scripts/discovery-geocode.ts"]) {
    const src = readFileSync(join(root, f), "utf8");
    assert.ok(!/config\(\{ path: "\.env\.local" \}\)/.test(src),
      `${f} hardcodes .env.local — a "staging" run could read production`);
  }
});

console.log("\nmarketplace/discovery-integration\n");

const NOW = Date.UTC(2026, 8, 12, 12, 0, 0);
const LAGOS = { lat: 6.4474, lng: 3.4736 };

function source(over: Partial<SourceRestaurant> = {}): SourceRestaurant {
  return {
    slug: "r1", name: "R1", status: "live", subscriptionStatus: "active",
    marketplaceEnabled: true, deliveryRadiusKm: 5,
    prepTimeMins: { min: 20, max: 40 }, minOrderMinor: null,
    marketplaceCuisines: ["Nigerian"], latitude: LAGOS.lat, longitude: LAGOS.lng,
    geoStatus: "confirmed", geoConfirmedAtMs: 1, ...over,
  };
}

function rest(over: Partial<SourceRestaurant> = {}, mutate: Partial<DiscoveryRestaurant> = {}): DiscoveryRestaurant {
  return { ...projectRestaurant(source(over), NOW), ...mutate };
}

// ── The hard gate ────────────────────────────────────────────────────────────

test("[1] a live SaaS tenant that never opted in is not a marketplace restaurant", () => {
  // The stg-internal-only case. Being a paying RestoFlow customer is not
  // consent to appear in the consumer app.
  assert.equal(computeMarketplaceVisibility(source({ marketplaceEnabled: false }), NOW), false);
  assert.equal(computeMarketplaceVisibility(source({ marketplaceEnabled: undefined }), NOW), false);
  assert.equal(computeMarketplaceVisibility(source(), NOW), true);
});

test("[2] the marketplace gate is stricter than the storefront gate, never looser", () => {
  for (const over of [{ status: "draft" }, { status: "suspended" }, { subscriptionStatus: "expired", subscriptionEndDateMs: 0 }]) {
    assert.equal(computeMarketplaceVisibility(source(over as Partial<SourceRestaurant>), NOW), false);
  }
});

test("[3] a dish is never more visible than its restaurant", () => {
  const snap = restaurantSnapshotOf(source({ marketplaceEnabled: false }));
  const d = projectDish({ id: "d1", restaurantId: "r1", name: "Jollof", price: 3000 }, snap, true, NOW, false, null);
  assert.equal(d.marketplaceVisible, false, "an opted-out restaurant's dishes must not be marketplace-visible");
});

// ── Deliverability ───────────────────────────────────────────────────────────

test("[4] a configured delivery radius is enforced, not decoration", () => {
  assert.equal(deliverabilityOf({ radiusKm: 5, distanceKm: 4.9 }), "deliverable");
  assert.equal(deliverabilityOf({ radiusKm: 5, distanceKm: 5.1 }), "out_of_range");
});

test("[5] no distance means unknown, never yes", () => {
  // The shape of the original bug: absence of evidence read as permission.
  assert.equal(deliverabilityOf({ radiusKm: 5, distanceKm: null }), "unknown");
  assert.equal(deliverabilityOf({ radiusKm: null, distanceKm: null }), "unknown");
});

test("[6] out-of-range restaurants are excluded from the feed, not merely demoted", () => {
  const far = rest({ slug: "far", latitude: 6.6, longitude: 3.9, deliveryRadiusKm: 1 });
  const near = rest({ slug: "near" });
  const feed = buildHomeFeed({ restaurants: [far, near], at: LAGOS });
  const slugs = feed.nearYou.map((c) => c.slug);
  assert.deepEqual(slugs, ["near"]);
  assert.ok(!feed.featured.some((c) => c.slug === "far"));
});

test("[7] an address nothing delivers to gets the empty state, not a consolation list", () => {
  const far = rest({ slug: "far", latitude: 6.6, longitude: 3.9, deliveryRadiusKm: 1 });
  const feed = buildHomeFeed({ restaurants: [far], at: LAGOS });
  assert.equal(feed.noCoverage, true);
  assert.equal(feed.nearYou.length, 0);
  assert.equal(feed.featured.length, 0);
});

// ── Location ─────────────────────────────────────────────────────────────────

test("[8] Near You does not render without a delivery location", () => {
  const feed = buildHomeFeed({ restaurants: [rest(), rest({ slug: "r2" })], at: null });
  assert.equal(feed.hasLocation, false);
  assert.deepEqual(feed.nearYou, [], "arbitrary order must not be presented as proximity");
  assert.deepEqual(feed.fastDelivery, []);
  assert.deepEqual(feed.popularAroundYou, []);
});

test("[9] no location is not the same as no coverage", () => {
  // Without an address we cannot know whether anything delivers, so the empty
  // state must not accuse the platform of not covering the customer.
  const feed = buildHomeFeed({ restaurants: [rest()], at: null });
  assert.equal(feed.noCoverage, false);
});

// ── Opening hours ────────────────────────────────────────────────────────────

test("[10] missing opening hours are unknown, never open", () => {
  assert.equal(openStateOf(null), "unknown");
  assert.equal(openStateOf({}), "unknown");
});

test("[11] an unknown opening state produces no Open badge and no Closed badge", () => {
  const card = toCard(rest({}, {}), LAGOS);
  assert.equal(card.openState, "unknown");
  assert.equal(card.isOpen, false, "must not claim open");
  assert.equal(card.opensAt, null, "must not claim closed either");
});

// ── Popularity ───────────────────────────────────────────────────────────────

test("[12] Popular Around You requires genuine orders, not the cold-start score", () => {
  const neutral = rest({ slug: "cold" });                       // popularityOrders 0
  const real = rest({ slug: "hot" }, { popularityOrders: 12, popularityScore: 0.9 });
  const feed = buildHomeFeed({ restaurants: [neutral, real], at: LAGOS });
  assert.deepEqual(feed.popularAroundYou.map((c) => c.slug), ["hot"]);
});

// ── Sections without data stay hidden ────────────────────────────────────────

test("[13] Local Favourites and New on RestoFlow stay hidden", () => {
  // Approved product decision: hide rather than duplicate Popular Around You,
  // and hide rather than invent an onboarding date.
  const feed = buildHomeFeed({
    restaurants: [rest({ slug: "a" }, { popularityOrders: 30, popularityScore: 1 })],
    at: LAGOS,
  });
  assert.deepEqual(feed.localFavourites, []);
  assert.deepEqual(feed.newOnRestoflow, []);
  assert.notDeepEqual(feed.popularAroundYou, [], "guard: this fixture does have popularity");
});

test("[14] Order Again comes from real history and is empty without it", () => {
  const a = rest({ slug: "a" });
  const b = rest({ slug: "b" });
  assert.deepEqual(buildHomeFeed({ restaurants: [a, b], at: LAGOS }).orderAgain, []);
  const feed = buildHomeFeed({ restaurants: [a, b], at: LAGOS, orderAgainSlugs: ["b"] });
  assert.deepEqual(feed.orderAgain.map((c) => c.slug), ["b"]);
});

test("[15] Order Again never resurrects a restaurant that cannot deliver now", () => {
  const far = rest({ slug: "far", latitude: 6.6, longitude: 3.9, deliveryRadiusKm: 1 });
  const feed = buildHomeFeed({ restaurants: [far], at: LAGOS, orderAgainSlugs: ["far"] });
  assert.deepEqual(feed.orderAgain, []);
});

// ── Price ────────────────────────────────────────────────────────────────────

test("[16] no customer-facing price originates from the discovery index", () => {
  const card = toCard(rest(), LAGOS);
  const keys = Object.keys(card);
  for (const k of keys) {
    assert.ok(!/^price|Price$/.test(k), `card exposes a price field: ${k}`);
  }
  // The one money-shaped field is the restaurant's own minimum-order setting,
  // which is a threshold, not a price for anything.
  assert.ok(keys.includes("minOrderMinor"));
  assert.equal(card.deliveryFeeMinor, null, "delivery is priced by Dispatcher at checkout");
});

test("[17] the feed carries no dish prices at all", () => {
  const feed = buildHomeFeed({ restaurants: [rest()], at: LAGOS });
  assert.deepEqual(feed.popularDishes, [], "dish cards would need prices the index must not supply");
  assert.ok(!JSON.stringify(feed).includes('"price"'));
});

// ── Search ───────────────────────────────────────────────────────────────────

function dishOf(slug: string, name: string, visible = true): DiscoveryDish {
  const snap = restaurantSnapshotOf(source({ slug }));
  return { ...projectDish({ id: name, restaurantId: slug, name, price: 2500 }, snap, true, NOW, false, null), marketplaceVisible: visible };
}

test("[18] search finds a restaurant by one of its dishes and says which", () => {
  const r = rest();
  const res = searchMarketplaceRestaurants({
    q: "jollof", at: LAGOS, nowMs: NOW, restaurants: [r], dishes: [dishOf("r1", "Jollof Rice")],
  });
  assert.equal(res.restaurants.length, 1);
  assert.deepEqual(res.restaurants[0].matchedDishes, ["Jollof Rice"]);
});

test("[19] search excludes out-of-range restaurants and says there is no coverage", () => {
  const far = rest({ slug: "far", latitude: 6.6, longitude: 3.9, deliveryRadiusKm: 1 });
  const res = searchMarketplaceRestaurants({
    q: "jollof", at: LAGOS, nowMs: NOW, restaurants: [far], dishes: [dishOf("far", "Jollof Rice")],
  });
  assert.deepEqual(res.restaurants, []);
  assert.equal(res.noCoverage, true);
});

test("[20] search returns no prices", () => {
  const res = searchMarketplaceRestaurants({
    q: "jollof", at: LAGOS, nowMs: NOW, restaurants: [rest()], dishes: [dishOf("r1", "Jollof Rice")],
  });
  assert.deepEqual(res.dishes, []);
  assert.ok(!JSON.stringify(res).includes('"price"'));
});

// ── Parity with the path being retired ───────────────────────────────────────

test("[21] parity: the retired scan finds nothing the discovery search misses", () => {
  // The old implementation matched restaurant name, cuisine and dish name. The
  // new one must be a superset for the same inputs, or retiring it loses
  // results a customer could previously find.
  const r = rest({ slug: "r1", name: "Trisha's Kitchen", marketplaceCuisines: ["Nigerian"] });
  for (const q of ["trisha", "nigerian", "jollof"]) {
    const res = searchMarketplaceRestaurants({
      q, at: LAGOS, nowMs: NOW, restaurants: [r], dishes: [dishOf("r1", "Jollof Rice")],
    });
    assert.equal(res.restaurants.length, 1, `"${q}" found nothing`);
  }
});

// ── ETA ──────────────────────────────────────────────────────────────────────

test("[22] ETA needs a distance and admits when it has none", () => {
  const r = rest();
  assert.equal(etaMinsFor(r, null), 40, "falls back to the slow end of prep, not a guess at travel");
  assert.ok(etaMinsFor(r, 5)! > 20, "travel time is added to prep");
});

console.log(`\n${passed} checks passed\n`);
