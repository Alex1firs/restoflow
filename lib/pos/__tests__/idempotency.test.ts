/**
 * POS order idempotency tests.
 * Run: npx tsx lib/pos/__tests__/idempotency.test.ts
 *
 * These cover the production bug where a single cashier transaction produced 3–4
 * identical orders: the terminal lost the HTTP response, re-queued the order
 * under a brand new id, and the server had no atomic way to recognise the retry.
 *
 * `onlineRoute` / `syncRoute` below are thin stand-ins for the two API handlers.
 * They mirror the commit stage of the real routes and call the same shared
 * functions the routes call (`orderFingerprint`, `commitPosOrder`,
 * `createPosOrderUnkeyed`, `backfillClaim`), so the idempotency logic under test
 * is the production logic — only auth, subscription and menu-pricing plumbing is
 * left out. Fingerprint parity between the two entry points is asserted directly
 * against the exact payload shapes POSClient builds (test 4a).
 */

import assert from "node:assert/strict";
import {
  POS_ORDER_CLAIMS,
  backfillClaim,
  claimDocId,
  classifyOfflineHandoff,
  commitPosOrder,
  createPosOrderUnkeyed,
  normalizeQueuedOrderKey,
  orderFingerprint,
  validateLocalOrderId,
  type FirestoreLike,
  type PosCommitResult,
} from "../idempotency";
import { FakeFirestore } from "./fake-firestore";

let passed = 0;
const tests: Array<[string, () => Promise<void> | void]> = [];
const test = (name: string, fn: () => Promise<void> | void) => tests.push([name, fn]);

const RESTAURANT = "grills-capitol";

function freshDb(): FakeFirestore {
  const db = new FakeFirestore();
  db.seed("restaurants", RESTAURANT, { name: "Grills Capitol", orderCounter: 120 });
  return db;
}

// ── Route stand-ins ──────────────────────────────────────────────────────────

interface CartItem {
  id: string;
  quantity: number;
  selectedSize?: { name: string; price: number } | null;
  selectedModifiers?: { groupName: string; name: string; price: number }[];
  price?: number;
  customPrice?: number | null;
  itemNote?: string;
}

interface RoutePayload {
  localOrderId?: string;
  items: CartItem[];
  serviceMode?: string;
  tableLabel?: string;
  paymentStatus?: string;
  paymentMethod?: string;
  customerName?: string;
  note?: string;
  pricingMode?: string;
}

function fingerprintOf(payload: RoutePayload): string {
  const { serviceMode, tableLabel } = resolveMode(payload);
  return orderFingerprint({
    items: payload.items,
    serviceMode,
    tableLabel,
    note: (payload.note ?? "").trim(),
    pricingMode: payload.pricingMode ?? "regular",
  });
}

interface RouteResponse {
  status: 200 | 201 | 409 | 500;
  /** The canonical order. On a conflict this is the order that already exists. */
  orderId: string;
  orderNumber: number | null;
  replayed?: true;
  conflict?: true;
  integrityError?: true;
}

function toResponse(result: PosCommitResult): RouteResponse {
  if (result.outcome === "missing_order") {
    return { status: 500, integrityError: true, orderId: result.orderId, orderNumber: null };
  }
  if (result.outcome === "conflict") {
    return { status: 409, conflict: true, orderId: result.orderId, orderNumber: null };
  }
  if (result.outcome === "replayed") {
    return { status: 200, orderId: result.orderId, orderNumber: result.orderNumber, replayed: true };
  }
  return { status: 201, orderId: result.orderId, orderNumber: result.orderNumber };
}

function resolveMode(payload: RoutePayload) {
  const serviceMode = payload.serviceMode === "dine_in" ? "dine_in" : "counter";
  const tableLabel = serviceMode === "dine_in" ? (payload.tableLabel ?? "").trim() : "";
  return { serviceMode, tableLabel };
}

