// The payment lifecycle: one payment → one order, under every replay.
// Run: npx tsx lib/marketplace/__tests__/payment.test.ts

import assert from "node:assert/strict";
import { buildSnapshot, type PricingConfig } from "../pricing";
import {
  settlePayment, isIntentExpired, processorFeeDelta, INTENT_TTL_MS,
  type PaymentIntent, type PaymentStore, type ProviderVerification,
} from "../payment";

let passed = 0;
const test = async (name: string, fn: () => Promise<void> | void) => { await fn(); passed++; console.log(`  ✓ ${name}`); };
console.log("marketplace/payment");

const T0 = 1_756_000_000_000;
const config: PricingConfig = {
  platformDefault: { type: "percent", bps: 2000 },
  restaurantDefault: null, roundToMinor: 5000, rulesVersion: 1,
};
const snapshot = buildSnapshot({
  lines: [{ dishId: "d1", name: "Jollof", quantity: 1, basePriceMinor: 1_000_000 }],
  config, deliveryFeeMinor: 200_000, deliveryCostMinor: 160_000,
  processorFeeMinor: 21_000, quoteId: "QT-1", nowMs: T0,
});

const intent = (over: Partial<PaymentIntent> = {}): PaymentIntent => ({
  reference: "pay_1", restaurantId: "trishas", customerId: "cust-1",
  customerFirstName: "Amaka", customerPhone: "+2348111111111",
  deliveryAddress: "2 Mobolaji Bank", deliveryLocation: { lat: 6.57, lng: 3.36 },
  note: "", items: [{ dishId: "d1", menuItemId: "d1", name: "Jollof", quantity: 1, options: [], note: "" }],
  pricing: snapshot, quoteId: "QT-1", prepMins: 25, correlationId: "corr-1",
  createdAt: T0, expiresAt: T0 + INTENT_TTL_MS,
  ...over,
});

/** Models the ONE property that matters: materialise is keyed on the reference. */
class FakeStore implements PaymentStore {
  intents = new Map<string, PaymentIntent>();
  orders = new Map<string, string>();   // reference → orderId
  failures: Array<{ reference: string; reason: string }> = [];
  materialiseCalls = 0;
  private seq = 0;

  seed(i: PaymentIntent) { this.intents.set(i.reference, i); return this; }
  async getOrderIdByReference(reference: string) { return this.orders.get(reference) ?? null; }
  async getIntent(reference: string) { return this.intents.get(reference) ?? null; }

  async materialiseOrder(args: { reference: string }) {
    this.materialiseCalls++;
    const existing = this.orders.get(args.reference);
    if (existing) return { orderId: existing, created: false };
    const orderId = `order_${++this.seq}`;
    this.orders.set(args.reference, orderId);
    this.intents.delete(args.reference);   // the intent is consumed
    return { orderId, created: true };
  }

  async recordFailure(reference: string, reason: string) { this.failures.push({ reference, reason }); }
}

const verified = (over: Partial<ProviderVerification> = {}): ProviderVerification => ({
  reference: "pay_1", status: "success", amountMinor: snapshot.totalChargedMinor, feeMinor: 21_000, ...over,
});

