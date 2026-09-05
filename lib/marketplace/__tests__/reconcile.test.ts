/**
 * Payment reconciliation — the recovery path that does not need a webhook.
 *
 * The property under test is that a customer who has been charged ends up with
 * exactly one order whether or not Paystack's webhook ever arrives, and that
 * uncertainty never destroys a basket.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { classifyPaystackStatus } from "../payment";

let passed = 0;
const test = (n: string, f: () => void) => { f(); passed++; console.log(`  ✓ ${n}`); };
console.log("marketplace/reconcile");

const ROOT = join(__dirname, "..", "..", "..");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const SRC = strip(readFileSync(join(ROOT, "lib/marketplace/reconcile.ts"), "utf8"));
const CONFIRM = strip(readFileSync(join(ROOT, "app/api/mobile/v1/orders/confirm/route.ts"), "utf8"));
const SWEEPS = strip(readFileSync(join(ROOT, "lib/marketplace/sweeps.ts"), "utf8"));

test("[1] only a definite Paystack verdict is treated as failure", () => {
  assert.equal(classifyPaystackStatus("success"), "success");
  for (const s of ["failed", "reversed", "abandoned"]) {
    assert.equal(classifyPaystackStatus(s), "failed", `${s} is a definite no`);
  }
});

test("[2] anything else is unknown — never a failure", () => {
  // The one mistake this module exists to prevent: discarding a paid basket
  // because we could not get a clear answer.
  for (const s of ["ongoing", "pending", "processing", "", undefined, "banana"]) {
    assert.equal(classifyPaystackStatus(s as string | undefined), "unknown",
      `${String(s)} must not be read as a failure`);
  }
});

test("[3] a transport error is unknown, not failed", () => {
  const i = SRC.indexOf("catch");
  const tail = SRC.slice(i, i + 200);
  assert.match(tail, /status: "unknown"/,
    "a network error must leave the intent alone for the next sweep");
});

test("[4] a 404 from Paystack IS a definite answer", () => {
  // We minted the reference. If Paystack has never seen it, it was never paid.
  assert.match(SRC, /res\.status === 404/);
});

test("[5] reconciliation settles through settlePayment, never its own writer", () => {
  // Sharing the settle path is what makes the webhook, the customer's return
  // and the sweep converge on one order instead of three.
  assert.match(SRC, /settlePayment\(/);
  assert.ok(!/materialiseOrder|buildMarketplaceOrder|collection\("orders"\)\.add/.test(SRC),
    "reconcile creates orders directly instead of going through settlePayment");
});

test("[6] the intent sweep is actually wired into the cron run", () => {
  // It existed, fully tested, and was never called — which is why a lost
  // webhook had no recovery path at all.
  assert.match(SWEEPS, /intentSweep\(/);
  assert.match(SWEEPS, /intents,/);
});

test("[7] money is reconciled even when the delivery integration is off", () => {
  const disabled = SWEEPS.indexOf("delivery_sweeps_skipped");
  const sweep = SWEEPS.indexOf("intentSweep(", disabled);
  assert.ok(disabled > -1 && sweep > disabled,
    "a charged customer must get their order whether or not Dispatcher is configured");
});

test("[8] the confirm route checks ownership on the order, not the reference", () => {
  assert.match(CONFIRM, /d\.customerId !== customer\.id/);
  assert.match(CONFIRM, /return notFound\(\)/,
    "'not yours' and 'not there' must be indistinguishable");
});

test("[9] pending and unknown are reported as pending, never as failure", () => {
  const seg = CONFIRM.slice(CONFIRM.indexOf('case "pending"'), CONFIRM.indexOf('case "failed"'));
  assert.match(seg, /state: "pending"/);
  assert.ok(!/state: "failed"/.test(seg));
});

test("[10] an amount mismatch is loud in the logs and vague to the customer", () => {
  const seg = CONFIRM.slice(CONFIRM.indexOf('case "amount_mismatch"'));
  assert.match(seg, /console\.error/);
  assert.ok(!/expectedMinor.*return|actualMinor: result/.test(seg.split("return")[1] ?? ""),
    "the customer must not be told the expected amount");
});

test("[11] an acceptance that could not reach Dispatcher is retried", () => {
  // Acceptance deliberately swallows a Dispatcher failure so the restaurant is
  // not shown an error. Without this sweep that trade would strand the order.
  assert.match(SWEEPS, /handoffSweep\(/);
  assert.match(SWEEPS, /findPendingHandoffs/);
  assert.match(SWEEPS, /requestDeliveryForOrder/);
});

test("[12] the retry marker is set before the attempt and cleared on success", () => {
  const ACCEPT = strip(readFileSync(join(ROOT, "app/api/admin/marketplace/orders/[orderId]/route.ts"), "utf8"));
  const HANDOFF = strip(readFileSync(join(ROOT, "lib/marketplace/delivery-handoff.ts"), "utf8"));
  const mark = ACCEPT.indexOf("markHandoffPending");
  const call = ACCEPT.indexOf("requestDeliveryForOrder", mark);
  assert.ok(mark > -1 && call > mark,
    "marking after the attempt would lose a crash between the two");
  // Cleared inside the same transaction that attaches the job, so a retry
  // cannot see an attached order as still owing one.
  assert.match(HANDOFF, /deliveryHandoffPending: null/);
});

test("[13] an order rejected after acceptance stops being retried", () => {
  const seg = SWEEPS.slice(SWEEPS.indexOf("handoffSweep("));
  assert.match(seg, /outcome === "skipped"[\s\S]{0,200}clearHandoffPending/,
    "a skipped handoff must clear the marker, not retry forever");
});

test("[14] the retry marker is cleared on every terminal answer, not just success", () => {
  // Found on staging: accepting an order that already had a job left the
  // marker set, so the sweep re-asked forever and always got the same answer.
  const HANDOFF = strip(readFileSync(join(ROOT, "lib/marketplace/delivery-handoff.ts"), "utf8"));
  const attached = HANDOFF.indexOf('outcome: "already_attached", deliveryJobId: String(order.delivery.deliveryJobId)');
  const clear = HANDOFF.lastIndexOf("deliveryHandoffPending: null", attached);
  assert.ok(attached > -1 && clear > -1 && clear < attached,
    "the already-attached early return must clear the marker before returning");
});

test("[15] a failure that can never succeed stops being retried", () => {
  // A missing dropoff coordinate is not a transient fault: asking again cannot
  // change the answer, so it escalates and clears rather than looping.
  const seg = SWEEPS.slice(SWEEPS.indexOf("handoffSweep("));
  const nonRetryable = seg.indexOf("!outcome.retryable");
  assert.ok(nonRetryable > -1);
  const block = seg.slice(nonRetryable, nonRetryable + 400);
  assert.match(block, /markAttention/);
  assert.match(block, /clearHandoffPending/);
});

test("[16] a declined first attempt does not poison the reference forever", () => {
  // Found in a real staging run: the customer's first card attempt recorded
  // `failed` against the reference, they paid with another card on the same
  // Paystack page, and every settlement path then threw
  // "payment … exists with no order". The money was taken and the order could
  // never be created — by any path, forever.
  const STORE = strip(readFileSync(join(ROOT, "lib/marketplace/store.ts"), "utf8"));
  const guard = STORE.indexOf("exists with no order");
  const seg = STORE.slice(Math.max(0, guard - 700), guard + 120);
  assert.match(seg, /!== "failed"/,
    "a recorded failure must fall through and materialise, not throw");
  // A succeeded payment with no order IS still a fault and must still throw.
  assert.match(STORE, /throw new Error\(`payment \$\{reference\} exists with no order`\)/);
});

test("[17] the payment record is replaced, not created, so a retry can settle", () => {
  const STORE = strip(readFileSync(join(ROOT, "lib/marketplace/store.ts"), "utf8"));
  assert.match(STORE, /tx\.set\(paymentRef, \{/,
    "tx.create would fail with ALREADY_EXISTS over a failed attempt's record");
  // The ledger still uses create: those ids are deterministic and must never
  // be overwritten.
  assert.match(STORE, /tx\.create\(this\.db\.collection\(LEDGER\)/);
});

console.log(`\n${passed} checks passed\n`);