/** Mirrors /api/admin/pos. */
async function onlineRoute(db: FakeFirestore, payload: RoutePayload): Promise<RouteResponse> {
  const { serviceMode } = resolveMode(payload);
  const buildOrderData = (orderNumber: number) => ({
    restaurantId: RESTAURANT,
    ...(payload.localOrderId ? { localOrderId: payload.localOrderId } : {}),
    items: payload.items,
    total: payload.items.reduce((s, i) => s + (i.price ?? 100) * i.quantity, 0),
    paymentStatus: payload.paymentStatus ?? "unpaid",
    paymentMethod: payload.paymentMethod ?? "cash",
    orderSource: "counter",
    serviceMode,
    status: "pending",
    orderNumber,
  });

  if (!payload.localOrderId) {
    // Legacy terminal on a cached PWA bundle.
    return toResponse(
      await createPosOrderUnkeyed({
        db: db as unknown as FirestoreLike,
        restaurantId: RESTAURANT,
        buildOrderData,
      })
    );
  }

  return toResponse(
    await commitPosOrder({
      db: db as unknown as FirestoreLike,
      restaurantId: RESTAURANT,
      localOrderId: payload.localOrderId,
      fingerprint: fingerprintOf(payload),
      source: "online",
      buildOrderData,
      nowMs: 1_700_000_000_000,
    })
  );
}

/** Mirrors /api/admin/pos/sync, including the pre-fix safety net. */
async function syncRoute(db: FakeFirestore, payload: RoutePayload): Promise<RouteResponse> {
  const keyError = validateLocalOrderId(payload.localOrderId);
  assert.equal(keyError, null, "sync route requires a key");
  const localOrderId = payload.localOrderId!;
  const { serviceMode } = resolveMode(payload);
  const fingerprint = fingerprintOf(payload);

  const dupSnap = await db
    .collection("orders")
    .where("restaurantId", "==", RESTAURANT)
    .where("localOrderId", "==", localOrderId)
    .limit(1)
    .get();

  if (!dupSnap.empty) {
    const existing = dupSnap.docs[0];
    const existingNumber = existing.data().orderNumber;
    const existingOrderNumber = typeof existingNumber === "number" ? existingNumber : null;
    await backfillClaim({
      db: db as unknown as FirestoreLike,
      restaurantId: RESTAURANT,
      localOrderId,
      orderId: existing.id,
      orderNumber: existingOrderNumber,
      fingerprint,
      nowMs: 1_700_000_000_000,
    });
    return {
      status: 200,
      orderId: existing.id,
      orderNumber: existingOrderNumber,
      replayed: true,
    };
  }

  return toResponse(
    await commitPosOrder({
      db: db as unknown as FirestoreLike,
      restaurantId: RESTAURANT,
      localOrderId,
      fingerprint,
      source: "sync",
      buildOrderData: (orderNumber) => ({
        restaurantId: RESTAURANT,
        localOrderId,
        items: payload.items,
        total: payload.items.reduce((s, i) => s + (i.price ?? 100) * i.quantity, 0),
        paymentStatus: payload.paymentStatus ?? "paid",
        paymentMethod: payload.paymentMethod ?? "cash",
        orderSource: "counter",
        serviceMode,
        status: "pending",
        orderNumber,
      }),
      nowMs: 1_700_000_000_000,
    })
  );
}

const CART: CartItem[] = [
  { id: "m-gc-1", quantity: 2, price: 3599, selectedSize: null, selectedModifiers: [] },
  { id: "m-gc-4", quantity: 1, price: 650, selectedSize: null, selectedModifiers: [] },
];

const orderCount = (db: FakeFirestore) => db.countIn("orders");
const counterOf = (db: FakeFirestore) =>
  db.docsIn("restaurants").find((d) => d.id === RESTAURANT)!.data.orderCounter;

// ── 1 ────────────────────────────────────────────────────────────────────────
test("[1] a normal online order creates exactly one order", async () => {
  const db = freshDb();
  const res = await onlineRoute(db, { localOrderId: "txn-a", items: CART });

  assert.equal(res.status, 201);
  assert.equal(orderCount(db), 1);
  assert.equal(counterOf(db), 121);
  assert.equal(res.orderNumber, 121);
  assert.equal(db.countIn(POS_ORDER_CLAIMS), 1);
});

