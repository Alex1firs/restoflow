/**
 * POS idempotency — REAL Firestore integration tests (emulator).
 *
 * Run:
 *   npx firebase emulators:exec --only firestore --project demo-rest \
 *     "npx tsx lib/pos/__tests__/emulator.test.ts"
 *
 * The unit suite proves the logic against a fake that MODELS Firestore's
 * optimistic concurrency. This suite proves the same guarantees against the
 * real thing: real transaction contention, real `create` preconditions, real
 * abort-and-retry. It is the layer that validates the central claim — that two
 * concurrent requests carrying one localOrderId cannot produce two orders.
 *
 * Requires the Firestore emulator (Java 11+). Without FIRESTORE_EMULATOR_HOST
 * set the script refuses to run rather than touching a real project.
 */

import assert from "node:assert/strict";
import { cert, deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  POS_ORDER_CLAIMS,
  backfillClaim,
  claimDocId,
  commitPosOrder,
  orderFingerprint,
  type FirestoreLike,
} from "../idempotency";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error(
    "\n✗ FIRESTORE_EMULATOR_HOST is not set — refusing to run against a real project.\n" +
      "  Run with:\n" +
      "    npx firebase emulators:exec --only firestore --project demo-rest \\\n" +
      '      "npx tsx lib/pos/__tests__/emulator.test.ts"\n'
  );
  process.exit(1);
}

void cert; // (kept out of use: the emulator needs no credentials)

const PROJECT_ID = process.env.GCLOUD_PROJECT || "demo-rest";
const app = initializeApp({ projectId: PROJECT_ID }, `pos-idempotency-${Date.now()}`);
const db = getFirestore(app);
const fdb = db as unknown as FirestoreLike;

const RESTAURANT = "emulator-grills";

let passed = 0;
const tests: Array<[string, () => Promise<void>]> = [];
const test = (name: string, fn: () => Promise<void>) => tests.push([name, fn]);

