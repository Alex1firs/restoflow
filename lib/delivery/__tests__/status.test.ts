// Dispatcher → canonical → customer-facing translation, and the order reducer.
// Run: npx tsx lib/delivery/__tests__/status.test.ts

import assert from "node:assert/strict";
import { DELIVERY_STATES, type DeliveryState } from "../contract";
import {
  toCanonicalState, toCustomerFacing, reduceOrderState, deriveWaitingForOrder,
  trackingAllowed, failureToCustomerDetail, unserviceableToCustomerDetail,
} from "../status";

let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`  ✓ ${name}`); };
console.log("delivery/status");

test("[1] Dispatcher's own statuses map to canonical states", () => {
  assert.equal(toCanonicalState({ status: "draft" }), "REQUESTED");
  assert.equal(toCanonicalState({ status: "pending" }), "SEARCHING_FOR_DRIVER");
  assert.equal(toCanonicalState({ status: "accepted" }), "DRIVER_ASSIGNED");
  assert.equal(toCanonicalState({ status: "assigned" }), "DRIVER_ASSIGNED");
  assert.equal(toCanonicalState({ status: "completed" }), "DELIVERED");
  assert.equal(toCanonicalState({ status: "cancelled" }), "CANCELLED");
  assert.equal(toCanonicalState({ status: "returned_to_sender" }), "DELIVERY_FAILED");
  assert.equal(toCanonicalState({ status: "declined" }), "REASSIGNING");
});

test("[2] THE in_progress SPLIT: pickup is what separates the two legs", () => {
  assert.equal(toCanonicalState({ status: "in_progress" }), "DRIVER_TO_PICKUP");
  assert.equal(toCanonicalState({ status: "in_progress", arrivedAtPickupAt: 1 }), "ARRIVED_AT_PICKUP");
  assert.equal(toCanonicalState({ status: "in_progress", pickedUpAt: 2 }), "EN_ROUTE_TO_CUSTOMER");
  // pickup dominates arrival — a rider who has the food is past the counter
  assert.equal(toCanonicalState({ status: "in_progress", arrivedAtPickupAt: 1, pickedUpAt: 2 }), "EN_ROUTE_TO_CUSTOMER");
});

test("[3] `pending` is two different things, told apart only by `reassigning`", () => {
  assert.equal(toCanonicalState({ status: "pending" }), "SEARCHING_FOR_DRIVER");
  assert.equal(toCanonicalState({ status: "pending", reassigning: true }), "REASSIGNING");
});

test("[4] an unknown status returns null — never a guessed default", () => {
  assert.equal(toCanonicalState({ status: "teleported" }), null);
  assert.equal(toCanonicalState({ status: "" }), null);
});

test("[5] mapping is case- and whitespace-tolerant", () => {
  assert.equal(toCanonicalState({ status: " ACCEPTED " }), "DRIVER_ASSIGNED");
});

test("[6] every canonical state produces customer copy with a headline", () => {
  for (const s of DELIVERY_STATES) {
    const c = toCustomerFacing(s as DeliveryState);
    assert.ok(c.headline.length > 0, s);
  }
});

test("[7] the customer NEVER sees an internal state name or failure code", () => {
  const internal = [...DELIVERY_STATES, "returned_to_sender", "in_progress", "deliveryBoy"];
  for (const s of DELIVERY_STATES) {
    const c = toCustomerFacing(s as DeliveryState);
    const text = `${c.headline} ${c.detail ?? ""}`;
    for (const token of internal) {
      assert.equal(text.includes(token), false, `"${text}" leaked ${token}`);
    }
  }
});

test("[8] a lost rider reads as reassurance, never as a cancellation", () => {
  for (const s of ["REASSIGNING", "DRIVER_CANCELLED"] as const) {
    const c = toCustomerFacing(s);
    assert.match(c.headline, /finding you another courier/i);
    assert.equal(/cancel/i.test(`${c.headline} ${c.detail ?? ""}`), false);
  }
});

test("[9] searching is silent during prep — no invented anxiety", () => {
  const c = toCustomerFacing("SEARCHING_FOR_DRIVER");
  assert.match(c.headline, /preparing your food/i);
  assert.equal(c.notify, false);
});

test("[10] the rider's name personalises the copy when known", () => {
  const withName = toCustomerFacing("DRIVER_TO_PICKUP", { driverFirstName: "Kelechi" });
  assert.match(withName.headline, /^Kelechi is heading/);
  const without = toCustomerFacing("DRIVER_TO_PICKUP");
  assert.match(without.headline, /^Your courier is heading/);
});

