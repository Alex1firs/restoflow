/**
 * POS idempotency — REAL Next.js route handlers against the Firestore emulator.
 *
 * Run:
 *   npx firebase emulators:exec --only firestore --project demo-rest \
 *     "npx tsx --tsconfig lib/pos/__tests__/route-harness/tsconfig.json lib/pos/__tests__/routes.test.ts"
 *
 * This is the highest-fidelity layer: it imports and invokes the actual exported
 * POST handlers from app/api/admin/pos/route.ts and app/api/admin/pos/sync/route.ts,
 * with real NextRequest objects, real body parsing, real payload validation, real
 * menu pricing from Firestore, real transactions, and real response bodies.
 *
 * Only two things are stubbed, via tsconfig path overrides in ./route-harness:
 *   - `@/lib/auth-server`        (reads a session cookie via next/headers)
 *   - `@/lib/subscription-guard` (billing state, irrelevant to idempotency)
 * plus `server-only`, which throws by design outside a Next server context.
 * Everything after authentication is the production code path.
 */

import assert from "node:assert/strict";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { NextRequest } from "next/server";
import { TEST_USER } from "./route-harness/auth-server";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error(
    "\n✗ FIRESTORE_EMULATOR_HOST is not set — refusing to run against a real project.\n" +
      "  Run with:\n" +
      "    npx firebase emulators:exec --only firestore --project demo-rest \\\n" +
      '      "npx tsx --tsconfig lib/pos/__tests__/route-harness/tsconfig.json lib/pos/__tests__/routes.test.ts"\n'
  );
  process.exit(1);
}

// Must be the DEFAULT app and must exist before the route modules first call
// getAdminDb(): lib/firebase-admin.ts returns getApps()[0] when one is present,
// which is how the real route reaches the emulator without credentials.
const app = initializeApp({ projectId: process.env.GCLOUD_PROJECT || "demo-rest" });
const db = getFirestore(app);

const RESTAURANT = TEST_USER.restaurantSlug;

// Loaded lazily inside the runner, AFTER the default app exists, so the route's
// getAdminDb() resolves to the emulator app. (tsx compiles to CJS here, so a
// top-level await is not available.)
type Handler = (request: NextRequest) => Promise<Response>;
let onlinePOST: Handler;
let syncPOST: Handler;

async function loadRealHandlers(): Promise<void> {
  onlinePOST = (await import("@/app/api/admin/pos/route")).POST as Handler;
  syncPOST = (await import("@/app/api/admin/pos/sync/route")).POST as Handler;
}

let passed = 0;
const tests: Array<[string, () => Promise<void>]> = [];
const test = (name: string, fn: () => Promise<void>) => tests.push([name, fn]);

// ── helpers ──────────────────────────────────────────────────────────────────

const MENU = {
  "m-ribs": { name: "Prime Ribs", price: 3599, available: true, allowCustomPrice: false, kitchenStation: "grill" },
  "m-tray": { name: "Party Tray", price: 15000, available: true, allowCustomPrice: true, kitchenStation: "kitchen" },
  "m-side": { name: "Loaded Potato", price: 650, available: true, allowCustomPrice: false, kitchenStation: "kitchen" },
};