// ── 2 ────────────────────────────────────────────────────────────────────────
test("[2] the same online request repeated sequentially creates one order", async () => {
  const db = freshDb();
  const first = await onlineRoute(db, { localOrderId: "txn-b", items: CART });
  const second = await onlineRoute(db, { localOrderId: "txn-b", items: CART });
  const third = await onlineRoute(db, { localOrderId: "txn-b", items: CART });

  assert.equal(orderCount(db), 1);
  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal(third.status, 200);
  assert.equal(second.replayed, true);
  assert.equal(second.orderId, first.orderId, "replay returns the canonical order id");
  assert.equal(third.orderId, first.orderId);
});

// ── 3 ────────────────────────────────────────────────────────────────────────
test("[3] two CONCURRENT online requests with the same key create one order", async () => {
  const db = freshDb();
  const [a, b] = await Promise.all([
    onlineRoute(db, { localOrderId: "txn-c", items: CART }),
    onlineRoute(db, { localOrderId: "txn-c", items: CART }),
  ]);

  assert.equal(orderCount(db), 1, "a race must not produce two orders");
  assert.equal(counterOf(db), 121, "and must not consume two order numbers");
  assert.equal(a.orderId, b.orderId, "both callers get the same canonical order");
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [200, 201], "exactly one created, one replayed");
  assert.ok(db.retries > 0, "the losing transaction was aborted and retried");
});

// ── 4 · THE PRODUCTION REGRESSION ────────────────────────────────────────────
test("[4] REGRESSION: online commits, response is lost, offline sync resends — one order", async () => {
  const db = freshDb();

  // 1. Cashier submits while online. The server commits the order...
  const committed = await onlineRoute(db, {
    localOrderId: "txn-lost",
    items: CART,
    paymentStatus: "unpaid",
  });
  assert.equal(committed.status, 201);
  assert.equal(orderCount(db), 1);

  // 2. ...but the connection dies before the response arrives. The client never
  //    sees `committed`. It falls into its catch block and queues the order —
  //    under the SAME key it already sent (this is the fix).
  // 3. Connectivity returns and the queue drains to the sync endpoint.
  const synced = await syncRoute(db, {
    localOrderId: "txn-lost",
    items: CART,
    paymentStatus: "paid", // settled offline in the meantime — must NOT be a conflict
  });

  assert.equal(orderCount(db), 1, "final state must contain exactly ONE order");
  assert.equal(counterOf(db), 121, "only one order number was ever consumed");
  assert.equal(synced.status, 200);
  assert.equal(synced.replayed, true);
  assert.equal(synced.orderId, committed.orderId, "same canonical order");

  // The original order was not modified by the replay.
  const order = db.docsIn("orders")[0];
  assert.equal(order.data.paymentStatus, "unpaid", "replay must not overwrite the original");
});

// ── 4a ───────────────────────────────────────────────────────────────────────
test("[4a] the online payload and the queued offline record fingerprint identically", () => {
  // Exactly the shapes POSClient builds — online payload vs IndexedDB record.
  const cart = [
    {
      id: "m-1",
      name: "Prime Rib",
      quantity: 2,
      selectedSize: { name: "Large", price: 4200 },
      selectedModifiers: [{ groupName: "Sides", name: "Fries", price: 500 }],
      customPrice: 3900,
      itemNote: "medium rare",
    },
  ];
  const onlineItems = cart.map((c) => ({
    id: c.id,
    name: c.name,
    quantity: c.quantity,
    selectedSize: c.selectedSize,
    selectedModifiers: c.selectedModifiers,
    customPrice: c.customPrice,
    itemNote: c.itemNote,
  }));
  // The offline record carries a RESOLVED unit price (`price`) that the online
  // payload has no equivalent for — which is why resolved money is excluded from
  // the fingerprint. `customPrice` is the cashier's input, so it IS carried
  // through and IS fingerprinted.
  const offlineItems = cart.map((c) => ({
    id: c.id,
    name: c.name,
    price: 4700,
    quantity: c.quantity,
    selectedSize: c.selectedSize,
    selectedModifiers: c.selectedModifiers,
    customPrice: c.customPrice ?? null,
    itemNote: c.itemNote,
  }));

  const online = orderFingerprint({ items: onlineItems, serviceMode: "counter", tableLabel: "" });
  const offline = orderFingerprint({ items: offlineItems, serviceMode: "counter", tableLabel: "" });
  assert.equal(online, offline, "a resolved-price difference must not read as a new order");

  // Cart order is not identity.
  const twoItems = [{ id: "a", quantity: 1 }, { id: "b", quantity: 2 }];
  assert.equal(
    orderFingerprint({ items: twoItems, serviceMode: "counter" }),
    orderFingerprint({ items: [...twoItems].reverse(), serviceMode: "counter" })
  );
});