test("[11] map and contact are offered only when they make sense", () => {
  assert.equal(toCustomerFacing("REQUESTED").showMap, false);
  assert.equal(toCustomerFacing("EN_ROUTE_TO_CUSTOMER").showMap, true);
  assert.equal(toCustomerFacing("DELIVERED").showMap, false);
  assert.equal(toCustomerFacing("REQUESTED").showContact, false);
  assert.equal(toCustomerFacing("DRIVER_ASSIGNED").showContact, true);
});

test("[12] failures route to support and never expose the operational reason", () => {
  assert.equal(toCustomerFacing("DELIVERY_FAILED").needsSupport, true);
  const detail = failureToCustomerDetail("DRIVER_ACCIDENT");
  assert.equal(/accident/i.test(detail), false);
  assert.equal(/unreachable/i.test(failureToCustomerDetail("CUSTOMER_REFUSED")), false);
});

test("[13] unserviceable reasons get honest, actionable customer copy", () => {
  assert.match(unserviceableToCustomerDetail("OUT_OF_RANGE"), /doesn't deliver to your address/i);
  assert.match(unserviceableToCustomerDetail("NO_RIDERS"), /try again/i);
  assert.match(unserviceableToCustomerDetail("INVALID_ADDRESS"), /check it/i);
});

test("[14] THE REDUCER: restaurant drives before pickup, delivery drives after", () => {
  assert.equal(reduceOrderState("placed", "REQUESTED"), "placed");
  assert.equal(reduceOrderState("accepted", "SEARCHING_FOR_DRIVER"), "accepted");
  assert.equal(reduceOrderState("preparing", "DRIVER_ASSIGNED"), "preparing");
  assert.equal(reduceOrderState("preparing", "ARRIVED_AT_PICKUP"), "preparing");
  assert.equal(reduceOrderState("ready", "ARRIVED_AT_PICKUP"), "ready");
  // once the food is with a rider, delivery wins regardless of the kitchen
  assert.equal(reduceOrderState("preparing", "PICKED_UP"), "out_for_delivery");
  assert.equal(reduceOrderState("ready", "EN_ROUTE_TO_CUSTOMER"), "out_for_delivery");
  assert.equal(reduceOrderState("ready", "DELIVERED"), "completed");
});

test("[15] rejection and cancellation win outright", () => {
  assert.equal(reduceOrderState("rejected", "SEARCHING_FOR_DRIVER"), "cancelled");
  assert.equal(reduceOrderState("cancelled", "PICKED_UP"), "cancelled");
  assert.equal(reduceOrderState("ready", "CANCELLED"), "cancelled");
});

test("[16] a failed delivery becomes `attention`, never a silent completion", () => {
  assert.equal(reduceOrderState("ready", "DELIVERY_FAILED"), "attention");
  assert.equal(reduceOrderState("preparing", "DELIVERY_FAILED"), "attention");
});

test("[17] the reducer is total — every combination yields a state", () => {
  const progress = ["placed", "accepted", "preparing", "ready", "rejected", "cancelled"] as const;
  for (const p of progress) {
    for (const d of [...DELIVERY_STATES, null]) {
      const out = reduceOrderState(p, d as DeliveryState | null);
      assert.ok(typeof out === "string" && out.length > 0, `${p} × ${d}`);
    }
  }
});

test("[18] WAITING_FOR_ORDER is derived by RestoFlow — Dispatcher cannot know it", () => {
  assert.equal(deriveWaitingForOrder("ARRIVED_AT_PICKUP", "preparing"), "WAITING_FOR_ORDER");
  assert.equal(deriveWaitingForOrder("ARRIVED_AT_PICKUP", "ready"), "ARRIVED_AT_PICKUP");
  assert.equal(deriveWaitingForOrder("EN_ROUTE_TO_CUSTOMER", "preparing"), "EN_ROUTE_TO_CUSTOMER");
});

test("[19] tracking opens at assignment and closes permanently at terminal", () => {
  assert.equal(trackingAllowed("REQUESTED"), false);
  assert.equal(trackingAllowed("SEARCHING_FOR_DRIVER"), false);
  assert.equal(trackingAllowed("DRIVER_ASSIGNED"), true);
  assert.equal(trackingAllowed("EN_ROUTE_TO_CUSTOMER"), true);
  assert.equal(trackingAllowed("DELIVERED"), false);
  assert.equal(trackingAllowed("DELIVERY_FAILED"), false);
  assert.equal(trackingAllowed("CANCELLED"), false);
});

console.log(`\n${passed} checks passed\n`);