async function wipe() {
  for (const collection of ["orders", "restaurants", "prepared_items", "pos_order_claims"]) {
    const snap = await db.collection(collection).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
}

async function seed(orderCounter = 120) {
  await wipe();
  await db.collection("restaurants").doc(RESTAURANT).set({ name: "Emulator Grills", orderCounter });
  for (const [id, item] of Object.entries(MENU)) {
    await db.collection("prepared_items").doc(id).set({ restaurantId: RESTAURANT, ...item });
  }
}

function req(url: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Whatever the route returned, read loosely — assertions pin the fields. */
type RouteBody = Record<string, unknown> & {
  orderId?: string;
  orderNumber?: number;
  total?: number;
  error?: string;
  replayed?: boolean;
  conflict?: boolean;
};

async function callOnline(body: unknown): Promise<{ status: number; body: RouteBody }> {
  const res = await onlinePOST(req("/api/admin/pos", body));
  return { status: res.status, body: (await res.json()) as RouteBody };
}

async function callSync(body: unknown): Promise<{ status: number; body: RouteBody }> {
  const res = await syncPOST(req("/api/admin/pos/sync", body));
  return { status: res.status, body: (await res.json()) as RouteBody };
}

const counter = async () =>
  (await db.collection("restaurants").doc(RESTAURANT).get()).data()?.orderCounter;
const orderCount = async () => (await db.collection("orders").get()).size;
const claimCount = async () => (await db.collection("pos_order_claims").get()).size;

/** The payload POSClient sends to /api/admin/pos. */
const onlinePayload = (localOrderId: string | undefined, over: Record<string, unknown> = {}) => ({
  ...(localOrderId ? { localOrderId } : {}),
  items: [
    { id: "m-ribs", name: "Prime Ribs", quantity: 2, selectedSize: null, selectedModifiers: [], customPrice: undefined, itemNote: "" },
    { id: "m-side", name: "Loaded Potato", quantity: 1, selectedSize: null, selectedModifiers: [], customPrice: undefined, itemNote: "" },
  ],
  paymentMethod: "cash",
  paymentStatus: "unpaid",
  customerName: "",
  note: "",
  staffName: "Ada",
  serviceMode: "counter",
  tableLabel: "",
  waiterName: null,
  pricingMode: "regular",
  auditLog: [],
  ...over,
});

/** The record POSClient queues in IndexedDB and later POSTs to /sync. */
const queuedPayload = (localOrderId: string, over: Record<string, unknown> = {}) => ({
  localOrderId,
  items: [
    { id: "m-ribs", name: "Prime Ribs", price: 3599, quantity: 2, selectedSize: null, selectedModifiers: [], customPrice: null, itemNote: "" },
    { id: "m-side", name: "Loaded Potato", price: 650, quantity: 1, selectedSize: null, selectedModifiers: [], customPrice: null, itemNote: "" },
  ],
  total: 7848,
  cashierId: "cashier-1",
  cashierName: "Ada",
  deviceId: "dev-1",
  terminalName: "Terminal 1",
  paymentMethod: "cash",
  paymentStatus: "paid",
  customerName: "Walk-in Guest",
  note: "",
  waiterName: null,
  pricingMode: "regular",
  serviceMode: "counter",
  tableLabel: "",
  createdAt: 1_700_000_000_000,
  ...over,
});

// ── R1 ───────────────────────────────────────────────────────────────────────
test("[R1] the real online handler creates one order and one claim", async () => {
  await seed();
  const res = await callOnline(onlinePayload("txn-r1"));

  assert.equal(res.status, 201);
  assert.equal(res.body.orderNumber, 121);
  assert.equal(res.body.total, 3599 * 2 + 650, "real server-side pricing");
  assert.equal(await orderCount(), 1);
  assert.equal(await claimCount(), 1);
  assert.equal(await counter(), 121);

  const order = (await db.collection("orders").get()).docs[0];
  assert.equal(order.id, res.body.orderId, "response id is the real document id");
  assert.equal(order.data().localOrderId, "txn-r1", "key stored for audit/recovery");
});

// ── R2 ───────────────────────────────────────────────────────────────────────
test("[R2] the real online handler replays a repeated submission", async () => {
  await seed();
  const first = await callOnline(onlinePayload("txn-r2"));
  const second = await callOnline(onlinePayload("txn-r2"));
  const third = await callOnline(onlinePayload("txn-r2"));

  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal(second.body.replayed, true);
  assert.equal(second.body.orderId, first.body.orderId);
  assert.equal(second.body.orderNumber, first.body.orderNumber, "same invoice number");
  assert.equal(third.body.orderId, first.body.orderId);
  assert.equal(await orderCount(), 1);
  assert.equal(await counter(), 121);
});

// ── R3 ───────────────────────────────────────────────────────────────────────
test("[R3] two CONCURRENT calls to the real handler create one order", async () => {
  await seed();
  const [a, b, c] = await Promise.all([
    callOnline(onlinePayload("txn-r3")),
    callOnline(onlinePayload("txn-r3")),
    callOnline(onlinePayload("txn-r3")),
  ]);

  assert.equal(await orderCount(), 1);
  assert.equal(await counter(), 121);
  assert.equal(new Set([a, b, c].map((r) => r.body.orderId)).size, 1);
  assert.equal([a, b, c].filter((r) => r.status === 201).length, 1);
  assert.equal([a, b, c].filter((r) => r.status === 200).length, 2);
});

// ── R4 · THE PRODUCTION REGRESSION, END TO END ───────────────────────────────
test("[R4] REGRESSION: real online handler commits → response lost → real sync handler resends → ONE order", async () => {
  await seed();

  // 1. Cashier submits online. The server commits the order.
  const committed = await callOnline(onlinePayload("txn-r4"));
  assert.equal(committed.status, 201);
  assert.equal(await orderCount(), 1);

  // 2. The connection dies before the response arrives; the client never sees it
  //    and queues the transaction under the SAME key.
  // 3. Connectivity returns; the queue drains to the real sync handler. The bill
  //    was settled offline in the meantime, so payment fields differ.
  const synced = await callSync(queuedPayload("txn-r4", { paymentStatus: "paid", paymentMethod: "card" }));

  assert.equal(synced.status, 200);
  assert.equal(synced.body.replayed, true);
  assert.equal(synced.body.orderId, committed.body.orderId);

  assert.equal(await orderCount(), 1, "final database state: exactly ONE order");
  assert.equal(await counter(), 121, "exactly one order number consumed");
  assert.equal(await claimCount(), 1);

  const order = (await db.collection("orders").get()).docs[0];
  assert.equal(order.data().paymentStatus, "unpaid", "replay did not overwrite the original");
});

// ── R5 ───────────────────────────────────────────────────────────────────────
test("[R5] the real handler returns 409 for the same key with different items", async () => {
  await seed();
  const original = await callOnline(onlinePayload("txn-r5"));

  const conflict = await callOnline(
    onlinePayload("txn-r5", {
      items: [{ id: "m-side", name: "Loaded Potato", quantity: 9, selectedSize: null, selectedModifiers: [], itemNote: "" }],
    })
  );

  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.conflict, true);
  assert.ok(!("orderId" in conflict.body), "no order id leaked in the error body");
  assert.equal(await orderCount(), 1);
  assert.equal(await counter(), 121);

  const order = (await db.collection("orders").get()).docs[0];
  assert.equal(order.id, original.body.orderId);
  assert.equal(order.data().items.length, 2, "original items untouched");
});

// ── R6 · customPrice through the real sync handler ───────────────────────────
test("[R6] customPrice survives the real sync handler and is validated server-side", async () => {
  await seed();

  const customItem = {
    id: "m-tray", name: "Party Tray", price: 25000, quantity: 1,
    selectedSize: null, selectedModifiers: [], customPrice: 25000, itemNote: "pickup 6pm",
  };
  const res = await callSync(queuedPayload("txn-r6", { items: [customItem], total: 25000 }));

  assert.equal(res.status, 201);
  const order = (await db.collection("orders").get()).docs[0].data();
  assert.equal(order.items[0].customPrice, 25000, "cashier price persisted, not reverted to catalogue");
  assert.equal(order.items[0].price, 25000);
  assert.equal(order.total, 25000);
  assert.equal(order.priceAuditAlert, false, "matches the server's revalidated price, so no alert");

  // A different custom price under the SAME key must conflict, not replay.
  const conflict = await callSync(
    queuedPayload("txn-r6", { items: [{ ...customItem, price: 900, customPrice: 900 }], total: 900 })
  );
  assert.equal(conflict.status, 409, "a re-priced order must not silently replay");
  assert.equal(await orderCount(), 1);
  assert.equal((await db.collection("orders").get()).docs[0].data().items[0].customPrice, 25000);
});

// ── R7 · custom pricing authorisation parity ─────────────────────────────────
test("[R7] the sync handler refuses a custom price on an item that disallows it", async () => {
  await seed();
  const res = await callSync(
    queuedPayload("txn-r7", {
      items: [{ id: "m-ribs", name: "Prime Ribs", price: 1, quantity: 1, selectedSize: null, selectedModifiers: [], customPrice: 1, itemNote: "" }],
      total: 1,
    })
  );

  assert.equal(res.status, 400, "same rule as the online route");
  assert.match(String(res.body.error), /Custom pricing not allowed/);
  assert.equal(await orderCount(), 0);
  assert.equal(await claimCount(), 0, "a rejected order claims nothing");
});

// ── R8 · legacy client compatibility ─────────────────────────────────────────
test("[R8] the real online handler still accepts a legacy payload with no key", async () => {
  await seed();
  const first = await callOnline(onlinePayload(undefined));
  const second = await callOnline(onlinePayload(undefined));

  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.equal(await orderCount(), 2, "unkeyed requests keep today's exact behaviour");
  assert.equal(await counter(), 122);
  assert.equal(await claimCount(), 0, "no claim without a key");
});

// ── R9 · key validation ──────────────────────────────────────────────────────
test("[R9] the sync handler rejects a missing or unusable key", async () => {
  await seed();
  for (const bad of [undefined, "", "   ", "x".repeat(201)]) {
    const res = await callSync(queuedPayload("placeholder", { localOrderId: bad }));
    assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(bad)}`);
  }
  assert.equal(await orderCount(), 0);
});

// ── R10 · both real handlers racing ──────────────────────────────────────────
test("[R10] the real online and sync handlers racing on one key produce one order", async () => {
  await seed();
  const [a, b] = await Promise.all([
    callOnline(onlinePayload("txn-r10")),
    callSync(queuedPayload("txn-r10")),
  ]);

  assert.equal(await orderCount(), 1, "two entry points, one order");
  assert.equal(await counter(), 121);
  assert.equal(a.body.orderId, b.body.orderId);
  assert.deepEqual([a.status, b.status].sort(), [200, 201]);
});

// ── runner ───────────────────────────────────────────────────────────────────
(async () => {
  await loadRealHandlers();
  console.log(`pos routes — REAL Next.js handlers + FIRESTORE EMULATOR (${process.env.FIRESTORE_EMULATOR_HOST})`);
  for (const [name, fn] of tests) {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  }
  await wipe();
  console.log(`\n${passed}/${tests.length} passed against the real route handlers`);
  await deleteApp(app);
})().catch(async (err) => {
  console.error("\n✗ FAILED\n", err);
  await deleteApp(app).catch(() => {});
  process.exit(1);
});
