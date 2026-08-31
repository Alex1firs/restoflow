// Background workers: idempotent, bounded, retry-safe, and never silently lossy.
// Run: npx tsx lib/marketplace/__tests__/workers.test.ts

import assert from "node:assert/strict";
import { initialProjection, type DeliveryProjection } from "../../delivery/projection";
import {
  confirmSweep, reconcileSweep, intentSweep, BATCH_SIZE,
  type DueOrder, type ConfirmPorts, type ReconcilePorts, type IntentPorts,
} from "../workers";

let passed = 0;
const test = async (name: string, fn: () => Promise<void> | void) => { await fn(); passed++; console.log(`  ✓ ${name}`); };
console.log("marketplace/workers");

const T0 = 1_756_000_000_000;
const proj = (over: Partial<DeliveryProjection> = {}): DeliveryProjection => ({
  ...initialProjection({ correlationId: "c", quoteId: "q", nowMs: T0 }),
  deliveryJobId: "DJ-1", ...over,
});
const due = (id: string, over: Partial<DeliveryProjection> = {}): DueOrder => ({
  orderId: id, restaurantId: "trishas", correlationId: `corr-${id}`, delivery: proj(over), confirmAt: T0,
});
const noop = () => {};

async function main() {

// ── confirmSweep ──────────────────────────────────────────────────────────

await test("[1] a due order is released to riders", async () => {
  const confirmed: string[] = [];
  const ports: ConfirmPorts = {
    findDueForConfirm: async () => [due("o1"), due("o2")],
    confirmDelivery: async ({ orderId }) => { confirmed.push(orderId); return { ok: true, retryable: false }; },
    markAttention: async () => {}, log: noop,
  };
  const r = await confirmSweep(ports, T0);
  assert.deepEqual(confirmed, ["o1", "o2"]);
  assert.equal(r.actioned, 2);
  assert.equal(r.failed, 0);
});

await test("[2] IDEMPOTENT: an order already past REQUESTED is skipped", async () => {
  let calls = 0;
  const ports: ConfirmPorts = {
    findDueForConfirm: async () => [due("o1", { state: "DRIVER_ASSIGNED" })],
    confirmDelivery: async () => { calls++; return { ok: true, retryable: false }; },
    markAttention: async () => {}, log: noop,
  };
  const r = await confirmSweep(ports, T0);
  assert.equal(calls, 0, "the restaurant may have signalled ready and confirmed early");
  assert.equal(r.skipped, 1);
});

await test("[3] a RETRYABLE failure is left due, not escalated", async () => {
  const attention: string[] = [];
  const ports: ConfirmPorts = {
    findDueForConfirm: async () => [due("o1")],
    confirmDelivery: async () => ({ ok: false, retryable: true }),
    markAttention: async (id) => { attention.push(id); }, log: noop,
  };
  const r = await confirmSweep(ports, T0);
  assert.equal(r.failed, 1);
  assert.deepEqual(attention, [], "the next sweep retries it");
});

await test("[4] a DEFINITE refusal escalates — food cooking with no courier is loud", async () => {
  const attention: Array<{ id: string; reason: string }> = [];
  const ports: ConfirmPorts = {
    findDueForConfirm: async () => [due("o1")],
    confirmDelivery: async () => ({ ok: false, retryable: false }),
    markAttention: async (id, reason) => { attention.push({ id, reason }); }, log: noop,
  };
  const r = await confirmSweep(ports, T0);
  assert.deepEqual(r.attention, ["o1"]);
  assert.equal(attention.length, 1);
  assert.match(attention[0].reason, /could not be released/);
});

await test("[5] one bad order does NOT abort the batch", async () => {
  const ports: ConfirmPorts = {
    findDueForConfirm: async () => [due("o1"), due("o2"), due("o3")],
    confirmDelivery: async ({ orderId }) => {
      if (orderId === "o2") throw new Error("network");
      return { ok: true, retryable: false };
    },
    markAttention: async () => {}, log: noop,
  };
  const r = await confirmSweep(ports, T0);
  assert.equal(r.actioned, 2);
  assert.equal(r.failed, 1);
  assert.equal(r.scanned, 3);
});

await test("[6] BOUNDED: the sweep asks for a fixed batch, never everything", async () => {
  let requested = -1;
  const ports: ConfirmPorts = {
    findDueForConfirm: async (_now, limit) => { requested = limit; return []; },
    confirmDelivery: async () => ({ ok: true, retryable: false }),
    markAttention: async () => {}, log: noop,
  };
  await confirmSweep(ports, T0);
  assert.equal(requested, BATCH_SIZE);
});

await test("[7] RESTART-SAFE: running the same sweep twice does what once did", async () => {
  const state = new Map<string, DeliveryProjection>([["o1", proj()]]);
  const ports: ConfirmPorts = {
    findDueForConfirm: async () => [...state.entries()]
      .filter(([, d]) => d.state === "REQUESTED")
      .map(([id, d]) => ({ orderId: id, restaurantId: "t", correlationId: "c", delivery: d, confirmAt: T0 })),
    confirmDelivery: async ({ orderId }) => {
      state.set(orderId, { ...state.get(orderId)!, state: "SEARCHING_FOR_DRIVER" });
      return { ok: true, retryable: false };
    },
    markAttention: async () => {}, log: noop,
  };
  const first = await confirmSweep(ports, T0);
  const second = await confirmSweep(ports, T0);
  assert.equal(first.actioned, 1);
  assert.equal(second.scanned, 0, "the second run has nothing to do");
});

// ── reconcileSweep ────────────────────────────────────────────────────────

await test("[8] a quiet delivery is repaired from the authoritative read", async () => {
  const written: DeliveryProjection[] = [];
  const ports: ReconcilePorts = {
    findStale: async () => [due("o1", { state: "DRIVER_ASSIGNED", sequence: 2, lastEventAt: T0 })],
    fetchAuthoritative: async () => ({ ok: true, state: "EN_ROUTE_TO_CUSTOMER", deliveryJobId: "DJ-1", driver: null, etaToDropoffMins: 12 }),
    writeProjection: async (_id, _seq, next) => { written.push(next); return true; },
    markAttention: async () => {}, log: noop,
  };
  const r = await reconcileSweep(ports, T0 + 10 * 60_000, 6 * 60_000);
  assert.equal(r.actioned, 1);
  assert.equal(written[0].state, "EN_ROUTE_TO_CUSTOMER");
});

await test("[9] a delivery that is NOT actually stale is skipped", async () => {
  let fetched = 0;
  const ports: ReconcilePorts = {
    findStale: async () => [due("o1", { state: "DRIVER_ASSIGNED", lastEventAt: T0 })],
    fetchAuthoritative: async () => { fetched++; return { ok: false, retryable: true }; },
    writeProjection: async () => true, markAttention: async () => {}, log: noop,
  };
  const r = await reconcileSweep(ports, T0 + 1000, 6 * 60_000);
  assert.equal(fetched, 0);
  assert.equal(r.skipped, 1);
});

await test("[10] a TERMINAL delivery is never reopened by a stale poll", async () => {
  const ports: ReconcilePorts = {
    findStale: async () => [due("o1", { state: "DELIVERED", sequence: 8, lastEventAt: T0 })],
    fetchAuthoritative: async () => ({ ok: true, state: "EN_ROUTE_TO_CUSTOMER", deliveryJobId: "DJ-1", driver: null, etaToDropoffMins: 5 }),
    writeProjection: async () => { throw new Error("must not write"); },
    markAttention: async () => {}, log: noop,
  };
  const r = await reconcileSweep(ports, T0 + 60 * 60_000, 6 * 60_000);
  assert.equal(r.skipped, 1);
});

await test("[11] a real event landing mid-poll WINS — the write is refused", async () => {
  const ports: ReconcilePorts = {
    findStale: async () => [due("o1", { state: "DRIVER_ASSIGNED", sequence: 2, lastEventAt: T0 })],
    fetchAuthoritative: async () => ({ ok: true, state: "PICKED_UP", deliveryJobId: "DJ-1", driver: null, etaToDropoffMins: 8 }),
    writeProjection: async () => false, // compare-and-set lost
    markAttention: async () => {}, log: noop,
  };
  const r = await reconcileSweep(ports, T0 + 10 * 60_000, 6 * 60_000);
  assert.equal(r.skipped, 1);
  assert.equal(r.actioned, 0);
});

await test("[12] Dispatcher not recognising a live delivery escalates to a human", async () => {
  const attention: string[] = [];
  const ports: ReconcilePorts = {
    findStale: async () => [due("o1", { state: "DRIVER_ASSIGNED", lastEventAt: T0 })],
    fetchAuthoritative: async () => ({ ok: false, retryable: false }),
    writeProjection: async () => true,
    markAttention: async (id) => { attention.push(id); }, log: noop,
  };
  const r = await reconcileSweep(ports, T0 + 10 * 60_000, 6 * 60_000);
  assert.deepEqual(r.attention, ["o1"]);
  assert.deepEqual(attention, ["o1"]);
});

await test("[13] a long-quiet delivery is flagged even when the poll agrees", async () => {
  const attention: string[] = [];
  const ports: ReconcilePorts = {
    findStale: async () => [due("o1", { state: "DRIVER_ASSIGNED", sequence: 2, lastEventAt: T0 })],
    fetchAuthoritative: async () => ({ ok: true, state: "DRIVER_ASSIGNED", deliveryJobId: "DJ-1", driver: null, etaToDropoffMins: null }),
    writeProjection: async () => true,
    markAttention: async (id) => { attention.push(id); }, log: noop,
  };
  await reconcileSweep(ports, T0 + 25 * 60_000, 6 * 60_000);
  assert.deepEqual(attention, ["o1"], "25 minutes of silence needs a person, agreement or not");
});

// ── intentSweep ───────────────────────────────────────────────────────────

await test("[14] THE RESCUE: an expired intent that WAS paid is settled, not discarded", async () => {
  const settled: string[] = [], discarded: string[] = [];
  const ports: IntentPorts = {
    findExpiredIntents: async () => ["pay_lost"],
    verifyWithProvider: async () => "success",
    settle: async (r) => { settled.push(r); },
    discard: async (r) => { discarded.push(r); }, log: noop,
  };
  const r = await intentSweep(ports, T0);
  assert.deepEqual(settled, ["pay_lost"], "a customer who paid and closed the browser must not lose their order");
  assert.deepEqual(discarded, []);
  assert.equal(r.actioned, 1);
});

await test("[15] a genuinely failed intent is discarded", async () => {
  const discarded: string[] = [];
  const ports: IntentPorts = {
    findExpiredIntents: async () => ["pay_dead"],
    verifyWithProvider: async () => "failed",
    settle: async () => { throw new Error("must not settle"); },
    discard: async (r) => { discarded.push(r); }, log: noop,
  };
  await intentSweep(ports, T0);
  assert.deepEqual(discarded, ["pay_dead"]);
});

await test("[16] UNKNOWN is not 'no' — an unverifiable intent is left alone", async () => {
  const acted: string[] = [];
  const ports: IntentPorts = {
    findExpiredIntents: async () => ["pay_unclear"],
    verifyWithProvider: async () => "unknown",
    settle: async (r) => { acted.push(r); }, discard: async (r) => { acted.push(r); }, log: noop,
  };
  const r = await intentSweep(ports, T0);
  assert.deepEqual(acted, [], "never discard an intent that may yet be paid");
  assert.equal(r.skipped, 1);
});

await test("[17] every sweep reports a counted result — nothing is silent", async () => {
  const ports: IntentPorts = {
    findExpiredIntents: async () => ["a", "b", "c"],
    verifyWithProvider: async (r) => (r === "a" ? "success" : r === "b" ? "failed" : "unknown"),
    settle: async () => {}, discard: async () => {}, log: noop,
  };
  const r = await intentSweep(ports, T0);
  assert.equal(r.scanned, 3);
  assert.equal(r.actioned, 2);
  assert.equal(r.skipped, 1);
  assert.equal(r.failed, 0);
});

}

main().then(() => console.log(`\n${passed} checks passed\n`))
  .catch((e) => { console.error(e); process.exit(1); });
