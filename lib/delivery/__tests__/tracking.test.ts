// Tracking authorisation: IDOR, lifetime, granularity, staleness.
// Run: npx tsx lib/delivery/__tests__/tracking.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DeliveryState } from "../contract";
import { initialProjection, type DeliveryProjection } from "../projection";
import type { DeliveryOrderView } from "../store";
import {
  authorizeTracking, buildTrackingPayload, pollIntervalMs,
  LOCATION_STALE_AFTER_MS, LOCATION_MAX_AGE_MS,
} from "../tracking";

let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`  ✓ ${name}`); };
console.log("delivery/tracking");

const T0 = 1_756_000_000_000;

const order = (over: Partial<DeliveryProjection> = {}, customerId = "cust-a"): DeliveryOrderView => ({
  orderId: "RF-1", restaurantId: "trishas", customerId, restaurantProgress: "preparing",
  delivery: {
    ...initialProjection({ correlationId: "c", quoteId: "q", nowMs: T0 }),
    deliveryJobId: "DJ-1", state: "EN_ROUTE_TO_CUSTOMER",
    ...over,
  },
});

test("[1] the owning customer may track their own active delivery", () => {
  const d = authorizeTracking({ order: order(), requestingCustomerId: "cust-a" });
  assert.equal(d.allowed, true);
  assert.equal((d as { deliveryJobId: string }).deliveryJobId, "DJ-1");
});

test("[2] IDOR: another customer gets `not_found`, indistinguishable from absent", () => {
  const other = authorizeTracking({ order: order(), requestingCustomerId: "cust-b" });
  const absent = authorizeTracking({ order: null, requestingCustomerId: "cust-b" });
  assert.equal(other.allowed, false);
  assert.equal(absent.allowed, false);
  assert.equal((other as { reason: string }).reason, (absent as { reason: string }).reason);
  assert.equal((other as { reason: string }).reason, "not_found");
});

test("[3] an order with no customer on it is not trackable by anyone", () => {
  const d = authorizeTracking({ order: order({}, ""), requestingCustomerId: "" });
  assert.equal(d.allowed, false);
  assert.equal((d as { reason: string }).reason, "not_found");
});

test("[4] LIFETIME: no location before a rider is assigned", () => {
  for (const s of ["REQUESTED", "SEARCHING_FOR_DRIVER"] as const) {
    const d = authorizeTracking({ order: order({ state: s }), requestingCustomerId: "cust-a" });
    assert.equal(d.allowed, false, s);
    assert.equal((d as { reason: string }).reason, "not_yet_assigned");
  }
});

test("[5] LIFETIME: access ends permanently at a terminal state", () => {
  for (const s of ["DELIVERED", "DELIVERY_FAILED", "CANCELLED"] as const) {
    const d = authorizeTracking({ order: order({ state: s }), requestingCustomerId: "cust-a" });
    assert.equal(d.allowed, false, s);
    assert.equal((d as { reason: string }).reason, "completed");
  }
});

test("[6] a delivery with no job id yet is not trackable", () => {
  const d = authorizeTracking({ order: order({ deliveryJobId: null }), requestingCustomerId: "cust-a" });
  assert.equal(d.allowed, false);
});

test("[7] every non-terminal assigned state is trackable", () => {
  const states: DeliveryState[] = ["DRIVER_ASSIGNED", "DRIVER_TO_PICKUP", "ARRIVED_AT_PICKUP",
    "WAITING_FOR_ORDER", "PICKED_UP", "EN_ROUTE_TO_CUSTOMER", "ARRIVING"];
  for (const s of states) {
    assert.equal(authorizeTracking({ order: order({ state: s }), requestingCustomerId: "cust-a" }).allowed, true, s);
  }
});

const payload = (over: Partial<Parameters<typeof buildTrackingPayload>[0]> = {}) =>
  buildTrackingPayload({
    state: "EN_ROUTE_TO_CUSTOMER", headline: "On the way", detail: null, showMap: true,
    driver: { firstName: "Kelechi", photoUrl: null, vehicle: "Bike", contactHandle: "h" },
    raw: { lat: 6.4531234567, lng: 3.3912345678, recordedAtMs: T0 },
    etaToDropoffMins: 12, nowMs: T0,
    ...over,
  });

test("[8] GRANULARITY: coordinates are coarsened server-side to ~11 m", () => {
  const p = payload();
  assert.equal(p.location!.lat, 6.4531);
  assert.equal(p.location!.lng, 3.3912);
  assert.equal(String(p.location!.lat).split(".")[1].length <= 4, true);
});

test("[9] a fix within the freshness window is live", () => {
  const p = payload({ nowMs: T0 + LOCATION_STALE_AFTER_MS - 1_000 });
  assert.equal(p.location!.stale, false);
});

test("[10] an ageing fix is flagged stale rather than drawn as live", () => {
  const p = payload({ nowMs: T0 + LOCATION_STALE_AFTER_MS + 1_000 });
  assert.equal(p.location!.stale, true);
});

test("[11] a fix past the max age is WITHHELD, and the map is hidden with it", () => {
  const p = payload({ nowMs: T0 + LOCATION_MAX_AGE_MS + 1_000 });
  assert.equal(p.location, null);
  assert.equal(p.showMap, false, "a map with no marker is worse than no map");
});

test("[12] no position at all still returns a valid, renderable payload", () => {
  const p = payload({ raw: null });
  assert.equal(p.location, null);
  assert.equal(p.showMap, false);
  assert.equal(p.driver?.firstName, "Kelechi");
  assert.equal(p.state, "EN_ROUTE_TO_CUSTOMER");
});

test("[13] the payload carries no rider identity beyond the public projection", () => {
  const p = payload();
  assert.deepEqual(Object.keys(p.driver!).sort(), ["contactHandle", "firstName", "photoUrl", "vehicle"]);
  const serialised = JSON.stringify(p);
  for (const leak of ["riderId", "driverId", "phone", "deliveryBoyId", "uid"]) {
    assert.equal(serialised.includes(leak), false, leak);
  }
});

test("[14] poll cadence tightens near arrival and stops at terminal", () => {
  assert.equal(pollIntervalMs("ARRIVING"), 5_000);
  assert.equal(pollIntervalMs("EN_ROUTE_TO_CUSTOMER"), 8_000);
  assert.equal(pollIntervalMs("DRIVER_ASSIGNED"), 15_000);
  assert.equal(pollIntervalMs("SEARCHING_FOR_DRIVER"), 30_000);
  assert.equal(pollIntervalMs("DELIVERED"), null, "a finished delivery must stop being polled");
  assert.equal(pollIntervalMs("CANCELLED"), null);
});

test("a marketplace order's acceptance is visible to tracking", () => {
  // Regression found on staging: `toProgress` read `fulfillment.state`, but the
  // marketplace machine writes `fulfillment.restaurantState`. Every marketplace
  // order therefore fell through to the legacy `status` field — which maps
  // `accepted` to "pending" — and the customer's tracking screen said the order
  // was still waiting for the restaurant that had already accepted it.
  const src = readFileSync(join(__dirname, "..", "firestore-store.ts"), "utf8");
  assert.match(src, /fulfilment\.restaurantState \?\? fulfilment\.state/,
    "toProgress must prefer the marketplace state machine's own field");
});

console.log(`\n${passed} checks passed\n`);
