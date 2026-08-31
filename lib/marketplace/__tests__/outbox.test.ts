// The notification sender: at-least-once, retried, dead-lettered, never doubled.
// Run: npx tsx lib/marketplace/__tests__/outbox.test.ts

import assert from "node:assert/strict";
import {
  drainOutbox, backoffFor, isPushable, MAX_ATTEMPTS, BATCH_SIZE, BACKOFF_MS,
  type OutboxEntry, type OutboxPorts, type SendOutcome,
} from "../outbox";

let passed = 0;
const test = async (name: string, fn: () => Promise<void> | void) => { await fn(); passed++; console.log(`  ✓ ${name}`); };
console.log("marketplace/outbox");

const T0 = 1_756_000_000_000;
const entry = (over: Partial<OutboxEntry> = {}): OutboxEntry => ({
  id: "order_1__customer__courier_assigned", orderId: "order_1", audience: "customer",
  event: "courier_assigned", payload: { title: "Courier assigned", body: "Kelechi will collect your order." },
  state: "queued", attempts: 0, createdAt: T0, nextAttemptAt: null, lastError: null,
  ...over,
});

class FakePorts implements OutboxPorts {
  queue: OutboxEntry[] = [];
  sent: string[] = [];
  retries: Array<{ id: string; at: number; error: string }> = [];
  dead: Array<{ id: string; error: string }> = [];
  invalidated: string[] = [];
  sendCalls = 0;
  claimLimit = -1;
  outcome: SendOutcome = { status: "sent" };
  /** Simulates another worker having taken the entry first. */
  stolen = new Set<string>();
  log = () => {};

  async claimDue(_now: number, limit: number) { this.claimLimit = limit; return this.queue; }
  async markSending(e: OutboxEntry) { return !this.stolen.has(e.id); }
  async markSent(e: OutboxEntry) { this.sent.push(e.id); }
  async scheduleRetry(e: OutboxEntry, at: number, error: string) { this.retries.push({ id: e.id, at, error }); }
  async markDead(e: OutboxEntry, error: string) { this.dead.push({ id: e.id, error }); }
  async invalidateToken(token: string) { this.invalidated.push(token); }
  // Signatures match the port so a test can override them with a spy that
  // actually reads the entry.
  sendCustomerPush: (e: OutboxEntry) => Promise<SendOutcome> =
    async (_e: OutboxEntry) => { this.sendCalls++; return this.outcome; };
  sendRestaurantAlert: (e: OutboxEntry) => Promise<SendOutcome> =
    async (_e: OutboxEntry) => { this.sendCalls++; return this.outcome; };
}

