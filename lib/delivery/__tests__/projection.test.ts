// Event application: duplicates, out-of-order, terminality, reassignment,
// reconciliation and dispatch timing.
// Run: npx tsx lib/delivery/__tests__/projection.test.ts

import assert from "node:assert/strict";
import { CONTRACT_VERSION, type DeliveryEvent, type DeliveryState } from "../contract";
import {
  applyEvent, initialProjection, reconcileFrom, reconcileVerdict, computeConfirmAt,
  STALE_AFTER_MS, ATTENTION_AFTER_MS, type DeliveryProjection,
} from "../projection";

let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`  ✓ ${name}`); };
console.log("delivery/projection");

const T0 = 1_756_000_000_000;
const base = (over: Partial<DeliveryProjection> = {}): DeliveryProjection => ({
  ...initialProjection({ correlationId: "corr-1", quoteId: "QT-1", nowMs: T0 }),
  deliveryJobId: "DJ-1",
  ...over,
});

const ev = (over: Partial<DeliveryEvent> = {}): DeliveryEvent => ({
  contractVersion: CONTRACT_VERSION, eventId: "evt-1", type: "delivery.state_changed",
  occurredAt: new Date(T0).toISOString(), sequence: 1,
  deliveryJobId: "DJ-1", externalOrderId: "RF-1", correlationId: "corr-1",
  state: "SEARCHING_FOR_DRIVER",
  ...over,
} as DeliveryEvent);

const applied = (o: ReturnType<typeof applyEvent>) => {
  assert.equal(o.kind, "applied");
  return (o as { next: DeliveryProjection }).next;
};

test("[1] a fresh projection starts REQUESTED at sequence 0", () => {
  const p = initialProjection({ correlationId: "c", quoteId: "q", nowMs: T0 });
  assert.equal(p.state, "REQUESTED");
  assert.equal(p.sequence, 0);
  assert.equal(p.deliveryJobId, null);
  assert.equal(p.driver, null);
});

test("[2] a forward event applies and advances the sequence", () => {
  const next = applied(applyEvent(base(), ev({ sequence: 1, state: "SEARCHING_FOR_DRIVER" }), T0 + 1000));
  assert.equal(next.state, "SEARCHING_FOR_DRIVER");
  assert.equal(next.sequence, 1);
  assert.equal(next.lastEventAt, T0 + 1000);
});

test("[3] DUPLICATE: the same sequence twice changes nothing", () => {
  const p = base({ sequence: 3, state: "DRIVER_ASSIGNED" });
  const out = applyEvent(p, ev({ sequence: 3, state: "DRIVER_ASSIGNED" }), T0);
  assert.equal(out.kind, "ignored");
  assert.equal((out as { reason: string }).reason, "duplicate_sequence");
});

test("[4] OUT OF ORDER: a lower sequence is discarded", () => {
  const p = base({ sequence: 5, state: "PICKED_UP" });
  const out = applyEvent(p, ev({ sequence: 2, state: "DRIVER_ASSIGNED" }), T0);
  assert.equal(out.kind, "ignored");
  assert.equal((out as { reason: string }).reason, "stale_sequence");
});

test("[5] TERMINAL: nothing reopens a delivered order", () => {
  for (const terminal of ["DELIVERED", "DELIVERY_FAILED", "CANCELLED"] as const) {
    const p = base({ sequence: 8, state: terminal });
    const out = applyEvent(p, ev({ sequence: 9, state: "EN_ROUTE_TO_CUSTOMER" }), T0);
    assert.equal(out.kind, "ignored", terminal);
    assert.equal((out as { reason: string }).reason, "already_terminal");
  }
});

test("[6] a correctly-sequenced BACKWARDS move is refused…", () => {
  const p = base({ sequence: 5, state: "EN_ROUTE_TO_CUSTOMER" });
  const out = applyEvent(p, ev({ sequence: 6, state: "DRIVER_TO_PICKUP" }), T0);
  assert.equal(out.kind, "ignored");
  assert.equal((out as { reason: string }).reason, "no_state_progress");
});

test("[7] …except REASSIGNING, which is a genuine backwards move", () => {
  const p = base({ sequence: 4, state: "DRIVER_TO_PICKUP", driver: { firstName: "K", photoUrl: null, vehicle: "Bike", contactHandle: "h" }, assignedAt: T0 });
  const next = applied(applyEvent(p, ev({ sequence: 5, state: "REASSIGNING" }), T0 + 5000));
  assert.equal(next.state, "REASSIGNING");
  // the lost rider must stop being shown immediately
  assert.equal(next.driver, null);
  assert.equal(next.assignedAt, null);
  assert.equal(next.etaToPickupMins, null);
});