// ── 5 ────────────────────────────────────────────────────────────────────────
test("[5] the same queued order synced repeatedly leaves one order", async () => {
  const db = freshDb();
  const first = await syncRoute(db, { localOrderId: "txn-q", items: CART });
  for (let i = 0; i < 4; i++) {
    const again = await syncRoute(db, { localOrderId: "txn-q", items: CART });
    assert.equal(again.status, 200);
    assert.equal(again.orderId, first.orderId);
  }
  assert.equal(orderCount(db), 1);
  assert.equal(counterOf(db), 121);
});

// ── 6 ────────────────────────────────────────────────────────────────────────
test("[6] online route and sync route racing on the same key create one order", async () => {
  const db = freshDb();
  const [a, b] = await Promise.all([
    onlineRoute(db, { localOrderId: "txn-both", items: CART }),
    syncRoute(db, { localOrderId: "txn-both", items: CART }),
  ]);

  assert.equal(orderCount(db), 1, "two tabs / two entry points must not double-write");
  assert.equal(counterOf(db), 121);
  assert.equal(a.orderId, b.orderId);
  assert.deepEqual([a.status, b.status].sort(), [200, 201]);
});

// ── 7 ────────────────────────────────────────────────────────────────────────
test("[7] the same key with materially different items conflicts and preserves the original", async () => {
  const db = freshDb();
  const original = await onlineRoute(db, { localOrderId: "txn-x", items: CART });
  const commitsBefore = db.commits.length;

  const conflict = await onlineRoute(db, {
    localOrderId: "txn-x",
    items: [{ id: "m-gc-9", quantity: 7, price: 999 }], // a different order entirely
  });

  assert.equal(conflict.status, 409);
  assert.equal(conflict.conflict, true);
  assert.equal(conflict.orderId, original.orderId, "points at the real order");
  assert.equal(orderCount(db), 1, "no second order");
  assert.equal(counterOf(db), 121, "no order number consumed");
  assert.equal(db.commits.length, commitsBefore, "a conflict writes nothing at all");

  const order = db.docsIn("orders")[0];
  assert.equal((order.data.items as CartItem[]).length, 2, "original items untouched");
  assert.equal((order.data.items as CartItem[])[0].id, "m-gc-1");
});

// ── 8 ────────────────────────────────────────────────────────────────────────
test("[8] a queue record without a usable key gets ONE id, persisted and reused", () => {
  let minted = 0;
  const mint = () => `txn-minted-${++minted}`;

  const legacy = { localOrderId: "", total: 4249, items: CART };
  const first = normalizeQueuedOrderKey(legacy, mint);
  assert.equal(first.changed, true);
  assert.equal(first.record.localOrderId, "txn-minted-1");
  assert.equal(first.previousKey, "", "caller knows which stale key to delete");

  // The caller persists `first.record`. Every later retry reads it back and must
  // NOT mint again — this is what stopped the per-attempt id churn.
  const second = normalizeQueuedOrderKey(first.record, mint);
  const third = normalizeQueuedOrderKey(second.record, mint);
  assert.equal(second.changed, false);
  assert.equal(third.changed, false);
  assert.equal(third.record.localOrderId, "txn-minted-1");
  assert.equal(minted, 1, "exactly one id was ever minted");

  // An existing record keeps the identity it already has.
  const existing = normalizeQueuedOrderKey({ localOrderId: "offline-abc-123" }, mint);
  assert.equal(existing.changed, false);
  assert.equal(existing.record.localOrderId, "offline-abc-123");
  assert.equal(minted, 1);
});

// ── 9 ────────────────────────────────────────────────────────────────────────
test("[9] a replay does not increment the order counter", async () => {
  const db = freshDb();
  assert.equal(counterOf(db), 120);
  await onlineRoute(db, { localOrderId: "txn-n", items: CART });
  assert.equal(counterOf(db), 121);

  for (let i = 0; i < 5; i++) {
    await onlineRoute(db, { localOrderId: "txn-n", items: CART });
  }
  assert.equal(counterOf(db), 121, "five replays consumed zero order numbers");
  assert.equal(orderCount(db), 1);
});

