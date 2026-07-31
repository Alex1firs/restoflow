/**
 * Fix 4 — cross-tab notification, and the fallbacks when browser APIs are absent.
 * Run: npx tsx lib/pos/__tests__/sync-channel.test.ts
 *
 * The point of these tests is that BroadcastChannel is ADVISORY. Correctness lives
 * in the IndexedDB lease (see sync-lease.test.ts). A lock or channel that some
 * context silently lacks is not a lock, so nothing here may be load-bearing —
 * every path has to degrade to a no-op without breaking synchronisation.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let passed = 0;
const tests: Array<[string, () => Promise<void> | void]> = [];
const test = (name: string, fn: () => Promise<void> | void) => tests.push([name, fn]);

const CHANNEL_SRC = readFileSync(new URL("../sync-channel.ts", import.meta.url), "utf8");
const LEASE_SRC = readFileSync(new URL("../sync-lease.ts", import.meta.url), "utf8");

// ── 1 · no window (SSR / unsupported) → pure no-op ──────────────────────────
test("[C1] with no window, announcing and subscribing are safe no-ops", async () => {
  const { announceQueueSynced, subscribeQueueChanges } = await import("../sync-channel");
  // `window` is undefined under tsx, which is exactly the unsupported case.
  assert.equal(typeof (globalThis as { window?: unknown }).window, "undefined");

  // Must not throw, must not need a channel.
  announceQueueSynced({ localOrderId: "txn-1", orderId: "ORD_1", ownerId: "ctx-A" });
  const unsubscribe = subscribeQueueChanges("ctx-A", () => {
    throw new Error("no message can arrive without a channel");
  });
  assert.equal(typeof unsubscribe, "function");
  unsubscribe(); // must also be safe
});

// ── 2 · BroadcastChannel present: real cross-context delivery ───────────────
test("[C2] when BroadcastChannel exists, other contexts are notified and self is filtered", async () => {
  assert.notEqual(typeof BroadcastChannel, "undefined", "Node provides BroadcastChannel");

  // Shim `window` so the module takes its supported path, then re-import fresh.
  (globalThis as { window?: unknown }).window = globalThis;
  const modulePath = `../sync-channel?fresh=${Date.now()}`;
  const { announceQueueSynced, subscribeQueueChanges } = await import(modulePath);

  try {
    const received: Array<{ localOrderId: string; ownerId: string }> = [];
    const stopOther = subscribeQueueChanges("ctx-OTHER", (m: { localOrderId: string; ownerId: string }) =>
      received.push({ localOrderId: m.localOrderId, ownerId: m.ownerId })
    );
    const selfSeen: string[] = [];
    const stopSelf = subscribeQueueChanges("ctx-SENDER", (m: { localOrderId: string }) =>
      selfSeen.push(m.localOrderId)
    );

    announceQueueSynced({ localOrderId: "txn-42", orderId: "ORD_42", ownerId: "ctx-SENDER" });
    await new Promise((r) => setTimeout(r, 50));

    stopOther();
    stopSelf();

    assert.equal(received.length, 1, "the other context was notified");
    assert.equal(received[0].localOrderId, "txn-42");
    assert.deepEqual(selfSeen, [], "the sender ignores its own announcement");
  } finally {
    delete (globalThis as { window?: unknown }).window;
  }
});

// ── 3 · the channel is never load-bearing ──────────────────────────────────
test("[C3] correctness never depends on BroadcastChannel or Web Locks", () => {
  // Web Locks is deliberately unused: it is not available in every context this
  // POS runs in, so it could not be the authority. IndexedDB is.
  assert.ok(
    !/navigator\s*\.\s*locks/.test(CHANNEL_SRC) && !/navigator\s*\.\s*locks/.test(LEASE_SRC),
    "no Web Locks dependency, so there is nothing to fall back FROM"
  );

  // The lease module must not import the channel — ownership cannot depend on
  // messaging that may never arrive.
  assert.ok(
    !/sync-channel/.test(LEASE_SRC),
    "the authoritative lease logic is independent of cross-tab messaging"
  );

  // Every channel entry point guards on availability.
  assert.match(CHANNEL_SRC, /typeof BroadcastChannel === "undefined"/);
  assert.match(CHANNEL_SRC, /typeof window === "undefined"/);
  // And construction is wrapped, because BroadcastChannel can throw in some
  // privacy modes even when the constructor exists.
  assert.match(CHANNEL_SRC, /try \{\s*return new BroadcastChannel/);
});

// ── 4 · malformed messages are ignored ─────────────────────────────────────
test("[C4] malformed or foreign messages are ignored rather than acted on", async () => {
  (globalThis as { window?: unknown }).window = globalThis;
  const { subscribeQueueChanges, POS_SYNC_CHANNEL } = await import(`../sync-channel?fresh2=${Date.now()}`);

  try {
    const received: unknown[] = [];
    const stop = subscribeQueueChanges("ctx-ME", (m: unknown) => received.push(m));

    const raw = new BroadcastChannel(POS_SYNC_CHANNEL);
    raw.postMessage(null);
    raw.postMessage({ type: "something-else", localOrderId: "x", orderId: "y", ownerId: "z" });
    raw.postMessage({ type: "queue-synced" }); // missing ids
    raw.postMessage({ type: "queue-synced", localOrderId: 5, orderId: 6, ownerId: "z" }); // wrong types
    await new Promise((r) => setTimeout(r, 50));
    raw.close();
    stop();

    assert.deepEqual(received, [], "nothing malformed reached the listener");
  } finally {
    delete (globalThis as { window?: unknown }).window;
  }
});

// ── 5 · a receiver must never re-run completion effects ────────────────────
test("[C5] the client only refreshes counts on a channel message, never re-prints", () => {
  const client = readFileSync(
    new URL("../../../app/admin/[slug]/pos/POSClient.tsx", import.meta.url),
    "utf8"
  );
  const start = client.indexOf("subscribeQueueChanges(syncOwnerId()");
  assert.ok(start > -1, "the client subscribes");
  const handler = client.slice(start, start + 500);

  // A replay in a second tab must not print a kitchen ticket, open a receipt,
  // clear a cart or end a draft — those belong to the context that did the work.
  for (const forbidden of ["openKitchenSlip", "openPOSReceiptWindow", "setCart(", "finishActiveDraft", "setCompletedOrder"]) {
    assert.ok(!handler.includes(forbidden), `the channel handler must not call ${forbidden}`);
  }
  // It may only refresh this tab's own view.
  assert.ok(handler.includes("setPendingOfflineCount"), "it refreshes the pending count");
  assert.ok(handler.includes("loadOfflineQueueBills"), "and the Open Bills list");
});

// ── runner ───────────────────────────────────────────────────────────────────
(async () => {
  console.log("pos/sync-channel (Fix 4 fallbacks)");
  for (const [name, fn] of tests) {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  }
  console.log(`\n${passed}/${tests.length} passed`);
})().catch((err) => {
  console.error("\n✗ FAILED\n", err);
  process.exit(1);
});
