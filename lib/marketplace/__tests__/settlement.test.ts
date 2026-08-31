// Settlement: never paid twice, refunds reduce the payable, human-gated.
// Run: npx tsx lib/marketplace/__tests__/settlement.test.ts

import assert from "node:assert/strict";
import type { LedgerEntry } from "../ledger";
import {
  calculateSettlement, canTransition, outstandingFor, executePayout, payoutEntries,
  SETTLEMENT_STATES, type Settlement, type SettlementStore, type SettlementState, type PayoutAttempt,
} from "../settlement";

let passed = 0;
const test = async (name: string, fn: () => Promise<void> | void) => { await fn(); passed++; console.log(`  ✓ ${name}`); };
console.log("marketplace/settlement");

const T0 = 1_756_000_000_000;
const PERIOD_END = T0 + 7 * 86_400_000;

const entry = (over: Partial<LedgerEntry>): LedgerEntry => ({
  entryId: "e", orderId: "o1", restaurantId: "trishas", currency: "NGN",
  kind: "food_base", account: "restaurant_payable", amountMinor: 0,
  createdAt: T0 + 1000, createdBy: "t", note: "", ...over,
});

class FakeSettlementStore implements SettlementStore {
  settlements = new Map<string, Settlement>();
  ledger: LedgerEntry[] = [];
  transitions: Array<[SettlementState, SettlementState]> = [];
  async get(id: string) { return this.settlements.get(id) ?? null; }
  async transition(id: string, from: SettlementState, to: SettlementState, patch: Partial<Settlement>) {
    const s = this.settlements.get(id);
    if (!s || s.state !== from) return false;   // compare-and-set
    this.settlements.set(id, { ...s, ...patch, state: to });
    this.transitions.push([from, to]);
    return true;
  }
  async appendPayoutEntries(entries: LedgerEntry[]) { this.ledger.push(...entries); }
}

const settlement = (over: Partial<Settlement> = {}): Settlement => ({
  settlementId: "st-1", payee: "restaurant", payeeId: "trishas",
  periodStart: T0, periodEnd: PERIOD_END, orderIds: ["o1"],
  grossMinor: 1_000_000, refundsMinor: 0, adjustmentsMinor: 0, netPayableMinor: 1_000_000,
  state: "APPROVED", providerReference: null, approvedBy: "ops", approvedAt: T0,
  paidAt: null, failureReason: null, createdAt: T0, ...over,
});

const succeeded = async (): Promise<PayoutAttempt> => ({ status: "succeeded", providerReference: "tr_1", failureReason: null });