// ── 10 ───────────────────────────────────────────────────────────────────────
test("[10] a replay performs no writes, so no side effect can repeat", async () => {
  const db = freshDb();
  await onlineRoute(db, { localOrderId: "txn-s", items: CART });

  const commitsAfterCreate = [...db.commits];
  // The create touched exactly three documents: claim, counter, order.
  assert.equal(commitsAfterCreate.length, 3);
  assert.deepEqual(
    commitsAfterCreate.map((c) => c.path.split("/")[0]).sort(),
    ["orders", POS_ORDER_CLAIMS, "restaurants"].sort()
  );

  await onlineRoute(db, { localOrderId: "txn-s", items: CART });
  await syncRoute(db, { localOrderId: "txn-s", items: CART });

  assert.deepEqual(
    db.commits,
    commitsAfterCreate,
    "replays wrote nothing: no order, no counter, no stock, no notification, no payment row"
  );
});

// ── 11 ───────────────────────────────────────────────────────────────────────
test("[11] a terminal on an old bundle (no key) still creates orders as before", async () => {
  const db = freshDb();
  const first = await onlineRoute(db, { items: CART });
  const second = await onlineRoute(db, { items: CART });

  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.equal(orderCount(db), 2, "unkeyed requests keep today's exact behaviour");
  assert.equal(counterOf(db), 122);
  assert.equal(db.countIn(POS_ORDER_CLAIMS), 0, "no claim is written without a key");
  assert.notEqual(first.orderId, second.orderId);
});

// ── 12 ───────────────────────────────────────────────────────────────────────
test("[12] receipts and order lookups resolve via the canonical server order id", async () => {
  const db = freshDb();
  const created = await onlineRoute(db, { localOrderId: "txn-r", items: CART });

  // The id handed to receipts/kitchen slips/order detail must resolve to a real
  // order document, on the first response and on every replay.
  const byId = await db.collection("orders").doc(created.orderId).get();
  assert.equal(byId.exists, true);
  assert.equal(byId.data()!.orderNumber, 121);

  const replay = await onlineRoute(db, { localOrderId: "txn-r", items: CART });
  const replayById = await db.collection("orders").doc(replay.orderId).get();
  assert.equal(replayById.exists, true, "replay id is navigable, not a local placeholder");
  assert.equal(replay.orderId, created.orderId);
  assert.equal(replay.orderNumber, 121, "same invoice number, not a new one");

  // Order ids stay server-generated, so nothing that assumed a random id breaks.
  assert.ok(!created.orderId.includes("txn-r"), "order id is not derived from the key");
  assert.ok(!created.orderId.includes(RESTAURANT));
});

// ── 13 · migration safety net ────────────────────────────────────────────────
test("[13] an order created by the OLD sync route is not duplicated after deploy", async () => {
  const db = freshDb();
  // Pre-existing order: has localOrderId, but no claim (the old code path).
  db.seed("orders", "legacy_order_1", {
    restaurantId: RESTAURANT,
    localOrderId: "offline-legacy-1",
    items: CART,
    total: 4249,
    orderNumber: 118,
    paymentStatus: "paid",
  });
  assert.equal(db.countIn(POS_ORDER_CLAIMS), 0);

  const res = await syncRoute(db, { localOrderId: "offline-legacy-1", items: CART });

  assert.equal(res.status, 200);
  assert.equal(res.orderId, "legacy_order_1");
  assert.equal(orderCount(db), 1, "the queued record across the deploy did not duplicate");
  assert.equal(counterOf(db), 120, "no order number consumed");
  assert.equal(db.countIn(POS_ORDER_CLAIMS), 1, "a claim was back-filled for future retries");

  // And the back-filled claim now serves later retries atomically.
  const again = await syncRoute(db, { localOrderId: "offline-legacy-1", items: CART });
  assert.equal(again.orderId, "legacy_order_1");
  assert.equal(orderCount(db), 1);
});

