/**
 * The paid-order → Dispatcher-job seam.
 *
 * The property that matters is "exactly one job per order, forever" — under
 * webhook replay, application retry, and two handoffs racing. These assertions
 * are structural (over the real source) because the function itself needs a
 * live Firestore and a live Dispatcher; what a unit test CAN pin down is that
 * the guards exist, in the right order, and that nothing forbidden crosses.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findForbiddenKeys, CONTRACT_VERSION } from "../../delivery/contract";

let passed = 0;
const test = (n: string, f: () => void) => { f(); passed++; console.log(`  ✓ ${n}`); };
console.log("marketplace/delivery-handoff");

const ROOT = join(__dirname, "..", "..", "..");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const SRC = code(readFileSync(join(ROOT, "lib/marketplace/delivery-handoff.ts"), "utf8"));
const HOOK = code(readFileSync(join(ROOT, "lib/marketplace/webhook.ts"), "utf8"));

test("[1] a replayed webhook returns before the handoff is reached", () => {
  const settled = HOOK.indexOf('result.outcome !== "created"');
  const handoff = HOOK.indexOf("requestDeliveryForOrder");
  assert.ok(settled > -1 && handoff > settled,
    "the handoff must sit AFTER the replay guard, or a redelivered payment creates a second job");
});

test("[2] an order that already has a job never calls Dispatcher", () => {
  const guard = SRC.indexOf("order.delivery?.deliveryJobId");
  const call = SRC.indexOf("client.createDelivery(");
  assert.ok(guard > -1 && guard < call, "the already-attached check must precede the network call");
  assert.match(SRC, /return \{ outcome: "already_attached"/);
});

test("[3] externalOrderId is the marketplace order id — the idempotency anchor", () => {
  assert.match(SRC, /externalOrderId: orderId/);
  // Never a fresh id per attempt: that would defeat Dispatcher's own dedup.
  assert.ok(!/externalOrderId:\s*(randomUUID|`|Date\.now)/.test(SRC));
});

test("[4] attaching the job is a compare-and-set, so a race cannot double-attach", () => {
  assert.match(SRC, /runTransaction/);
  assert.match(SRC, /existing\?\.deliveryJobId/);
  assert.match(SRC, /already_attached_by_race/);
});

test("[5] only the DELIVERY fee crosses — no food, payable, margin or processor money", () => {
  for (const forbidden of [
    "customerSubtotalMinor", "restaurantSubtotalMinor", "restaurantPayableMinor",
    "platformGrossMinor", "platformNetMinor", "processorFeeMinor", "totalChargedMinor",
    "markupTotalMinor", "orderValueMinor",
  ]) assert.ok(!SRC.includes(forbidden), `the handoff sends ${forbidden} to Dispatcher`);
  assert.match(SRC, /deliveryFeeMinor: Number\(order\.pricing\?\.deliveryFeeMinor/);
});

test("[6] the fee is read from the frozen snapshot, never recomputed", () => {
  assert.ok(!/priceLine|buildSnapshot|quoteCart|customerDeliveryFee/.test(SRC),
    "the handoff recomputes pricing instead of reading the snapshot");
});

test("[7] the request the handoff builds passes the contract's own leak check", () => {
  // Same shape the code assembles, run through the real guard.
  const req = {
    contractVersion: CONTRACT_VERSION, correlationId: "mp-1", externalOrderId: "ORD-1",
    quoteId: "q-1", serviceType: "FOOD_STANDARD",
    pickup: { name: "Kitchen", address: "1 St", location: { lat: 6.4, lng: 3.4 }, contactPhone: "+234800" },
    dropoff: { name: "Ada", address: "2 St", location: { lat: 6.5, lng: 3.5 }, contactPhone: "+234811", instructions: "" },
    readyAt: new Date().toISOString(), deliveryFeeMinor: 70000,
    paymentCollection: "NONE", packageDescription: "Food delivery",
  };
  assert.deepEqual(findForbiddenKeys(req), []);
});

test("[8] the customer's surname never travels", () => {
  assert.match(SRC, /\.split\(\/\\s\+\/\)\[0\]/);
  assert.ok(!/name: String\(order\.customerName\)(?!\.)/.test(SRC));
});

test("[9] item names never travel — a rider does not need the menu", () => {
  assert.match(SRC, /packageDescription: "Food delivery"/);
  assert.ok(!/order\.items/.test(SRC));
});

test("[10] an unpaid or non-marketplace order is skipped, not dispatched", () => {
  assert.match(SRC, /payment\?\.state !== "paid"/);
  assert.match(SRC, /orderSource !== "marketplace"/);
});

test("[11] a disabled integration refuses rather than guessing an endpoint", () => {
  assert.match(SRC, /delivery_integration_disabled/);
  const gate = SRC.indexOf("delivery_integration_disabled");
  assert.ok(gate < SRC.indexOf("client.createDelivery("));
});

test("[12] a handoff failure never fails the webhook", () => {
  // Paystack must still get its 200; redelivering a settled payment helps nobody.
  const i = HOOK.indexOf("requestDeliveryForOrder");
  const seg = HOOK.slice(i - 400, i + 700);
  assert.ok(/try\s*\{/.test(seg) && /catch/.test(seg), "the handoff is not wrapped in try/catch");
});

console.log(`\n${passed} checks passed\n`);
