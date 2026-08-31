// The ledger: immutability, balance, refunds, and the commercial answer.
// Run: npx tsx lib/marketplace/__tests__/ledger.test.ts

import assert from "node:assert/strict";
import { buildSnapshot, type PricingConfig } from "../pricing";
import {
  entriesForPayment, entriesForRefund, entriesForAdjustment,
  deriveBalances, isBalanced, summarise, ACCOUNTS,
  type LedgerEntry,
} from "../ledger";

let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`  ✓ ${name}`); };
console.log("marketplace/ledger");

const T0 = 1_756_000_000_000;
const config: PricingConfig = {
  platformDefault: { type: "percent", bps: 2000 },
  restaurantDefault: null, roundToMinor: 5000, rulesVersion: 1,
};

// The worked example: ₦10,000 food → ₦12,000 customer, ₦2,000 delivery
// (₦1,600 cost), ₦210 processor fee.
const snapshot = buildSnapshot({
  lines: [{ dishId: "d1", name: "Jollof", quantity: 1, basePriceMinor: 1_000_000 }],
  config, deliveryFeeMinor: 200_000, deliveryCostMinor: 160_000,
  processorFeeMinor: 21_000, quoteId: "QT-1", nowMs: T0,
});

const paid = () => entriesForPayment({
  orderId: "RF-1", restaurantId: "trishas", snapshot, nowMs: T0, createdBy: "payment-verify",
});

test("[1] a captured payment produces a BALANCED entry set", () => {
  assert.equal(isBalanced(paid()), true);
});

test("[2] the ledger answers every commercial question", () => {
  const f = summarise(paid(), snapshot);
  assert.equal(f.customerPaidMinor, 1_400_000);   // ₦14,000
  assert.equal(f.restaurantOwedMinor, 1_000_000); // ₦10,000
  assert.equal(f.deliveryOwedMinor, 160_000);     // ₦1,600
  assert.equal(f.processorCostMinor, 21_000);     // ₦210
  assert.equal(f.platformGrossMinor, 219_000);    // ₦2,190 = markup 2000 + margin 400 − fee 210
  assert.equal(f.refundedMinor, 0);
  assert.equal(f.settlementOutstandingMinor, 1_000_000);
  assert.equal(f.balanced, true);
});

test("[3] entry ids are deterministic — a retried write is the same row", () => {
  const a = paid().map((e) => e.entryId).sort();
  const b = paid().map((e) => e.entryId).sort();
  assert.deepEqual(a, b);
  assert.equal(new Set(a).size, a.length, "no duplicate ids within one set");
  for (const id of a) assert.match(id, /^RF-1__/);
});

test("[4] every entry names a declared account", () => {
  for (const e of paid()) assert.ok((ACCOUNTS as readonly string[]).includes(e.account), e.account);
});

test("[5] zero-value entries are omitted, not stored as noise", () => {
  const noTax = entriesForPayment({
    orderId: "RF-2", restaurantId: "r", nowMs: T0, createdBy: "t",
    snapshot: buildSnapshot({
      lines: [{ dishId: "d", name: "D", quantity: 1, basePriceMinor: 500_000 }],
      config, deliveryFeeMinor: 0, deliveryCostMinor: 0, quoteId: null, nowMs: T0,
    }),
  });
  assert.equal(noTax.some((e) => e.amountMinor === 0), false);
  assert.equal(isBalanced(noTax), true);
});

test("[6] a FULL refund appends, and never edits history", () => {
  const before = paid();
  const frozen = JSON.parse(JSON.stringify(before));
  const refund = entriesForRefund({
    orderId: "RF-1", restaurantId: "trishas", snapshot, kind: "full",
    absorbedBy: { restaurantMinor: 1_000_000, platformMinor: 240_000, deliveryMinor: 160_000 },
    nowMs: T0 + 1000, createdBy: "ops", reason: "restaurant rejected", seq: 1,
  });
  assert.deepEqual(before, frozen, "the original entries are untouched");

  const all = [...before, ...refund];
  const f = summarise(all, snapshot);
  assert.equal(f.refundedMinor, 1_400_000);
  assert.equal(f.restaurantOwedMinor, 0, "the restaurant is no longer owed for a rejected order");
  assert.equal(f.deliveryOwedMinor, 0);
});

test("[7] a refund's absorption must be STATED, and it changes who pays", () => {
  const restaurantAbsorbs = entriesForRefund({
    orderId: "RF-1", restaurantId: "t", snapshot, kind: "food_only",
    absorbedBy: { restaurantMinor: 1_000_000, platformMinor: 200_000, deliveryMinor: 0 },
    nowMs: T0, createdBy: "ops", reason: "item unavailable", seq: 1,
  });
  const platformAbsorbs = entriesForRefund({
    orderId: "RF-1", restaurantId: "t", snapshot, kind: "food_only",
    absorbedBy: { restaurantMinor: 0, platformMinor: 1_200_000, deliveryMinor: 0 },
    nowMs: T0, createdBy: "ops", reason: "goodwill", seq: 1,
  });
  assert.equal(deriveBalances([...paid(), ...restaurantAbsorbs]).restaurant_payable, 0);
  assert.equal(deriveBalances([...paid(), ...platformAbsorbs]).restaurant_payable, 1_000_000,
    "a goodwill refund must not claw back money from the kitchen");
});