async function wipe() {
  for (const collection of ["orders", "restaurants", POS_ORDER_CLAIMS]) {
    const snap = await db.collection(collection).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
}

async function seedRestaurant(orderCounter = 120) {
  await db.collection("restaurants").doc(RESTAURANT).set({
    name: "Emulator Grills",
    orderCounter,
  });
}

type FpItem = { id: string; quantity: number; customPrice: number | null; itemNote: string };

const CART: FpItem[] = [
  { id: "m-1", quantity: 2, customPrice: null, itemNote: "" },
  { id: "m-2", quantity: 1, customPrice: null, itemNote: "" },
];

const fp = (items: FpItem[] = CART, extra: Record<string, string> = {}) =>
  orderFingerprint({
    items,
    serviceMode: extra.serviceMode ?? "counter",
    tableLabel: extra.tableLabel ?? "",
    note: extra.note ?? "",
    pricingMode: extra.pricingMode ?? "regular",
  });

function buildOrder(localOrderId: string, source: string) {
  return (orderNumber: number) => ({
    restaurantId: RESTAURANT,
    localOrderId,
    items: CART,
    itemsTotal: 4249,
    total: 4249,
    status: "pending",
    orderSource: "counter",
    source,
    orderNumber,
  });
}

const commit = (localOrderId: string, opts: { fingerprint?: string; source?: "online" | "sync" } = {}) =>
  commitPosOrder({
    db: fdb,
    restaurantId: RESTAURANT,
    localOrderId,
    fingerprint: opts.fingerprint ?? fp(),
    source: opts.source ?? "online",
    buildOrderData: buildOrder(localOrderId, opts.source ?? "online"),
  });

const counter = async () =>
  (await db.collection("restaurants").doc(RESTAURANT).get()).data()?.orderCounter;
const orderCount = async () => (await db.collection("orders").get()).size;
const claimCount = async () => (await db.collection(POS_ORDER_CLAIMS).get()).size;

// ── 1 ────────────────────────────────────────────────────────────────────────
test("[E1] real transaction: a single commit creates one order and one claim", async () => {
  await wipe();
  await seedRestaurant();

  const result = await commit("txn-e1");

  assert.equal(result.outcome, "created");
  assert.equal(await orderCount(), 1);
  assert.equal(await claimCount(), 1);
  assert.equal(await counter(), 121);

  const claim = await db.collection(POS_ORDER_CLAIMS).doc(claimDocId(RESTAURANT, "txn-e1")).get();
  assert.equal(claim.exists, true, "claim written at the deterministic id");
  assert.equal(claim.data()!.orderId, result.outcome === "created" ? result.orderId : "");
});

// ── 2 · the core guarantee, against real contention ──────────────────────────
test("[E2] 8 SIMULTANEOUS commits with one key → one claim, one order, one number", async () => {
  await wipe();
  await seedRestaurant();

  const results = await Promise.all(Array.from({ length: 8 }, () => commit("txn-e2")));

  assert.equal(await orderCount(), 1, "real Firestore: no duplicate order");
  assert.equal(await claimCount(), 1, "exactly one claim");
  assert.equal(await counter(), 121, "the order counter advanced exactly once");

  const created = results.filter((r) => r.outcome === "created");
  const replayed = results.filter((r) => r.outcome === "replayed");
  assert.equal(created.length, 1, "exactly one caller created");
  assert.equal(replayed.length, 7, "every other caller replayed");

  const ids = new Set(results.map((r) => r.orderId));
  assert.equal(ids.size, 1, "all 8 callers resolve to the same canonical order");

  const stored = (await db.collection("orders").get()).docs[0];
  assert.equal(stored.id, [...ids][0]);
  assert.equal(stored.data().localOrderId, "txn-e2");
});

// ── 3 · both entry points racing on real Firestore ───────────────────────────
test("[E3] online and sync routes racing on one key → one order", async () => {
  await wipe();
  await seedRestaurant();

  const results = await Promise.all([
    commit("txn-e3", { source: "online" }),
    commit("txn-e3", { source: "sync" }),
    commit("txn-e3", { source: "online" }),
    commit("txn-e3", { source: "sync" }),
  ]);

  assert.equal(await orderCount(), 1);
  assert.equal(await counter(), 121);
  assert.equal(results.filter((r) => r.outcome === "created").length, 1);
  assert.equal(new Set(results.map((r) => r.orderId)).size, 1);
});

// ── 4 · sequential replay ────────────────────────────────────────────────────
test("[E4] repeated sequential replays never write and never renumber", async () => {
  await wipe();
  await seedRestaurant();

  const first = await commit("txn-e4");
  for (let i = 0; i < 5; i++) {
    const again = await commit("txn-e4");
    assert.equal(again.outcome, "replayed");
    assert.equal(again.orderId, first.orderId);
    assert.equal(again.outcome === "replayed" ? again.orderNumber : -1, 121);
  }
  assert.equal(await orderCount(), 1);
  assert.equal(await counter(), 121);
});

// ── 5 · conflicting fingerprint on real Firestore ────────────────────────────
test("[E5] a conflicting fingerprint is refused and the original is untouched", async () => {
  await wipe();
  await seedRestaurant();

  const original = await commit("txn-e5");
  const before = (await db.collection("orders").get()).docs[0].data();

  const conflict = await commit("txn-e5", {
    fingerprint: fp([{ id: "m-9", quantity: 9, customPrice: 500, itemNote: "" }]),
  });

  assert.equal(conflict.outcome, "conflict");
  assert.equal(conflict.orderId, original.orderId, "points at the real order");
  assert.equal(await orderCount(), 1);
  assert.equal(await counter(), 121, "no number consumed");

  const after = (await db.collection("orders").get()).docs[0].data();
  assert.deepEqual(after.items, before.items, "original order not modified");
});

// ── 6 · concurrent conflict + replay mix ─────────────────────────────────────
test("[E6] concurrent same-key requests with mixed fingerprints stay consistent", async () => {
  await wipe();
  await seedRestaurant();

  const good = fp();
  const bad = fp([{ id: "m-7", quantity: 4, customPrice: null, itemNote: "" }]);

  const results = await Promise.all([
    commit("txn-e6", { fingerprint: good }),
    commit("txn-e6", { fingerprint: bad }),
    commit("txn-e6", { fingerprint: good }),
    commit("txn-e6", { fingerprint: bad }),
  ]);

  assert.equal(await orderCount(), 1, "still exactly one order");
  assert.equal(await counter(), 121);
  assert.equal(results.filter((r) => r.outcome === "created").length, 1);
  // Whichever fingerprint won, the other two requests must be refused, never duplicated.
  const outcomes = results.map((r) => r.outcome).sort();
  assert.ok(!outcomes.includes("missing_order"), `unexpected integrity error: ${outcomes}`);
  assert.equal(results.filter((r) => r.outcome === "created" || r.outcome === "replayed" || r.outcome === "conflict").length, 4);
});

// ── 7 · pre-fix migration path ───────────────────────────────────────────────
test("[E7] an order from the OLD sync route is found and back-filled, not duplicated", async () => {
  await wipe();
  await seedRestaurant();

  // Pre-existing order written by the previous code path: has localOrderId, no claim.
  await db.collection("orders").add({
    restaurantId: RESTAURANT,
    localOrderId: "offline-legacy-e7",
    items: CART,
    total: 4249,
    orderNumber: 118,
  });
  assert.equal(await claimCount(), 0);

  // The sync route's safety net: real composite query on the emulator.
  const dup = await db
    .collection("orders")
    .where("restaurantId", "==", RESTAURANT)
    .where("localOrderId", "==", "offline-legacy-e7")
    .limit(1)
    .get();

  assert.equal(dup.empty, false, "the legacy lookup still finds it");
  await backfillClaim({
    db: fdb,
    restaurantId: RESTAURANT,
    localOrderId: "offline-legacy-e7",
    orderId: dup.docs[0].id,
    orderNumber: 118,
    fingerprint: fp(),
  });

  assert.equal(await claimCount(), 1, "claim back-filled");
  assert.equal(await orderCount(), 1, "no duplicate created");
  assert.equal(await counter(), 120, "no number consumed");

  // Later retries now take the atomic path and replay.
  const retry = await commit("offline-legacy-e7");
  assert.equal(retry.outcome, "replayed");
  assert.equal(retry.orderId, dup.docs[0].id);
  assert.equal(await orderCount(), 1);
});

// ── 8 · claim with a missing order ───────────────────────────────────────────
test("[E8] a claim whose order was deleted returns missing_order, not a new order", async () => {
  await wipe();
  await seedRestaurant();

  const created = await commit("txn-e8");
  await db.collection("orders").doc(created.orderId).delete();
  assert.equal(await orderCount(), 0);

  const result = await commit("txn-e8");

  assert.equal(result.outcome, "missing_order", "controlled integrity failure");
  assert.equal(await orderCount(), 0, "must NOT write a replacement order");
  assert.equal(await counter(), 121, "no number consumed");
  assert.equal(await claimCount(), 1, "claim preserved for investigation");
});

// ── 9 · the production regression, on real Firestore ─────────────────────────
test("[E9] REGRESSION: online commits → response lost → sync resends → one order", async () => {
  await wipe();
  await seedRestaurant();

  // Cashier submits online; the server commits...
  const committed = await commit("txn-e9", { source: "online" });
  assert.equal(committed.outcome, "created");

  // ...the response never arrives. The client queues under the SAME key, the bill
  // is settled offline (payment fields change — must not be a conflict), and the
  // queue drains after reconnection.
  const synced = await commitPosOrder({
    db: fdb,
    restaurantId: RESTAURANT,
    localOrderId: "txn-e9",
    fingerprint: fp(), // unchanged: settlement is not part of the fingerprint
    source: "sync",
    buildOrderData: buildOrder("txn-e9", "sync"),
  });

  assert.equal(synced.outcome, "replayed");
  assert.equal(synced.orderId, committed.orderId);
  assert.equal(await orderCount(), 1, "final state: exactly ONE order");
  assert.equal(await counter(), 121, "exactly one order number consumed");

  const order = (await db.collection("orders").get()).docs[0];
  assert.equal(order.data().source, "online", "the original order was not overwritten by the sync");
});

// ── runner ───────────────────────────────────────────────────────────────────
(async () => {
  console.log(`pos/idempotency — FIRESTORE EMULATOR (${process.env.FIRESTORE_EMULATOR_HOST})`);
  for (const [name, fn] of tests) {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  }
  await wipe();
  console.log(`\n${passed}/${tests.length} passed against real Firestore`);
  await deleteApp(app);
})().catch(async (err) => {
  console.error("\n✗ FAILED\n", err);
  await deleteApp(app).catch(() => {});
  process.exit(1);
});