test("[8] an event for a different job on this order is rejected outright", () => {
  const out = applyEvent(base({ deliveryJobId: "DJ-1" }), ev({ deliveryJobId: "DJ-OTHER", sequence: 2 }), T0);
  assert.equal(out.kind, "rejected");
  assert.match((out as { reason: string }).reason, /DJ-OTHER/);
});

test("[9] driver assignment stores only the public projection", () => {
  const next = applied(applyEvent(base(), ev({
    type: "delivery.driver_assigned", sequence: 2, state: "DRIVER_ASSIGNED",
    driver: { firstName: "Kelechi", photoUrl: "u", vehicle: "Bike", contactHandle: "h1" },
    etaToPickupMins: 7,
  }), T0 + 100));
  assert.equal(next.driver?.firstName, "Kelechi");
  assert.equal(next.etaToPickupMins, 7);
  assert.equal(next.assignedAt, T0 + 100);
  assert.equal(Object.keys(next.driver!).sort().join(","), "contactHandle,firstName,photoUrl,vehicle");
});

test("[10] reassignment then a new rider clears the previous issue", () => {
  let p = base({ sequence: 3, state: "DRIVER_TO_PICKUP" });
  p = applied(applyEvent(p, ev({ sequence: 4, state: "REASSIGNING" }), T0));
  p = applied(applyEvent(p, ev({
    type: "delivery.driver_assigned", sequence: 5, state: "DRIVER_ASSIGNED",
    driver: { firstName: "Ada", photoUrl: null, vehicle: "Bike", contactHandle: "h2" },
    etaToPickupMins: 5,
  }), T0 + 1000));
  assert.equal(p.state, "DRIVER_ASSIGNED");
  assert.equal(p.driver?.firstName, "Ada");
  assert.equal(p.issue, null);
});

test("[11] timestamps are stamped once and never overwritten", () => {
  let p = base({ sequence: 4, state: "ARRIVED_AT_PICKUP" });
  p = applied(applyEvent(p, ev({ sequence: 5, state: "PICKED_UP" }), T0 + 1000));
  assert.equal(p.pickedUpAt, T0 + 1000);
  p = applied(applyEvent(p, ev({ sequence: 6, state: "EN_ROUTE_TO_CUSTOMER" }), T0 + 9000));
  assert.equal(p.pickedUpAt, T0 + 1000, "pickedUpAt must not move");
  p = applied(applyEvent(p, ev({ sequence: 7, state: "DELIVERED" }), T0 + 20000));
  assert.equal(p.deliveredAt, T0 + 20000);
});

test("[12] a failure records the operator reason and flags for attention", () => {
  const next = applied(applyEvent(base({ sequence: 5, state: "EN_ROUTE_TO_CUSTOMER" }), ev({
    type: "delivery.failed", sequence: 6, state: "DELIVERY_FAILED",
    failureReason: "CUSTOMER_UNREACHABLE", detail: "no answer after 4 calls",
  }), T0));
  assert.equal(next.issue?.kind, "failed");
  assert.equal(next.issue?.reason, "CUSTOMER_UNREACHABLE");
  assert.equal(next.reconcileState, "attention");
});

test("[13] exception states annotate without advancing the delivery", () => {
  const p = base({ sequence: 5, state: "EN_ROUTE_TO_CUSTOMER" });
  const next = applied(applyEvent(p, ev({ sequence: 6, state: "CUSTOMER_UNREACHABLE" }), T0));
  assert.equal(next.issue?.kind, "unreachable");
  assert.equal(next.state, "CUSTOMER_UNREACHABLE");
});

test("[14] a full happy path applies end to end", () => {
  const path: Array<[number, DeliveryState]> = [
    [1, "SEARCHING_FOR_DRIVER"], [2, "DRIVER_ASSIGNED"], [3, "DRIVER_TO_PICKUP"],
    [4, "ARRIVED_AT_PICKUP"], [5, "PICKED_UP"], [6, "EN_ROUTE_TO_CUSTOMER"],
    [7, "ARRIVING"], [8, "DELIVERED"],
  ];
  let p = base();
  for (const [seq, state] of path) {
    p = applied(applyEvent(p, ev({ sequence: seq, state }), T0 + seq * 1000));
  }
  assert.equal(p.state, "DELIVERED");
  assert.equal(p.sequence, 8);
  assert.ok(p.deliveredAt);
});

