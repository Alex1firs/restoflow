// Contract validation, state ranking and the outbound payload guard.
// Run: npx tsx lib/delivery/__tests__/contract.test.ts

import assert from "node:assert/strict";
import {
  CONTRACT_VERSION, CONTRACT_MAJOR, DELIVERY_STATES, TERMINAL_STATES,
  checkContractVersion, findForbiddenKeys, isDeliveryState, isTerminal,
  isValidExternalId, isValidLatLng, stateRank,
  validateCreateRequest, validateEvent, validateQuoteRequest,
  type CreateDeliveryRequest, type DeliveryStatusEvent,
} from "../contract";

let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`  ✓ ${name}`); };
console.log("delivery/contract");

test("[1] contract version is a same-major check, not equality", () => {
  assert.equal(checkContractVersion(CONTRACT_VERSION).ok, true);
  assert.equal(checkContractVersion("1.9.3").ok, true);       // future minor: fine
  assert.equal(checkContractVersion("2.0.0").ok, false);      // other major: refused
  assert.equal(checkContractVersion("banana").ok, false);
  assert.equal(checkContractVersion(1 as unknown).ok, false);
  assert.equal(CONTRACT_MAJOR, 1);
});

test("[2] every declared state is recognised and ranked", () => {
  for (const s of DELIVERY_STATES) {
    assert.equal(isDeliveryState(s), true, s);
    assert.equal(typeof stateRank(s), "number", s);
  }
  assert.equal(isDeliveryState("MADE_UP"), false);
});

test("[3] terminal states are exactly the three that end a delivery", () => {
  assert.deepEqual([...TERMINAL_STATES].sort(), ["CANCELLED", "DELIVERED", "DELIVERY_FAILED"]);
  for (const s of DELIVERY_STATES) {
    assert.equal(isTerminal(s), (TERMINAL_STATES as readonly string[]).includes(s), s);
  }
});

test("[4] rank orders the happy path monotonically", () => {
  const path = ["REQUESTED", "SEARCHING_FOR_DRIVER", "DRIVER_ASSIGNED", "DRIVER_TO_PICKUP",
    "ARRIVED_AT_PICKUP", "PICKED_UP", "EN_ROUTE_TO_CUSTOMER", "ARRIVING", "DELIVERED"] as const;
  for (let i = 1; i < path.length; i++) {
    assert.ok(stateRank(path[i]) > stateRank(path[i - 1]), `${path[i]} > ${path[i - 1]}`);
  }
});

test("[5] REASSIGNING ranks below DRIVER_ASSIGNED — losing a rider IS backwards", () => {
  assert.ok(stateRank("REASSIGNING") < stateRank("DRIVER_ASSIGNED"));
  // …and exception states do not advance the delivery
  assert.equal(stateRank("WAITING_FOR_ORDER"), stateRank("ARRIVED_AT_PICKUP"));
  assert.equal(stateRank("CUSTOMER_UNREACHABLE"), stateRank("EN_ROUTE_TO_CUSTOMER"));
});

test("[6] coordinates: range-checked, and null-island refused", () => {
  assert.equal(isValidLatLng({ lat: 6.45, lng: 3.39 }), true);
  assert.equal(isValidLatLng({ lat: 0, lng: 0 }), false);       // unset default
  assert.equal(isValidLatLng({ lat: 91, lng: 0 }), false);
  assert.equal(isValidLatLng({ lat: NaN, lng: 3 }), false);
  assert.equal(isValidLatLng({ lat: "6.4", lng: 3 }), false);
  assert.equal(isValidLatLng(null), false);
});

test("[7] external ids are narrow, and reject traversal / injection shapes", () => {
  assert.equal(isValidExternalId("RF-12345"), true);
  assert.equal(isValidExternalId("abc_DEF-999"), true);
  assert.equal(isValidExternalId("../../etc/passwd"), false);
  assert.equal(isValidExternalId("has space"), false);
  assert.equal(isValidExternalId(""), false);
  assert.equal(isValidExternalId("a".repeat(200)), false);

  // A LEADING HYPHEN IS VALID, and this is not a relaxation for its own sake.
  // Firebase RTDB push keys begin with one, and those keys are Dispatcher's
  // delivery job ids — so rejecting them meant every delivery event referenced
  // an id the receiver called malformed. Staging caught it; unit tests could
  // not, because both sides agreed with themselves.
  assert.equal(isValidExternalId("-P0eCVY4Vfp72vnsGv5z"), true);
  assert.equal(isValidExternalId("-P0eCVY4Vfp72vnsGv5z-1"), true);

  // What the narrowness was actually protecting against is unchanged.
  assert.equal(isValidExternalId("--"), true);           // hyphens are just characters
  assert.equal(isValidExternalId("-/../etc"), false);    // no traversal
  assert.equal(isValidExternalId("-a b"), false);        // no whitespace
  assert.equal(isValidExternalId("-a;rm -rf /"), false); // no shell metacharacters
});

const goodCreate = (): CreateDeliveryRequest => ({
  contractVersion: CONTRACT_VERSION,
  correlationId: "corr-1",
  externalOrderId: "RF-1",
  quoteId: "QT-1",
  serviceType: "FOOD_STANDARD",
  pickup: { name: "Trisha's", address: "1 Road", location: { lat: 6.45, lng: 3.39 }, contactPhone: "+2348000000000" },
  dropoff: { name: "Amaka", address: "2 Road", location: { lat: 6.46, lng: 3.40 }, contactPhone: "+2348111111111" },
  readyAt: "2026-09-01T18:20:00Z",
  deliveryFeeMinor: 145000,
  paymentCollection: "NONE",
  packageDescription: "Hot food · 2 bags",
});