async function main() {

await test("[1] a settlement is CALCULATED from ledger entries, never typed in", () => {
  const s = calculateSettlement({
    settlementId: "st-1", payee: "restaurant", payeeId: "trishas",
    periodStart: T0, periodEnd: PERIOD_END, nowMs: T0,
    entries: [
      entry({ entryId: "a", amountMinor: 1_000_000 }),
      entry({ entryId: "b", orderId: "o2", amountMinor: 500_000 }),
    ],
  });
  assert.equal(s.grossMinor, 1_500_000);
  assert.equal(s.netPayableMinor, 1_500_000);
  assert.equal(s.state, "CALCULATED");
  assert.deepEqual(s.orderIds.sort(), ["o1", "o2"]);
});

await test("[2] REFUNDS reduce the payable simply by being summed", () => {
  const s = calculateSettlement({
    settlementId: "st-1", payee: "restaurant", payeeId: "trishas",
    periodStart: T0, periodEnd: PERIOD_END, nowMs: T0,
    entries: [
      entry({ entryId: "a", amountMinor: 1_000_000 }),
      entry({ entryId: "b", kind: "refund_full", amountMinor: -400_000 }),
    ],
  });
  assert.equal(s.grossMinor, 1_000_000);
  assert.equal(s.refundsMinor, 400_000);
  assert.equal(s.netPayableMinor, 600_000);
});

await test("[3] a payout already made in the period is not owed again", () => {
  const s = calculateSettlement({
    settlementId: "st-2", payee: "restaurant", payeeId: "trishas",
    periodStart: T0, periodEnd: PERIOD_END, nowMs: T0,
    entries: [
      entry({ entryId: "a", amountMinor: 1_000_000 }),
      entry({ entryId: "b", kind: "settlement_payout", amountMinor: -1_000_000 }),
    ],
  });
  assert.equal(s.netPayableMinor, 0);
  assert.equal(s.state, "NEEDS_ATTENTION", "nothing to pay needs a person, not a zero transfer");
});

await test("[4] entries outside the period are excluded", () => {
  const s = calculateSettlement({
    settlementId: "st-1", payee: "restaurant", payeeId: "trishas",
    periodStart: T0, periodEnd: PERIOD_END, nowMs: T0,
    entries: [
      entry({ entryId: "a", amountMinor: 1_000_000, createdAt: T0 + 1000 }),
      entry({ entryId: "b", amountMinor: 999_999, createdAt: PERIOD_END + 1 }),
      entry({ entryId: "c", amountMinor: 888_888, createdAt: T0 - 1 }),
    ],
  });
  assert.equal(s.grossMinor, 1_000_000);
});

await test("[5] restaurant and courier settlements read DIFFERENT accounts", () => {
  const entries = [
    entry({ entryId: "a", account: "restaurant_payable", amountMinor: 1_000_000 }),
    entry({ entryId: "b", account: "delivery_payable", amountMinor: 160_000 }),
  ];
  const r = calculateSettlement({ settlementId: "r", payee: "restaurant", payeeId: "t", periodStart: T0, periodEnd: PERIOD_END, entries, nowMs: T0 });
  const c = calculateSettlement({ settlementId: "c", payee: "courier_provider", payeeId: "dispatcher", periodStart: T0, periodEnd: PERIOD_END, entries, nowMs: T0 });
  assert.equal(r.netPayableMinor, 1_000_000);
  assert.equal(c.netPayableMinor, 160_000);
});

await test("[6] a negative net needs a human, not a negative transfer", () => {
  const s = calculateSettlement({
    settlementId: "st-1", payee: "restaurant", payeeId: "t",
    periodStart: T0, periodEnd: PERIOD_END, nowMs: T0,
    entries: [
      entry({ entryId: "a", amountMinor: 100_000 }),
      entry({ entryId: "b", kind: "refund_full", amountMinor: -500_000 }),
    ],
  });
  assert.ok(s.netPayableMinor < 0);
  assert.equal(s.state, "NEEDS_ATTENTION");
});

await test("[7] the state machine has a human gate, and PAID is terminal", () => {
  assert.equal(canTransition("CALCULATED", "APPROVED"), true);
  assert.equal(canTransition("CALCULATED", "PAYOUT_PENDING"), false, "no payout without approval");
  assert.equal(canTransition("APPROVED", "PAYOUT_PENDING"), true);
  assert.equal(canTransition("PAYOUT_PENDING", "PAID"), true);
  for (const to of SETTLEMENT_STATES) assert.equal(canTransition("PAID", to), false, `PAID → ${to}`);
  assert.equal(canTransition("FAILED", "APPROVED"), true, "a failed payout may be retried");
});

await test("[8] a payout pays, records the ledger, and marks PAID", async () => {
  const store = new FakeSettlementStore();
  store.settlements.set("st-1", settlement());
  const r = await executePayout({
    settlementId: "st-1", store, callProvider: succeeded,
    buildEntries: payoutEntries, nowMs: T0,
  });
  assert.equal(r.outcome, "paid");
  assert.equal(store.settlements.get("st-1")!.state, "PAID");
  assert.equal(store.ledger.length, 2);
  assert.equal(store.ledger[0].amountMinor + store.ledger[1].amountMinor, 0, "a payout moves value, it does not create it");
});

await test("[9] NEVER TWICE: a second payout is refused and does not call the provider", async () => {
  const store = new FakeSettlementStore();
  store.settlements.set("st-1", settlement());
  let calls = 0;
  const provider = async () => { calls++; return succeeded(); };
  await executePayout({ settlementId: "st-1", store, callProvider: provider, buildEntries: payoutEntries, nowMs: T0 });
  const again = await executePayout({ settlementId: "st-1", store, callProvider: provider, buildEntries: payoutEntries, nowMs: T0 + 1000 });
  assert.equal(again.outcome, "already_paid");
  assert.equal(calls, 1);
  assert.equal(store.ledger.length, 2, "no second set of payout entries");
});

await test("[10] CONCURRENT payouts produce ONE transfer", async () => {
  const store = new FakeSettlementStore();
  store.settlements.set("st-1", settlement());
  let calls = 0;
  const provider = async () => { calls++; return succeeded(); };
  const results = await Promise.all([
    executePayout({ settlementId: "st-1", store, callProvider: provider, buildEntries: payoutEntries, nowMs: T0 }),
    executePayout({ settlementId: "st-1", store, callProvider: provider, buildEntries: payoutEntries, nowMs: T0 }),
  ]);
  assert.equal(calls, 1, "the compare-and-set into PAYOUT_PENDING is the guard");
  assert.equal(results.filter((r) => r.outcome === "paid").length, 1);
});

await test("[11] an UNAPPROVED settlement cannot be paid", async () => {
  const store = new FakeSettlementStore();
  store.settlements.set("st-1", settlement({ state: "CALCULATED" }));
  const r = await executePayout({ settlementId: "st-1", store, callProvider: succeeded, buildEntries: payoutEntries, nowMs: T0 });
  assert.equal(r.outcome, "refused");
  assert.match((r as { reason: string }).reason, /APPROVED/);
});

await test("[12] TIMEOUT SAFETY: a provider throw leaves it PAYOUT_PENDING, not APPROVED", async () => {
  const store = new FakeSettlementStore();
  store.settlements.set("st-1", settlement());
  const r = await executePayout({
    settlementId: "st-1", store, buildEntries: payoutEntries, nowMs: T0,
    callProvider: async () => { throw new Error("ETIMEDOUT"); },
  });
  assert.equal(r.outcome, "pending");
  assert.equal(store.settlements.get("st-1")!.state, "PAYOUT_PENDING",
    "releasing it back to APPROVED is how a restaurant is paid twice");

  let calls = 0;
  const again = await executePayout({
    settlementId: "st-1", store, buildEntries: payoutEntries, nowMs: T0 + 5000,
    callProvider: async () => { calls++; return succeeded(); },
  });
  assert.equal(again.outcome, "pending");
  assert.equal(calls, 0);
});

await test("[13] a declined transfer becomes FAILED and is retryable", async () => {
  const store = new FakeSettlementStore();
  store.settlements.set("st-1", settlement());
  const r = await executePayout({
    settlementId: "st-1", store, buildEntries: payoutEntries, nowMs: T0,
    callProvider: async () => ({ status: "failed", providerReference: null, failureReason: "account closed" }),
  });
  assert.equal(r.outcome, "failed");
  assert.equal(store.settlements.get("st-1")!.state, "FAILED");
  assert.equal(store.settlements.get("st-1")!.failureReason, "account closed");
  assert.equal(store.ledger.length, 0, "no money moved, so nothing is recorded");
});

await test("[14] the ledger is written BEFORE the settlement is marked paid", async () => {
  const store = new FakeSettlementStore();
  store.settlements.set("st-1", settlement());
  const order: string[] = [];
  const spy = new Proxy(store, {
    get(t, k) {
      if (k === "appendPayoutEntries") return async (e: LedgerEntry[]) => { order.push("ledger"); return t.appendPayoutEntries(e); };
      if (k === "transition") return async (...a: Parameters<SettlementStore["transition"]>) => {
        if (a[2] === "PAID") order.push("paid");
        return t.transition(...a);
      };
      return Reflect.get(t, k);
    },
  }) as SettlementStore;
  await executePayout({ settlementId: "st-1", store: spy, callProvider: succeeded, buildEntries: payoutEntries, nowMs: T0 });
  assert.deepEqual(order, ["ledger", "paid"],
    "a crash between the two must leave a settlement that looks unpaid, not one that looks paid with no record");
});

await test("[15] nothing to pay is refused", async () => {
  const store = new FakeSettlementStore();
  store.settlements.set("st-1", settlement({ netPayableMinor: 0 }));
  const r = await executePayout({ settlementId: "st-1", store, callProvider: succeeded, buildEntries: payoutEntries, nowMs: T0 });
  assert.equal(r.outcome, "refused");
});

await test("[16] outstanding balances drive the ops board and derive from entries", () => {
  const entries = [
    entry({ entryId: "a", amountMinor: 1_000_000 }),
    entry({ entryId: "b", account: "delivery_payable", amountMinor: 160_000 }),
    entry({ entryId: "c", kind: "refund_full", amountMinor: -300_000 }),
  ];
  assert.equal(outstandingFor(entries, "restaurant"), 700_000);
  assert.equal(outstandingFor(entries, "courier_provider"), 160_000);
});

await test("[17] payout entry ids are deterministic — a retry is the same row", () => {
  const a = payoutEntries(settlement(), T0).map((e) => e.entryId);
  const b = payoutEntries(settlement(), T0 + 9999).map((e) => e.entryId);
  assert.deepEqual(a, b);
  assert.equal(new Set(a).size, a.length);
});

}

main().then(() => console.log(`\n${passed} checks passed\n`))
  .catch((e) => { console.error(e); process.exit(1); });