test("[8] a DELIVERY-FAILED refund can leave the restaurant paid", () => {
  // The food was cooked and collected. Refunding the customer is a platform
  // cost, not the kitchen's problem.
  const refund = entriesForRefund({
    orderId: "RF-1", restaurantId: "t", snapshot, kind: "full",
    absorbedBy: { restaurantMinor: 0, platformMinor: 1_240_000, deliveryMinor: 160_000 },
    nowMs: T0, createdBy: "ops", reason: "delivery failed after pickup", seq: 1,
  });
  const f = summarise([...paid(), ...refund], snapshot);
  assert.equal(f.restaurantOwedMinor, 1_000_000);
  assert.equal(f.refundedMinor, 1_400_000);
  assert.equal(f.platformGrossMinor, 219_000 - 1_240_000, "the platform eats it, visibly");
});

test("[9] TWO partial refunds compose without colliding", () => {
  const first = entriesForRefund({
    orderId: "RF-1", restaurantId: "t", snapshot, kind: "food_only",
    absorbedBy: { restaurantMinor: 300_000, platformMinor: 0, deliveryMinor: 0 },
    nowMs: T0, createdBy: "ops", reason: "one item missing", seq: 1,
  });
  const second = entriesForRefund({
    orderId: "RF-1", restaurantId: "t", snapshot, kind: "delivery_only",
    absorbedBy: { restaurantMinor: 0, platformMinor: 40_000, deliveryMinor: 160_000 },
    nowMs: T0 + 60_000, createdBy: "ops", reason: "very late", seq: 2,
  });
  const ids = [...first, ...second].map((e) => e.entryId);
  assert.equal(new Set(ids).size, ids.length, "a second refund must not overwrite the first");
  const f = summarise([...paid(), ...first, ...second], snapshot);
  assert.equal(f.refundedMinor, 500_000);
  assert.equal(f.restaurantOwedMinor, 700_000);
});

test("[10] REPLAY: re-issuing the same refund yields the same ids (a no-op write)", () => {
  const args = {
    orderId: "RF-1", restaurantId: "t", snapshot, kind: "full" as const,
    absorbedBy: { restaurantMinor: 1_000_000, platformMinor: 240_000, deliveryMinor: 160_000 },
    nowMs: T0, createdBy: "ops", reason: "r", seq: 1,
  };
  assert.deepEqual(
    entriesForRefund(args).map((e) => e.entryId),
    entriesForRefund({ ...args, nowMs: T0 + 99_999 }).map((e) => e.entryId),
    "identity must not depend on when the retry happened"
  );
});

test("[11] an adjustment is a paired, attributed move — never a silent edit", () => {
  const adj = entriesForAdjustment({
    orderId: "RF-1", restaurantId: "t", from: "platform_revenue", to: "restaurant_payable",
    amountMinor: 50_000, nowMs: T0, createdBy: "finance@restoflow", reason: "agreed goodwill", seq: 1,
  });
  assert.equal(adj.length, 2);
  assert.equal(adj[0].amountMinor + adj[1].amountMinor, 0, "an adjustment moves value, it does not create it");
  assert.equal(isBalanced([...paid(), ...adj]), true);
  for (const e of adj) assert.equal(e.createdBy, "finance@restoflow");
});

test("[12] a settlement payout reduces the outstanding balance to zero", () => {
  const payout: LedgerEntry[] = [
    { entryId: "RF-1__settlement_payout__restaurant_payable", orderId: "RF-1", restaurantId: "t",
      currency: "NGN", kind: "settlement_payout", account: "restaurant_payable",
      amountMinor: -1_000_000, createdAt: T0, createdBy: "payout-run", note: "August" },
    { entryId: "RF-1__settlement_payout__platform_revenue", orderId: "RF-1", restaurantId: "t",
      currency: "NGN", kind: "settlement_payout", account: "platform_revenue",
      amountMinor: 1_000_000, createdAt: T0, createdBy: "payout-run", note: "August" },
  ];
  const f = summarise([...paid(), ...payout], snapshot);
  assert.equal(f.settlementOutstandingMinor, 0);
  assert.equal(f.restaurantOwedMinor, 0);
});

test("[13] balances are DERIVED — there is no stored figure to drift", () => {
  const b = deriveBalances(paid());
  assert.equal(b.customer, -1_400_000);
  assert.equal(b.restaurant_payable + b.delivery_payable + b.platform_revenue + b.processor + b.tax_payable, 1_400_000);
});

test("[14] the entry set stays balanced across 500 randomised orders", () => {
  let rng = 7;
  const rand = (n: number) => { rng = (rng * 1103515245 + 12345) & 0x7fffffff; return rng % n; };
  for (let i = 0; i < 500; i++) {
    const cost = rand(300_000);
    const s = buildSnapshot({
      lines: [{ dishId: "d", name: "D", quantity: 1 + rand(4), basePriceMinor: 50_000 + rand(2_000_000) }],
      config: { ...config, restaurantDefault: { type: "percent", bps: rand(4000) } },
      deliveryFeeMinor: cost + rand(60_000), deliveryCostMinor: cost,
      processorFeeMinor: rand(40_000), taxMinor: rand(10_000),
      quoteId: null, nowMs: T0,
    });
    const e = entriesForPayment({ orderId: `RF-${i}`, restaurantId: "t", snapshot: s, nowMs: T0, createdBy: "t" });
    assert.equal(isBalanced(e), true, `iteration ${i}`);
  }
});

console.log(`\n${passed} checks passed\n`);