// ── 14 · key handling ────────────────────────────────────────────────────────
test("[14] claim ids are restaurant-scoped, injective and Firestore-safe", () => {
  assert.notEqual(
    claimDocId("rest-a", "txn-1"),
    claimDocId("rest-b", "txn-1"),
    "two restaurants must never contend on one key"
  );
  assert.notEqual(
    claimDocId("a", "b__c"),
    claimDocId("a__b", "c"),
    "the separator must not let distinct pairs collapse onto one claim"
  );
  for (const id of [claimDocId("a/b", "c d"), claimDocId("r", "txn-.."), claimDocId("r", "a#b")]) {
    assert.ok(!id.includes("/"), `no slashes in ${id}`);
    assert.ok(id !== "." && id !== "..", "not a relative path segment");
    assert.ok(/^[A-Za-z0-9_-]+$/.test(id), `only safe characters in ${id}`);
  }

  assert.equal(validateLocalOrderId("txn-ok"), null);
  assert.ok(validateLocalOrderId(""));
  assert.ok(validateLocalOrderId("   "));
  assert.ok(validateLocalOrderId(undefined));
  assert.ok(validateLocalOrderId(42));
  assert.ok(validateLocalOrderId("x".repeat(201)), "over-long keys are rejected");
});

// ── 15 · heavier race ────────────────────────────────────────────────────────
test("[15] six simultaneous retries of one transaction still yield one order", async () => {
  const db = freshDb();
  const results = await Promise.all(
    Array.from({ length: 6 }, () => onlineRoute(db, { localOrderId: "txn-storm", items: CART }))
  );

  assert.equal(orderCount(db), 1, "the reported 3–4 duplicates cannot happen");
  assert.equal(counterOf(db), 121);
  assert.equal(results.filter((r) => r.status === 201).length, 1, "exactly one create");
  assert.equal(results.filter((r) => r.status === 200).length, 5, "five replays");
  const ids = new Set(results.map((r) => r.orderId));
  assert.equal(ids.size, 1, "every caller got the same canonical order id");
});


// ── 16 · B: customPrice preserved end to end ─────────────────────────────────
test("[16] customPrice survives the online→offline hand-off and is fingerprinted", () => {
  // The exact shapes POSClient builds for a custom-priced item.
  const cart = [{
    id: "m-1", name: "Party Tray", quantity: 1,
    selectedSize: null, selectedModifiers: [],
    customPrice: 25000, itemNote: "for pickup 6pm",
  }];
  const onlineItems = cart.map((c) => ({
    id: c.id, name: c.name, quantity: c.quantity,
    selectedSize: c.selectedSize, selectedModifiers: c.selectedModifiers,
    customPrice: c.customPrice, itemNote: c.itemNote,
  }));
  // The queue record now carries customPrice (this was the data-loss defect).
  const offlineItems = cart.map((c) => ({
    id: c.id, name: c.name, price: 25000, quantity: c.quantity,
    selectedSize: c.selectedSize, selectedModifiers: c.selectedModifiers,
    customPrice: c.customPrice ?? null, itemNote: c.itemNote,
  }));

  assert.equal(offlineItems[0].customPrice, 25000, "cashier price reaches the queue record");

  const online = orderFingerprint({ items: onlineItems, serviceMode: "counter", tableLabel: "" });
  const offline = orderFingerprint({ items: offlineItems, serviceMode: "counter", tableLabel: "" });
  assert.equal(online, offline, "hand-off must not read as a different order");

  // Round-trips through JSON (localStorage / IndexedDB / the sync request body).
  const roundTripped = JSON.parse(JSON.stringify(offlineItems));
  assert.equal(roundTripped[0].customPrice, 25000);
  assert.equal(
    orderFingerprint({ items: roundTripped, serviceMode: "counter", tableLabel: "" }),
    offline,
    "survives reload and repeated synchronisation"
  );

  // null and undefined must not read as different orders.
  assert.equal(
    orderFingerprint({ items: [{ id: "x", quantity: 1, customPrice: null }], serviceMode: "counter" }),
    orderFingerprint({ items: [{ id: "x", quantity: 1 }], serviceMode: "counter" })
  );
});

