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
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const SRC = code(readFileSync(join(ROOT, "lib/marketplace/delivery-handoff.ts"), "utf8"));
const HOOK = code(readFileSync(join(ROOT, "lib/marketplace/webhook.ts"), "utf8"));
const ACCEPT = code(readFileSync(join(ROOT, "app/api/admin/marketplace/orders/[orderId]/route.ts"), "utf8"));

test("[1] paying does not book a rider — the webhook never reaches Dispatcher", () => {
  // The strongest form of the old "handoff sits after the replay guard" rule:
  // there is no handoff in the payment path at all, so neither a first
  // delivery nor a replay can create a job for an unaccepted order.
  assert.ok(!HOOK.includes("requestDeliveryForOrder"),
    "the payment webhook requests a delivery; acceptance is the only handoff boundary");
});

test("[1a] the restaurant's acceptance is what requests the rider", () => {
  const accepted = ACCEPT.indexOf('result.to === "accepted"');
  const handoff = ACCEPT.indexOf("requestDeliveryForOrder");
  assert.ok(accepted > -1 && handoff > accepted,
    "the handoff must be gated on the accepted transition");
});

test("[1b] the handoff refuses an order the restaurant has not accepted", () => {
  assert.match(SRC, /restaurant_has_not_accepted/);
  const guard = SRC.indexOf("restaurant_has_not_accepted");
  assert.ok(guard < SRC.indexOf("client.createDelivery("),
    "the acceptance guard must precede the network call");
  // The rule lives in the handoff, not only at the call site, so a sweep or a
  // future caller cannot route around it.
  assert.match(SRC, /POST_ACCEPTANCE/);
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

test("[12] a handoff failure never fails the acceptance", () => {
  // The order IS accepted. A briefly unreachable Dispatcher must not show the
  // restaurant an error, nor roll the acceptance back.
  const i = ACCEPT.indexOf("requestDeliveryForOrder");
  const seg = ACCEPT.slice(i - 400, i + 700);
  assert.ok(/try\s*\{/.test(seg) && /catch/.test(seg), "the handoff is not wrapped in try/catch");
});

test("[13] the job is released to riders at acceptance, not by the daily cron", () => {
  // Found by running the real rider app: a created job is `draft`, and the
  // rider app only lists `pending`. Until this, the confirm sweep — on a
  // once-daily cron — was the only thing that released one, so a restaurant
  // could accept an order and no rider would see it for up to 24 hours.
  assert.match(SRC, /client\.confirmDelivery\(/);
  const attach = SRC.indexOf("runTransaction");
  const release = SRC.indexOf("client.confirmDelivery(");
  assert.ok(release > attach,
    "release must follow the attach, so a failed release cannot lose the job");
});

test("[14] a failed release neither fails the handoff nor loses the job", () => {
  // The job exists and is recorded; a Dispatcher timeout here must leave the
  // sweep able to finish it, which is what deliveryConfirmAt is for.
  const helper = SRC.slice(SRC.indexOf("async function release("));
  assert.ok(!/throw|rethrow/.test(helper), "the release helper must never throw");
  assert.ok(!/return \{ outcome: "failed"/.test(helper),
    "a release failure must not turn into a handoff failure");
  // The created path still reports created regardless of the release outcome.
  assert.match(SRC, /await release\([\s\S]{0,120}?\n\n  return \{ outcome: "created"/);
  assert.match(SRC, /deliveryConfirmAt: computeConfirmAt/);
});

test("[15] releasing is the same contract call the sweep makes", () => {
  // Not a second copy of the state machine: Dispatcher owns draft → pending
  // and answers a repeat with the same job.
  const SWEEP = strip(readFileSync(join(ROOT, "lib/marketplace/sweeps.ts"), "utf8"));
  assert.match(SWEEP, /client\.confirmDelivery\(/);
  assert.ok(!/status.*['"]pending['"]/.test(SRC),
    "RestoFlow must not set the Dispatcher-side status itself");
});

test("[16] a job that was attached but never released can still be released", () => {
  // Every marketplace job created before the release existed is attached and
  // still `draft` — invisible to riders. Retrying the handoff must finish the
  // job, not just report that it is already there.
  const early = SRC.indexOf("already_attached");
  assert.ok(SRC.slice(0, early).includes("release(") || /release\(\s*client/.test(SRC),
    "the already-attached path must also release");
  // Both the race path and the early return reach it.
  assert.ok((SRC.match(/await release\(/g) ?? []).length >= 3,
    "created, race and already-attached paths must all release");
});

console.log(`\n${passed} checks passed\n`);