test("[15] REPLAYING the whole stream is a no-op", () => {
  const path: Array<[number, DeliveryState]> = [
    [1, "SEARCHING_FOR_DRIVER"], [2, "DRIVER_ASSIGNED"], [5, "PICKED_UP"], [8, "DELIVERED"],
  ];
  let p = base();
  for (const [sequence, state] of path) p = applied(applyEvent(p, ev({ sequence, state }), T0));
  const after = structuredClone(p);
  for (const [sequence, state] of path) {
    const out = applyEvent(p, ev({ sequence, state }), T0 + 99_999);
    assert.equal(out.kind, "ignored", `${state} replay`);
  }
  assert.deepEqual(p, after);
});

test("[16] staleness escalates ok → stale → attention, and terminal is never stale", () => {
  const live = base({ state: "EN_ROUTE_TO_CUSTOMER", lastEventAt: T0 });
  assert.equal(reconcileVerdict(live, T0 + 1000), "ok");
  assert.equal(reconcileVerdict(live, T0 + STALE_AFTER_MS), "stale");
  assert.equal(reconcileVerdict(live, T0 + ATTENTION_AFTER_MS), "attention");
  const done = base({ state: "DELIVERED", lastEventAt: T0 });
  assert.equal(reconcileVerdict(done, T0 + ATTENTION_AFTER_MS * 10), "ok");
});

test("[17] RECONCILE after a missed event repairs state, bypassing the sequence guard", () => {
  const p = base({ sequence: 2, state: "DRIVER_ASSIGNED", lastEventAt: T0 });
  const next = applied(reconcileFrom(p, {
    deliveryJobId: "DJ-1", state: "EN_ROUTE_TO_CUSTOMER",
    driver: { firstName: "Kelechi", photoUrl: null, vehicle: "Bike", contactHandle: "h" },
    etaToDropoffMins: 12,
  }, T0 + 60_000));
  assert.equal(next.state, "EN_ROUTE_TO_CUSTOMER");
  assert.equal(next.pickedUpAt, T0 + 60_000);
  assert.equal(next.reconcileState, "ok");
});

test("[18] reconcile refuses to reopen a terminal delivery", () => {
  const p = base({ sequence: 8, state: "DELIVERED" });
  const out = reconcileFrom(p, { deliveryJobId: "DJ-1", state: "EN_ROUTE_TO_CUSTOMER", driver: null, etaToDropoffMins: 5 }, T0);
  assert.equal(out.kind, "ignored");
  assert.equal((out as { reason: string }).reason, "already_terminal");
});

test("[19] an unchanged reconcile still clears staleness", () => {
  const p = base({ sequence: 4, state: "DRIVER_TO_PICKUP", lastEventAt: T0, reconcileState: "stale" });
  const next = applied(reconcileFrom(p, { deliveryJobId: "DJ-1", state: "DRIVER_TO_PICKUP", driver: null, etaToDropoffMins: null }, T0 + 300_000));
  assert.equal(next.state, "DRIVER_TO_PICKUP");
  assert.equal(next.lastEventAt, T0 + 300_000);
  assert.equal(next.reconcileState, "ok", "a slow delivery must not escalate forever");
});

test("[20] DISPATCH TIMING: the worked example — 25 min prep, 8 min rider ETA", () => {
  const confirmAt = computeConfirmAt({ acceptedAtMs: T0, prepMins: 25, etaToPickupMins: 8, nowMs: T0 });
  const minsFromAccept = (confirmAt - T0) / 60_000;
  // ready at 25; lead = 4 search + 8 travel + 2 safety = 14 → confirm at minute 11
  assert.equal(minsFromAccept, 11);
});

test("[21] a short prep confirms immediately rather than in the past", () => {
  const confirmAt = computeConfirmAt({ acceptedAtMs: T0, prepMins: 5, etaToPickupMins: 10, nowMs: T0 });
  assert.equal(confirmAt, T0, "never schedules a moment that has gone");
});

test("[22] a missing rider ETA falls back to the search buffer, not to zero", () => {
  const withEta = computeConfirmAt({ acceptedAtMs: T0, prepMins: 40, etaToPickupMins: 4, nowMs: T0 });
  const withoutEta = computeConfirmAt({ acceptedAtMs: T0, prepMins: 40, etaToPickupMins: null, nowMs: T0 });
  assert.equal(withEta, withoutEta, "null ETA must not mean 'travel takes no time'");
});

console.log(`\n${passed} checks passed\n`);