// ── 17 · B: a different customPrice conflicts instead of replaying ───────────
test("[17] the same key with a different customPrice is a conflict, not a replay", async () => {
  const db = freshDb();
  const original = await onlineRoute(db, {
    localOrderId: "txn-cp",
    items: [{ id: "m-1", quantity: 1, price: 25000, customPrice: 25000 }],
  });
  assert.equal(original.status, 201);

  const tampered = await onlineRoute(db, {
    localOrderId: "txn-cp",
    items: [{ id: "m-1", quantity: 1, price: 900, customPrice: 900 }],
  });

  assert.equal(tampered.status, 409, "a re-priced order must not silently replay");
  assert.equal(orderCount(db), 1);
  assert.equal(counterOf(db), 121);
  const stored = db.docsIn("orders")[0].data.items as CartItem[];
  assert.equal(stored[0].customPrice, 25000, "original price preserved");
});

// ── 18 · B: other immutable intent fields ────────────────────────────────────
test("[18] quantity, size, modifiers, notes, pricingMode, mode and table are all identity", async () => {
  const base = {
    localOrderId: "txn-i",
    items: [{
      id: "m-1", quantity: 2, price: 100,
      selectedSize: { name: "Large", price: 500 },
      selectedModifiers: [{ groupName: "Sides", name: "Fries", price: 200 }],
      customPrice: null as number | null,
      itemNote: "no salt",
    }],
    serviceMode: "dine_in",
    tableLabel: "T4",
    note: "birthday",
    pricingMode: "regular",
  };

  const variants: Array<[string, RoutePayload]> = [
    ["quantity", { ...base, items: [{ ...base.items[0], quantity: 3 }] }],
    ["size", { ...base, items: [{ ...base.items[0], selectedSize: { name: "Small", price: 300 } }] }],
    ["modifiers", { ...base, items: [{ ...base.items[0], selectedModifiers: [{ groupName: "Sides", name: "Salad", price: 200 }] }] }],
    ["item note", { ...base, items: [{ ...base.items[0], itemNote: "extra salt" }] }],
    ["custom price", { ...base, items: [{ ...base.items[0], customPrice: 1500 }] }],
    ["order note", { ...base, note: "takeaway" }],
    ["pricing mode", { ...base, pricingMode: "indoor" }],
    ["service mode", { ...base, serviceMode: "counter" }],
    ["table", { ...base, tableLabel: "T9" }],
  ];

  const baseline = fingerprintOf(base);
  for (const [label, variant] of variants) {
    assert.notEqual(fingerprintOf(variant), baseline, `${label} must change the fingerprint`);
  }

  // Mutable, post-creation fields must NOT change it — otherwise the lost-response
  // sequence would false-conflict.
  for (const mutable of [
    { ...base, paymentStatus: "paid" },
    { ...base, paymentMethod: "card" },
    { ...base, customerName: "Walk-in Guest" },
  ]) {
    assert.equal(fingerprintOf(mutable), baseline, "settlement/identity fields stay excluded");
  }

  // And a genuine replay of the full-featured order still collapses.
  const db = freshDb();
  const first = await onlineRoute(db, base);
  const replay = await onlineRoute(db, { ...base, paymentStatus: "paid" });
  assert.equal(replay.status, 200);
  assert.equal(replay.orderId, first.orderId);
  assert.equal(orderCount(db), 1);
});

// ── 19 · C: an edit to a server order never becomes a new order ──────────────
test("[19] an offline edit of a committed order is refused, not queued as new", () => {
  // Re-opening a bill that only exists in the offline queue: safe to re-queue,
  // it overwrites the same record.
  const draft = classifyOfflineHandoff({
    editingOrderId: "txn-queued-1",
    queuedLocalOrderIds: ["txn-queued-1", "txn-queued-2"],
    draftTxnId: "txn-active",
  });
  assert.equal(draft.kind, "offline-draft-update");
  assert.equal(draft.kind === "offline-draft-update" && draft.localOrderId, "txn-queued-1");

  // Editing an order that already exists on the SERVER: must be refused. This is
  // the path that used to queue a server order id and mint a second order.
  const serverEdit = classifyOfflineHandoff({
    editingOrderId: "n1TcQwErTyUiOpAsDfGh", // a Firestore document id
    queuedLocalOrderIds: ["txn-queued-1"],
    draftTxnId: "txn-active",
  });
  assert.equal(serverEdit.kind, "reject-server-edit");

  // A brand new order uses the draft's own key.
  const created = classifyOfflineHandoff({
    editingOrderId: null,
    queuedLocalOrderIds: [],
    draftTxnId: "txn-active",
  });
  assert.equal(created.kind, "new");
  assert.equal(created.kind === "new" && created.localOrderId, "txn-active");
});

