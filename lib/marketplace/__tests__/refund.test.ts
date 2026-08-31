// Refund execution: never twice, never rewriting history, timeout-safe.
// Run: npx tsx lib/marketplace/__tests__/refund.test.ts

import assert from "node:assert/strict";
import { buildSnapshot, type PricingConfig } from "../pricing";
import { isBalanced, type LedgerEntry } from "../ledger";
import {
  executeRefund, reconcileRefund, absorptionFor, refundClaimId,
  type RefundStore, type RefundClaim, type ProviderRefund, type RefundRequest,
} from "../refund";

let passed = 0;
const test = async (name: string, fn: () => Promise<void> | void) => { await fn(); passed++; console.log(`  ✓ ${name}`); };
console.log("marketplace/refund");

const T0 = 1_756_000_000_000;
const config: PricingConfig = {
  platformDefault: { type: "percent", bps: 2000 },
  restaurantDefault: null, roundToMinor: 5000, rulesVersion: 1,
};
// ₦10,000 food → ₦12,000 customer, ₦2,000 delivery (₦1,600 cost) = ₦14,000
const snapshot = buildSnapshot({
  lines: [{ dishId: "d", name: "Jollof", quantity: 1, basePriceMinor: 1_000_000 }],
  config, deliveryFeeMinor: 200_000, deliveryCostMinor: 160_000,
  processorFeeMinor: 21_000, quoteId: null, nowMs: T0,
});

class FakeRefundStore implements RefundStore {
  claims = new Map<string, RefundClaim>();
  ledger: LedgerEntry[] = [];
  refunded = 0;
  orderState: { state: string; total: number } | null = null;
  providerCalls = 0;

  async getClaim(claimId: string) { return this.claims.get(claimId) ?? null; }
  async claimRefund(c: { claimId: string; orderId: string; reference: string; amountMinor: number; nowMs: number }) {
    const existing = this.claims.get(c.claimId);
    if (existing && existing.state !== "failed") return { claimed: false, existing };
    this.claims.set(c.claimId, {
      claimId: c.claimId, orderId: c.orderId, reference: c.reference, amountMinor: c.amountMinor,
      state: "in_flight", providerReference: null, createdAt: c.nowMs, resolvedAt: null,
    });
    return { claimed: true, existing: existing ?? null };
  }
  async resolveClaim(claimId: string, o: { state: "succeeded" | "failed"; providerReference: string | null; nowMs: number }) {
    const c = this.claims.get(claimId)!;
    this.claims.set(claimId, { ...c, state: o.state, providerReference: o.providerReference, resolvedAt: o.nowMs });
  }
  async appendLedger(entries: LedgerEntry[]) { this.ledger.push(...entries); }
  async refundedTotal() { return this.refunded; }
  async setOrderRefundState(_o: string, state: "partial" | "full" | "failed", total: number) {
    this.orderState = { state, total };
    if (state !== "failed") this.refunded = total;
  }
}

const req = (over: Partial<RefundRequest> = {}): RefundRequest => ({
  orderId: "order_1", restaurantId: "trishas", reference: "pay_1",
  snapshot, kind: "full", reason: "restaurant_rejected",
  amountMinor: snapshot.totalChargedMinor, requestedBy: "ops@restoflow", seq: 1,
  ...over,
});

const ok = async (): Promise<ProviderRefund> => ({ status: "succeeded", providerReference: "rf_1", raw: {} });