test("[8] a well-formed create request validates", () => {
  assert.equal(validateCreateRequest(goodCreate()).ok, true);
});

test("[9] create validation catches each required field", () => {
  const cases: Array<[string, (r: CreateDeliveryRequest) => void]> = [
    ["externalOrderId", (r) => { r.externalOrderId = "bad id" as string; }],
    ["pickup coords", (r) => { r.pickup.location = { lat: 0, lng: 0 }; }],
    ["dropoff phone", (r) => { r.dropoff.contactPhone = "  "; }],
    ["readyAt", (r) => { r.readyAt = ""; }],
    ["fee negative", (r) => { r.deliveryFeeMinor = -1; }],
    ["fee fractional", (r) => { r.deliveryFeeMinor = 12.5; }],
    ["paymentCollection", (r) => { (r as { paymentCollection: string }).paymentCollection = "CASH"; }],
  ];
  for (const [label, mutate] of cases) {
    const r = goodCreate();
    mutate(r);
    assert.equal(validateCreateRequest(r).ok, false, label);
  }
});

test("[10] prepaid is enforced — a cash-collect marketplace job is refused", () => {
  const r = goodCreate();
  (r as { paymentCollection: string }).paymentCollection = "ON_DELIVERY";
  const v = validateCreateRequest(r);
  assert.equal(v.ok, false);
  assert.match((v as { error: string }).error, /paymentCollection/);
});

test("[11] quote request validation", () => {
  const base = {
    contractVersion: CONTRACT_VERSION, correlationId: "c1", externalRef: "cart-1",
    serviceType: "FOOD_STANDARD" as const,
    pickup: { lat: 6.45, lng: 3.39 }, dropoff: { lat: 6.5, lng: 3.4 },
  };
  assert.equal(validateQuoteRequest(base).ok, true);
  assert.equal(validateQuoteRequest({ ...base, pickup: { lat: 0, lng: 0 } }).ok, false);
  assert.equal(validateQuoteRequest({ ...base, serviceType: "PARCEL" }).ok, false);
  assert.equal(validateQuoteRequest(null).ok, false);
});

const goodEvent = (): DeliveryStatusEvent => ({
  contractVersion: CONTRACT_VERSION,
  eventId: "evt-1", type: "delivery.state_changed",
  occurredAt: "2026-09-01T18:25:00Z", sequence: 3,
  deliveryJobId: "DJ-1", externalOrderId: "RF-1", correlationId: "corr-1",
  state: "PICKED_UP",
});

test("[12] event validation accepts a good event and rejects each malformation", () => {
  assert.equal(validateEvent(goodEvent()).ok, true);
  assert.equal(validateEvent({ ...goodEvent(), sequence: 0 }).ok, false);      // must be >= 1
  assert.equal(validateEvent({ ...goodEvent(), sequence: 1.5 }).ok, false);
  assert.equal(validateEvent({ ...goodEvent(), state: "NOPE" }).ok, false);
  assert.equal(validateEvent({ ...goodEvent(), type: "delivery.exploded" }).ok, false);
  assert.equal(validateEvent({ ...goodEvent(), eventId: "" }).ok, false);
  assert.equal(validateEvent({ ...goodEvent(), contractVersion: "2.0.0" }).ok, false);
});

test("[13] typed events require their own payload", () => {
  assert.equal(validateEvent({ ...goodEvent(), type: "delivery.driver_assigned", state: "DRIVER_ASSIGNED" }).ok, false);
  assert.equal(validateEvent({
    ...goodEvent(), type: "delivery.driver_assigned", state: "DRIVER_ASSIGNED",
    driver: { firstName: "Kelechi", photoUrl: null, vehicle: "Bike", contactHandle: "h1" },
  }).ok, true);
  assert.equal(validateEvent({ ...goodEvent(), type: "delivery.failed", state: "DELIVERY_FAILED", failureReason: "MADE_UP" }).ok, false);
  assert.equal(validateEvent({ ...goodEvent(), type: "delivery.cancelled", state: "CANCELLED", cancelledBy: "ALIENS" }).ok, false);
});

test("[14] THE MONEY GUARD: no food or settlement field may reach Dispatcher", () => {
  assert.deepEqual(findForbiddenKeys(goodCreate()), []);

  const leaky = { ...goodCreate(), itemsTotal: 1200000 };
  assert.deepEqual(findForbiddenKeys(leaky), ["$.itemsTotal"]);

  // nested, and inside arrays — the scan must be deep
  assert.deepEqual(findForbiddenKeys({ a: { b: { restaurantPayable: 1 } } }), ["$.a.b.restaurantPayable"]);
  assert.deepEqual(findForbiddenKeys({ lines: [{ ok: 1 }, { markup: 2 }] }), ["$.lines[1].markup"]);
});

test("[15] the guard covers every money and identity field named in the contract", () => {
  for (const k of ["foodSubtotal", "markupTotal", "platformMargin", "restaurantPayable",
                   "processorFee", "customerId", "paymentReference", "items", "total", "orderCost"]) {
    assert.deepEqual(findForbiddenKeys({ [k]: 1 }), [`$.${k}`], k);
  }
});

console.log(`\n${passed} checks passed\n`);