async function main() {

await test("[1] a verified payment creates exactly one order", async () => {
  const store = new FakeStore().seed(intent());
  const r = await settlePayment({ verification: verified(), store, nowMs: T0 });
  assert.equal(r.outcome, "created");
  assert.equal(store.orders.size, 1);
});

await test("[2] DUPLICATE WEBHOOK: the second call replays, never creates", async () => {
  const store = new FakeStore().seed(intent());
  const a = await settlePayment({ verification: verified(), store, nowMs: T0 });
  const b = await settlePayment({ verification: verified(), store, nowMs: T0 + 500 });
  assert.equal(a.outcome, "created");
  assert.equal(b.outcome, "replayed");
  assert.equal((a as { orderId: string }).orderId, (b as { orderId: string }).orderId);
  assert.equal(store.orders.size, 1);
});

await test("[3] TEN replays from three entry points still yield one order", async () => {
  // webhook, client callback and the reconciliation sweep all racing.
  const store = new FakeStore().seed(intent());
  const ids = new Set<string>();
  for (let i = 0; i < 10; i++) {
    const r = await settlePayment({ verification: verified(), store, nowMs: T0 + i });
    ids.add((r as { orderId: string }).orderId);
  }
  assert.equal(ids.size, 1);
  assert.equal(store.orders.size, 1);
});

await test("[4] CONCURRENT settlement produces one order", async () => {
  const store = new FakeStore().seed(intent());
  const results = await Promise.all(
    Array.from({ length: 5 }, () => settlePayment({ verification: verified(), store, nowMs: T0 }))
  );
  assert.equal(store.orders.size, 1);
  assert.equal(results.filter((r) => r.outcome === "created").length, 1);
});

await test("[5] a PENDING payment does nothing at all", async () => {
  const store = new FakeStore().seed(intent());
  const r = await settlePayment({ verification: verified({ status: "pending" }), store, nowMs: T0 });
  assert.equal(r.outcome, "pending");
  assert.equal(store.orders.size, 0);
  assert.equal(store.materialiseCalls, 0);
});

await test("[6] a FAILED payment records the failure and creates no order", async () => {
  const store = new FakeStore().seed(intent());
  const r = await settlePayment({ verification: verified({ status: "failed" }), store, nowMs: T0 });
  assert.equal(r.outcome, "failed");
  assert.equal(store.orders.size, 0);
  assert.equal(store.failures.length, 1);
});

await test("[6b] a duplicate webhook AFTER the intent is consumed still replays", async () => {
  // The intent is deleted when the order is created, so without an
  // order-by-reference check this reported `no_intent` — indistinguishable
  // from a payment that was never ours.
  const store = new FakeStore().seed(intent());
  await settlePayment({ verification: verified(), store, nowMs: T0 });
  assert.equal(store.intents.size, 0, "the intent is consumed");
  const again = await settlePayment({ verification: verified(), store, nowMs: T0 + 60_000 });
  assert.equal(again.outcome, "replayed");
  assert.equal(store.orders.size, 1);
});

await test("[7] a payment with NO intent never creates an order", async () => {
  // Another product on the same Paystack account, or an expired intent.
  const store = new FakeStore();
  const r = await settlePayment({ verification: verified({ reference: "someone_elses" }), store, nowMs: T0 });
  assert.equal(r.outcome, "no_intent");
  assert.equal(store.orders.size, 0);
});

await test("[8] AMOUNT MISMATCH is refused — we never accept a wrong price", async () => {
  const store = new FakeStore().seed(intent());
  const r = await settlePayment({ verification: verified({ amountMinor: 100_000 }), store, nowMs: T0 });
  assert.equal(r.outcome, "amount_mismatch");
  assert.equal((r as { expectedMinor: number }).expectedMinor, 1_400_000);
  assert.equal(store.orders.size, 0);
});

await test("[9] the amount is checked against the FROZEN snapshot", async () => {
  // Even if the menu changed since checkout, the intent's snapshot is the truth.
  const store = new FakeStore().seed(intent());
  const r = await settlePayment({ verification: verified({ amountMinor: snapshot.totalChargedMinor }), store, nowMs: T0 + 86_400_000 });
  assert.equal(r.outcome, "created");
});

await test("[10] there is no such thing as an unpaid marketplace order", async () => {
  const store = new FakeStore().seed(intent());
  for (const status of ["pending", "failed"] as const) {
    await settlePayment({ verification: verified({ status }), store, nowMs: T0 });
  }
  assert.equal(store.orders.size, 0, "an order exists only after money arrives");
});

await test("[11] intent expiry is a plain clock comparison", () => {
  const i = intent();
  assert.equal(isIntentExpired(i, T0), false);
  assert.equal(isIntentExpired(i, T0 + INTENT_TTL_MS - 1), false);
  assert.equal(isIntentExpired(i, T0 + INTENT_TTL_MS + 1), true);
});

await test("[12] the processor fee delta corrects an estimate without editing the snapshot", () => {
  assert.equal(processorFeeDelta(snapshot, verified({ feeMinor: 25_000 })), 4_000);
  assert.equal(processorFeeDelta(snapshot, verified({ feeMinor: 21_000 })), 0);
  assert.equal(processorFeeDelta(snapshot, verified({ feeMinor: null })), 0, "no report → no correction");
  assert.equal(snapshot.processorFeeMinor, 21_000, "the snapshot itself is untouched");
});

await test("[13] the correlation id survives from checkout into the order", async () => {
  const store = new FakeStore().seed(intent({ correlationId: "corr-trace-me" }));
  const logs: Array<Record<string, unknown>> = [];
  await settlePayment({ verification: verified(), store, nowMs: T0, log: (_e, f) => logs.push(f) });
  assert.equal(logs[0].correlationId, "corr-trace-me");
});

}

main().then(() => console.log(`\n${passed} checks passed\n`))
  .catch((e) => { console.error(e); process.exit(1); });