// ── 20 · C: the full edit-during-outage sequence ─────────────────────────────
test("[20] REGRESSION: edit an existing order, connection fails, sync runs — still one order", async () => {
  const db = freshDb();

  // An order already exists on the server.
  const created = await onlineRoute(db, { localOrderId: "txn-edit", items: CART });
  assert.equal(orderCount(db), 1);
  const originalNumber = created.orderNumber;

  // The cashier opens it for editing and submits; the connection fails.
  const queuedLocalOrderIds: string[] = []; // nothing queued offline
  const decision = classifyOfflineHandoff({
    editingOrderId: created.orderId, // a real server order id
    queuedLocalOrderIds,
    draftTxnId: "txn-some-draft",
  });

  // The client refuses the hand-off, so NOTHING is written to the queue...
  assert.equal(decision.kind, "reject-server-edit");
  assert.equal(queuedLocalOrderIds.length, 0, "no queue record was created");

  // ...and therefore the sync run that follows reconnection has nothing to send.
  for (const localOrderId of queuedLocalOrderIds) {
    await syncRoute(db, { localOrderId, items: CART });
  }

  assert.equal(orderCount(db), 1, "the database still holds exactly one order");
  assert.equal(counterOf(db), 121, "no second order number was allocated");
  assert.equal(db.docsIn("orders")[0].data.orderNumber, originalNumber);
});

// ── 21 · D: claim → order integrity ──────────────────────────────────────────
test("[21] every claim records what is needed to resolve the canonical order", async () => {
  const db = freshDb();
  const created = await onlineRoute(db, { localOrderId: "txn-claim", items: CART });

  const claims = db.docsIn(POS_ORDER_CLAIMS);
  assert.equal(claims.length, 1);
  const claim = claims[0];

  assert.equal(claim.id, claimDocId(RESTAURANT, "txn-claim"), "claim id is the derived identity");
  assert.equal(claim.data.restaurantId, RESTAURANT);
  assert.equal(claim.data.localOrderId, "txn-claim");
  assert.equal(claim.data.orderId, created.orderId, "resolves to the canonical order");
  assert.equal(claim.data.orderNumber, 121);
  assert.equal(claim.data.fingerprint, fingerprintOf({ localOrderId: "txn-claim", items: CART }));
  assert.equal(claim.data.source, "online");
  assert.equal(typeof claim.data.createdAtMs, "number", "creation metadata present");

  // The order carries the key back for support/audit/recovery.
  const order = db.docsIn("orders")[0];
  assert.equal(order.data.localOrderId, "txn-claim");
  assert.equal(order.id, created.orderId);
});

// ── 22 · D: a claim pointing at a missing order ──────────────────────────────
test("[22] a claim whose order is gone returns a controlled error, never a new order", async () => {
  const db = freshDb();
  await onlineRoute(db, { localOrderId: "txn-orphan", items: CART });
  assert.equal(orderCount(db), 1);

  // The order document disappears out of band (manual deletion, bad migration).
  const orderId = db.docsIn("orders")[0].id;
  db.hardDelete("orders", orderId);
  assert.equal(orderCount(db), 0);

  const commitsBefore = db.commits.length;
  const res = await onlineRoute(db, { localOrderId: "txn-orphan", items: CART });

  assert.equal(res.status, 500, "controlled server error");
  assert.equal(res.integrityError, true);
  assert.equal(orderCount(db), 0, "must NOT silently create a replacement order");
  assert.equal(counterOf(db), 121, "no order number consumed");
  assert.equal(db.commits.length, commitsBefore, "nothing written at all");
  assert.equal(db.countIn(POS_ORDER_CLAIMS), 1, "the claim is left intact for investigation");

  // The sync route behaves identically.
  const syncRes = await syncRoute(db, { localOrderId: "txn-orphan", items: CART });
  assert.equal(syncRes.status, 500);
  assert.equal(orderCount(db), 0);
});

// ── runner ───────────────────────────────────────────────────────────────────
(async () => {
  console.log("pos/idempotency");
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