async function main() {

await test("[1] a refund executes, appends entries, and marks the order refunded", async () => {
  const store = new FakeRefundStore();
  const r = await executeRefund({ request: req(), store, callProvider: ok, nowMs: T0 });
  assert.equal(r.outcome, "refunded");
  assert.ok(store.ledger.length > 0);
  assert.equal(store.orderState?.state, "full");
  assert.equal(store.orderState?.total, 1_400_000);
});

await test("[2] NEVER TWICE: a duplicate request replays and does not call the provider", async () => {
  const store = new FakeRefundStore();
  let calls = 0;
  const provider = async () => { calls++; return ok(); };
  const a = await executeRefund({ request: req(), store, callProvider: provider, nowMs: T0 });
  const b = await executeRefund({ request: req(), store, callProvider: provider, nowMs: T0 + 1000 });
  assert.equal(a.outcome, "refunded");
  assert.equal(b.outcome, "replayed");
  assert.equal(calls, 1, "the provider must be called exactly once");
});

await test("[3] the claim is deterministic in (order, seq)", () => {
  assert.equal(refundClaimId("order_1", 1), refundClaimId("order_1", 1));
  assert.notEqual(refundClaimId("order_1", 1), refundClaimId("order_1", 2));
  assert.notEqual(refundClaimId("order_1", 1), refundClaimId("order_2", 1));
});

await test("[4] TIMEOUT SAFETY: a provider throw leaves the claim IN FLIGHT, not retryable", async () => {
  const store = new FakeRefundStore();
  const r = await executeRefund({
    request: req(), store, nowMs: T0,
    callProvider: async () => { throw new Error("ETIMEDOUT"); },
  });
  assert.equal(r.outcome, "in_flight");
  assert.equal(store.claims.get(refundClaimId("order_1", 1))!.state, "in_flight");

  // A retry must NOT call the provider again — the first call may have worked.
  let calls = 0;
  const again = await executeRefund({
    request: req(), store, nowMs: T0 + 5000,
    callProvider: async () => { calls++; return ok(); },
  });
  assert.equal(again.outcome, "in_flight");
  assert.equal(calls, 0, "refunding again after a timeout is how a customer is paid twice");
});

await test("[5] a genuinely FAILED refund is retryable — the money definitely did not move", async () => {
  const store = new FakeRefundStore();
  const failed = await executeRefund({
    request: req(), store, nowMs: T0,
    callProvider: async () => ({ status: "failed", providerReference: null, raw: {} }),
  });
  assert.equal(failed.outcome, "provider_failed");
  const retry = await executeRefund({ request: req(), store, callProvider: ok, nowMs: T0 + 1000 });
  assert.equal(retry.outcome, "refunded");
});

await test("[6] a refund NEVER exceeds what is left refundable", async () => {
  const store = new FakeRefundStore();
  store.refunded = 1_000_000;
  const r = await executeRefund({
    request: req({ amountMinor: 1_400_000 }), store, callProvider: ok, nowMs: T0,
  });
  assert.equal(r.outcome, "exceeds_refundable");
  assert.equal((r as { refundableMinor: number }).refundableMinor, 400_000);
});

await test("[7] a non-positive or fractional amount is refused", async () => {
  const store = new FakeRefundStore();
  for (const amountMinor of [0, -100, 12.5]) {
    const r = await executeRefund({ request: req({ amountMinor }), store, callProvider: ok, nowMs: T0 });
    assert.equal(r.outcome, "invalid", String(amountMinor));
  }
});

await test("[8] TWO partial refunds compose and do not collide", async () => {
  const store = new FakeRefundStore();
  const first = await executeRefund({
    request: req({ kind: "food_only", amountMinor: 300_000, reason: "item_unavailable", seq: 1 }),
    store, callProvider: ok, nowMs: T0,
  });
  const second = await executeRefund({
    request: req({ kind: "delivery_only", amountMinor: 200_000, reason: "goodwill", seq: 2 }),
    store, callProvider: ok, nowMs: T0 + 60_000,
  });
  assert.equal(first.outcome, "refunded");
  assert.equal(second.outcome, "refunded");
  assert.equal(store.orderState?.total, 500_000);
  assert.equal(store.orderState?.state, "partial");
  const ids = store.ledger.map((e) => e.entryId);
  assert.equal(new Set(ids).size, ids.length, "a second refund must not overwrite the first");
});

await test("[9] ABSORPTION: a restaurant rejection claws the food back", async () => {
  const a = absorptionFor("restaurant_rejected", snapshot);
  assert.equal(a.restaurantMinor, 1_000_000);
  assert.equal(a.deliveryMinor, 160_000);
});

await test("[10] ABSORPTION: a post-pickup failure leaves the kitchen paid", async () => {
  const a = absorptionFor("delivery_failed_post_pickup", snapshot);
  assert.equal(a.restaurantMinor, 0, "the food was cooked and collected");
  assert.equal(a.platformMinor, 1_000_000 + 200_000 + 40_000);
  assert.equal(a.deliveryMinor, 160_000);
});

await test("[11] ABSORPTION: pre- and post-pickup failures are treated DIFFERENTLY", async () => {
  const pre = absorptionFor("delivery_failed_pre_pickup", snapshot);
  const post = absorptionFor("delivery_failed_post_pickup", snapshot);
  assert.notEqual(pre.restaurantMinor, post.restaurantMinor);
  assert.equal(pre.restaurantMinor, 1_000_000);
  assert.equal(post.restaurantMinor, 0);
});

await test("[12] goodwill never claws money out of a kitchen that did nothing wrong", async () => {
  assert.equal(absorptionFor("goodwill", snapshot).restaurantMinor, 0);
});

await test("[13] an operator adjustment has NO default absorption — it must be stated", async () => {
  const a = absorptionFor("operator_adjustment", snapshot);
  assert.deepEqual(a, { restaurantMinor: 0, platformMinor: 0, deliveryMinor: 0 });
});

await test("[14] history is APPENDED, never rewritten", async () => {
  const store = new FakeRefundStore();
  const original: LedgerEntry[] = [{
    entryId: "order_1__customer_payment__customer", orderId: "order_1", restaurantId: "t",
    currency: "NGN", kind: "customer_payment", account: "customer",
    amountMinor: -1_400_000, createdAt: T0, createdBy: "verify", note: "",
  }];
  store.ledger.push(...original);
  const frozen = JSON.parse(JSON.stringify(original));
  await executeRefund({ request: req(), store, callProvider: ok, nowMs: T0 + 1000 });
  assert.deepEqual(store.ledger.slice(0, 1), frozen);
  assert.ok(store.ledger.length > 1);
});

await test("[15] RECONCILE: an in-flight claim is resolved from the provider, not guessed", async () => {
  const store = new FakeRefundStore();
  await executeRefund({ request: req(), store, nowMs: T0, callProvider: async () => { throw new Error("timeout"); } });
  const claim = store.claims.get(refundClaimId("order_1", 1))!;

  const resolved = await reconcileRefund({
    claim, store, snapshot, restaurantId: "trishas", reason: "restaurant_rejected",
    kind: "full", seq: 1, nowMs: T0 + 60_000,
    lookup: async () => ({ status: "succeeded", providerReference: "rf_late", raw: {} }),
  });
  assert.equal(resolved, "resolved_succeeded");
  assert.equal(store.claims.get(claim.claimId)!.state, "succeeded");
  assert.ok(store.ledger.length > 0);
});

await test("[16] RECONCILE: an unknown provider answer leaves the claim in flight", async () => {
  const store = new FakeRefundStore();
  await executeRefund({ request: req(), store, nowMs: T0, callProvider: async () => { throw new Error("timeout"); } });
  const claim = store.claims.get(refundClaimId("order_1", 1))!;
  const out = await reconcileRefund({
    claim, store, snapshot, restaurantId: "t", reason: "goodwill", kind: "full", seq: 1,
    nowMs: T0, lookup: async () => null,
  });
  assert.equal(out, "still_unknown");
  assert.equal(store.claims.get(claim.claimId)!.state, "in_flight");
  assert.equal(store.ledger.length, 0, "nothing may be recorded on a guess");
});

await test("[17] a full refund keeps the ledger balanced", async () => {
  const store = new FakeRefundStore();
  const payment: LedgerEntry[] = [
    { entryId: "p1", orderId: "order_1", restaurantId: "t", currency: "NGN", kind: "customer_payment", account: "customer", amountMinor: -1_400_000, createdAt: T0, createdBy: "v", note: "" },
    { entryId: "p2", orderId: "order_1", restaurantId: "t", currency: "NGN", kind: "food_base", account: "restaurant_payable", amountMinor: 1_000_000, createdAt: T0, createdBy: "v", note: "" },
    { entryId: "p3", orderId: "order_1", restaurantId: "t", currency: "NGN", kind: "delivery_cost", account: "delivery_payable", amountMinor: 160_000, createdAt: T0, createdBy: "v", note: "" },
    { entryId: "p4", orderId: "order_1", restaurantId: "t", currency: "NGN", kind: "processor_fee", account: "processor", amountMinor: 21_000, createdAt: T0, createdBy: "v", note: "" },
    { entryId: "p5", orderId: "order_1", restaurantId: "t", currency: "NGN", kind: "markup", account: "platform_revenue", amountMinor: 219_000, createdAt: T0, createdBy: "v", note: "" },
  ];
  store.ledger.push(...payment);
  assert.equal(isBalanced(store.ledger), true);
  await executeRefund({
    request: req({ absorbedBy: { restaurantMinor: 1_000_000, platformMinor: 240_000, deliveryMinor: 160_000 } }),
    store, callProvider: ok, nowMs: T0 + 1000,
  });
  // customer +1,400,000 vs −1,400,000 absorbed: still zero.
  assert.equal(isBalanced(store.ledger), true);
});

}

main().then(() => console.log(`\n${passed} checks passed\n`))
  .catch((e) => { console.error(e); process.exit(1); });