async function main() {

await test("[1] a queued notification is sent and marked", async () => {
  const p = new FakePorts();
  p.queue = [entry()];
  const r = await drainOutbox(p, T0);
  assert.equal(r.sent, 1);
  assert.deepEqual(p.sent, ["order_1__customer__courier_assigned"]);
});

await test("[2] THE DUPLICATE GUARD is the key, not the sender", async () => {
  // A duplicate delivery event enqueues the SAME id upstream, `create` fails,
  // and no second entry exists. The worker never sees two.
  const p = new FakePorts();
  p.queue = [entry(), entry()]; // same id twice, as if it somehow got queued
  await drainOutbox(p, T0);
  assert.equal(new Set(p.sent).size, 1, "the id is what deduplicates");
});

await test("[3] two workers racing: only one sends", async () => {
  const p = new FakePorts();
  p.queue = [entry({ id: "a" }), entry({ id: "b" })];
  p.stolen.add("b"); // another worker took it
  const r = await drainOutbox(p, T0);
  assert.equal(r.sent, 1);
  assert.equal(r.skipped, 1);
  assert.deepEqual(p.sent, ["a"]);
});

await test("[4] a transient failure is retried with growing backoff", async () => {
  const p = new FakePorts();
  p.outcome = { status: "transient", reason: "provider 503" };
  p.queue = [entry({ attempts: 0 })];
  const r = await drainOutbox(p, T0);
  assert.equal(r.retried, 1);
  assert.equal(p.retries[0].at, T0 + BACKOFF_MS[0]);
  assert.match(p.retries[0].error, /503/);
});

await test("[5] backoff grows and is bounded", () => {
  assert.equal(backoffFor(0), 30_000);
  assert.equal(backoffFor(1), 120_000);
  assert.equal(backoffFor(4), 21_600_000);
  assert.equal(backoffFor(99), 21_600_000, "bounded, not unbounded");
  for (let i = 1; i < BACKOFF_MS.length; i++) assert.ok(BACKOFF_MS[i] > BACKOFF_MS[i - 1]);
});

await test("[6] an exhausted entry is DEAD-LETTERED, never dropped", async () => {
  const p = new FakePorts();
  p.outcome = { status: "transient", reason: "still down" };
  p.queue = [entry({ attempts: MAX_ATTEMPTS - 1 })];
  const r = await drainOutbox(p, T0);
  assert.equal(r.dead, 1);
  assert.equal(r.retried, 0);
  assert.match(p.dead[0].error, /exhausted after 5/);
});

await test("[7] a permanent failure stops immediately — no pointless retries", async () => {
  const p = new FakePorts();
  p.outcome = { status: "permanent", reason: "malformed payload" };
  p.queue = [entry()];
  const r = await drainOutbox(p, T0);
  assert.equal(r.dead, 1);
  assert.equal(r.retried, 0);
});

await test("[8] TOKEN INVALIDATION: a dead token is pruned and the entry stops", async () => {
  const p = new FakePorts();
  p.outcome = { status: "token_invalid", token: "tok-gone" };
  p.queue = [entry()];
  const r = await drainOutbox(p, T0);
  assert.deepEqual(p.invalidated, ["tok-gone"]);
  assert.equal(r.tokensInvalidated, 1);
  assert.equal(r.dead, 1);
  assert.equal(r.retried, 0, "retrying a dead token forever fills the queue with impossible work");
});

await test("[9] a thrown sender is treated as transient, not as a crash", async () => {
  const p = new FakePorts();
  p.sendCustomerPush = async (_e: OutboxEntry) => { throw new Error("socket hang up"); };
  p.queue = [entry()];
  const r = await drainOutbox(p, T0);
  assert.equal(r.retried, 1);
  assert.match(p.retries[0].error, /socket hang up/);
});

await test("[10] one bad entry does not abort the batch", async () => {
  const p = new FakePorts();
  let n = 0;
  p.sendCustomerPush = async (_e: OutboxEntry) => {
    n++;
    if (n === 2) throw new Error("boom");
    return { status: "sent" } as SendOutcome;
  };
  p.queue = [entry({ id: "a" }), entry({ id: "b" }), entry({ id: "c" })];
  const r = await drainOutbox(p, T0);
  assert.equal(r.claimed, 3);
  assert.equal(r.sent, 2);
  assert.equal(r.retried, 1);
});

await test("[11] BOUNDED: the drain asks for a fixed batch", async () => {
  const p = new FakePorts();
  await drainOutbox(p, T0);
  assert.equal(p.claimLimit, BATCH_SIZE);
});

await test("[12] restaurant and customer entries route to different senders", async () => {
  const p = new FakePorts();
  const customerCalls: string[] = [];
  const restaurantCalls: string[] = [];
  p.sendCustomerPush = async (e: OutboxEntry) => { customerCalls.push(e.id); return { status: "sent" }; };
  p.sendRestaurantAlert = async (e: OutboxEntry) => { restaurantCalls.push(e.id); return { status: "sent" }; };
  p.queue = [entry({ id: "c1", audience: "customer" }), entry({ id: "r1", audience: "restaurant" })];
  await drainOutbox(p, T0);
  assert.deepEqual(customerCalls, ["c1"]);
  assert.deepEqual(restaurantCalls, ["r1"]);
});

await test("[13] every run reports counted totals — nothing is silent", async () => {
  const p = new FakePorts();
  p.queue = [entry({ id: "a" }), entry({ id: "b" }), entry({ id: "c" })];
  p.stolen.add("c");
  const r = await drainOutbox(p, T0);
  assert.equal(r.claimed + 0, 3);
  assert.equal(r.sent + r.retried + r.dead + r.skipped, 3);
});

await test("[14] the pushable list is short, and matches the delivery side", () => {
  assert.equal(isPushable("courier_assigned"), true);
  assert.equal(isPushable("delivered"), true);
  assert.equal(isPushable("order_rejected"), true);
  assert.equal(isPushable("preparing"), false, "not every transition is worth waking a phone for");
  assert.equal(isPushable("courier_to_restaurant"), false);
  assert.equal(isPushable("on_the_way"), false);
});

await test("[15] an empty queue is a clean no-op", async () => {
  const p = new FakePorts();
  const r = await drainOutbox(p, T0);
  assert.deepEqual(r, { claimed: 0, sent: 0, retried: 0, dead: 0, skipped: 0, tokensInvalidated: 0 });
  assert.equal(p.sendCalls, 0);
});

}

main().then(() => console.log(`\n${passed} checks passed\n`))
  .catch((e) => { console.error(e); process.exit(1); });
