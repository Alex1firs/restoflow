// Webhook ingestion over the store port: dedupe, concurrency, isolation.
// Run: npx tsx lib/delivery/__tests__/ingest.test.ts

import assert from "node:assert/strict";
import { CONTRACT_VERSION, type DeliveryEvent } from "../contract";
import { initialProjection, type DeliveryProjection } from "../projection";
import { ingestEvent } from "../ingest";
import { FakeDeliveryStore } from "./fake-store";

let passed = 0;
const test = async (name: string, fn: () => Promise<void> | void) => { await fn(); passed++; console.log(`  ✓ ${name}`); };
console.log("delivery/ingest");

// tsx compiles to CJS in this repo, so top-level await is unavailable.
async function main() {

const T0 = 1_756_000_000_000;

const proj = (over: Partial<DeliveryProjection> = {}): DeliveryProjection => ({
  ...initialProjection({ correlationId: "corr-1", quoteId: "QT-1", nowMs: T0 }),
  deliveryJobId: "DJ-1",
  ...over,
});

function storeWith(over: Partial<DeliveryProjection> = {}) {
  return new FakeDeliveryStore().seedOrder({
    orderId: "RF-1", restaurantId: "trishas", customerId: "cust-a",
    restaurantProgress: "preparing", delivery: proj(over),
  });
}

const ev = (over: Partial<DeliveryEvent> = {}): DeliveryEvent => ({
  contractVersion: CONTRACT_VERSION, eventId: "evt-1", type: "delivery.state_changed",
  occurredAt: new Date(T0).toISOString(), sequence: 1,
  deliveryJobId: "DJ-1", externalOrderId: "RF-1", correlationId: "corr-1",
  state: "DRIVER_ASSIGNED",
  ...over,
} as DeliveryEvent);

await test("[1] a valid event applies and is recorded on the timeline", async () => {
  const store = storeWith();
  const r = await ingestEvent(ev({ sequence: 2 }), { store, nowMs: T0 });
  assert.equal(r.outcome, "applied");
  assert.equal(store.orders.get("RF-1")!.delivery!.state, "DRIVER_ASSIGNED");
  assert.equal(store.timeline.length, 1);
  assert.equal(store.timeline[0].correlationId, "corr-1");
});

await test("[2] DUPLICATE DELIVERY: the same eventId twice applies once", async () => {
  const store = storeWith();
  const first = await ingestEvent(ev({ sequence: 2 }), { store, nowMs: T0 });
  const second = await ingestEvent(ev({ sequence: 2 }), { store, nowMs: T0 + 500 });
  assert.equal(first.outcome, "applied");
  assert.equal(second.outcome, "duplicate");
  assert.equal(store.orders.get("RF-1")!.delivery!.sequence, 2);
});

await test("[3] CONCURRENT duplicates: only one wins the claim", async () => {
  const store = storeWith();
  const [a, b] = await Promise.all([
    ingestEvent(ev({ sequence: 2 }), { store, nowMs: T0 }),
    ingestEvent(ev({ sequence: 2 }), { store, nowMs: T0 }),
  ]);
  const outcomes = [a.outcome, b.outcome].sort();
  assert.deepEqual(outcomes, ["applied", "duplicate"]);
});

await test("[4] a DIFFERENT eventId carrying a stale sequence is ignored, not applied", async () => {
  const store = storeWith({ sequence: 5, state: "PICKED_UP" });
  const r = await ingestEvent(ev({ eventId: "evt-late", sequence: 3, state: "DRIVER_ASSIGNED" }), { store, nowMs: T0 });
  assert.equal(r.outcome, "ignored");
  assert.equal(store.orders.get("RF-1")!.delivery!.state, "PICKED_UP");
});

await test("[5] an event for an unknown order is accepted and logged, never retried forever", async () => {
  const store = storeWith();
  const logs: string[] = [];
  const r = await ingestEvent(ev({ externalOrderId: "RF-NOPE" }), {
    store, nowMs: T0, log: (n) => logs.push(n),
  });
  assert.equal(r.outcome, "unknown_order");
  assert.ok(logs.includes("dispatcher_event_unknown_order"));
});

await test("[6] POS ISOLATION: an event can never attach to a non-marketplace order", async () => {
  // The fake mirrors the adapter: getOrder returns null for anything that is
  // not a marketplace order, so a misrouted event cannot touch a till record.
  const store = new FakeDeliveryStore(); // no marketplace order seeded
  const r = await ingestEvent(ev({ externalOrderId: "POS-9" }), { store, nowMs: T0 });
  assert.equal(r.outcome, "unknown_order");
  assert.equal(store.timeline.length, 0);
});

await test("[7] CONCURRENCY: two different events race, both settle, no corruption", async () => {
  const store = storeWith();
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  let held = false;
  store.writeGate = async () => {
    if (held) return;
    held = true;
    await gate; // hold the FIRST write open
  };

  const first = ingestEvent(ev({ eventId: "e2", sequence: 2, state: "DRIVER_ASSIGNED" }), { store, nowMs: T0 });
  await Promise.resolve();
  const second = ingestEvent(ev({ eventId: "e3", sequence: 3, state: "DRIVER_TO_PICKUP" }), { store, nowMs: T0 + 10 });
  release();
  const [a, b] = await Promise.all([first, second]);

  assert.equal(a.outcome, "applied");
  assert.equal(b.outcome, "applied");
  // Whichever order they landed in, the projection ends on the higher sequence.
  assert.equal(store.orders.get("RF-1")!.delivery!.sequence, 3);
  assert.equal(store.orders.get("RF-1")!.delivery!.state, "DRIVER_TO_PICKUP");
});

await test("[8] a compare-and-set collision is retried, not clobbered", async () => {
  const store = storeWith();
  let bumped = false;
  store.writeGate = async () => {
    if (bumped) return;
    bumped = true;
    // Simulate another writer advancing the projection mid-write.
    const o = store.orders.get("RF-1")!;
    o.delivery = { ...o.delivery!, sequence: 2, state: "DRIVER_ASSIGNED" };
  };
  const r = await ingestEvent(ev({ eventId: "e3", sequence: 3, state: "DRIVER_TO_PICKUP" }), { store, nowMs: T0 });
  assert.equal(r.outcome, "applied");
  assert.equal(store.casRejections, 1, "the first write must have been refused");
  assert.equal(store.orders.get("RF-1")!.delivery!.sequence, 3);
});

await test("[9] onStateChange fires ONCE per real change, never on a replay", async () => {
  const store = storeWith();
  const fired: string[] = [];
  const deps = { store, nowMs: T0, onStateChange: async (a: { projection: DeliveryProjection }) => { fired.push(a.projection.state); } };
  await ingestEvent(ev({ eventId: "e2", sequence: 2 }), deps);
  await ingestEvent(ev({ eventId: "e2", sequence: 2 }), deps);          // duplicate
  await ingestEvent(ev({ eventId: "e2b", sequence: 2 }), deps);         // stale sequence
  assert.deepEqual(fired, ["DRIVER_ASSIGNED"]);
});

await test("[10] a failing notification must not fail the ingest", async () => {
  const store = storeWith();
  const logs: string[] = [];
  const r = await ingestEvent(ev({ sequence: 2 }), {
    store, nowMs: T0,
    log: (n) => logs.push(n),
    onStateChange: async () => { throw new Error("push provider down"); },
  });
  assert.equal(r.outcome, "applied", "the state IS changed — a 500 here would cause redelivery");
  assert.ok(logs.includes("dispatcher_event_notify_failed"));
});

await test("[11] an event naming a different delivery job is rejected", async () => {
  const store = storeWith({ deliveryJobId: "DJ-1" });
  const r = await ingestEvent(ev({ sequence: 2, deliveryJobId: "DJ-OTHER" }), { store, nowMs: T0 });
  assert.equal(r.outcome, "rejected");
});

await test("[12] the full lifecycle, then a replay of every event, leaves one outcome", async () => {
  const store = storeWith();
  const stream: DeliveryEvent[] = [
    ev({ eventId: "a", sequence: 1, state: "SEARCHING_FOR_DRIVER" }),
    ev({ eventId: "b", sequence: 2, state: "DRIVER_ASSIGNED" }),
    ev({ eventId: "c", sequence: 3, state: "DRIVER_TO_PICKUP" }),
    ev({ eventId: "d", sequence: 4, state: "ARRIVED_AT_PICKUP" }),
    ev({ eventId: "e", sequence: 5, state: "PICKED_UP" }),
    ev({ eventId: "f", sequence: 6, state: "EN_ROUTE_TO_CUSTOMER" }),
    ev({ eventId: "g", sequence: 7, state: "ARRIVING" }),
    ev({ eventId: "h", sequence: 8, state: "DELIVERED" }),
  ];
  for (const e of stream) assert.equal((await ingestEvent(e, { store, nowMs: T0 })).outcome, "applied", e.eventId);

  const final = structuredClone(store.orders.get("RF-1")!.delivery!);
  // Replay the whole stream, and shuffle it for good measure.
  for (const e of [...stream].reverse()) {
    const r = await ingestEvent(e, { store, nowMs: T0 + 99_999 });
    assert.equal(r.outcome, "duplicate", e.eventId);
  }
  assert.deepEqual(store.orders.get("RF-1")!.delivery, final);
  assert.equal(final.state, "DELIVERED");
});

}

main().then(() => {
  console.log(`\n${passed} checks passed\n`);
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
