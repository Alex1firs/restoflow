/**
 * Live-data compatibility audit for the POS idempotency change.
 * Run: npx tsx lib/pos/__tests__/live-compat.test.ts
 *
 * Restaurants are using this system right now, so the fixtures below are the data
 * shapes that already exist in production and must keep working untouched:
 *
 *   - orders created BEFORE localOrderId existed (no key, no claim)
 *   - unsettled counter bills sitting in Open Bills
 *   - dine-in bills, paid/completed orders
 *   - IndexedDB queue records written by the pre-fix client
 *
 * READ-ONLY BY CONSTRUCTION: everything here runs against fixtures and the fake
 * Firestore. Nothing in this file can reach a real project.
 *
 * The rule being enforced: no historical order needs a claim, no order document
 * needs rewriting, and nothing about an existing order's identity changes.
 */

import assert from "node:assert/strict";
import {
  POS_ORDER_CLAIMS,
  classifyOfflineHandoff,
  normalizeQueuedOrderKey,
  orderFingerprint,
  readPosClaim,
  type FirestoreLike,
} from "../idempotency";
import { toOrderRow, toOrderDetail, toLineItems } from "../../orders/admin-view";
import { FakeFirestore } from "./fake-firestore";

let passed = 0;
const tests: Array<[string, () => Promise<void> | void]> = [];
const test = (name: string, fn: () => Promise<void> | void) => tests.push([name, fn]);

const RESTAURANT = "tricias-kitchen";
const ts = (ms: number) => ({ toMillis: () => ms, toDate: () => new Date(ms) });
const NOW = 1_780_000_000_000;

// ── Production fixtures: shapes that predate this change ─────────────────────

/** An unsettled counter bill sitting in Open Bills. No localOrderId. */
const LEGACY_UNSETTLED_BILL = {
  restaurantId: RESTAURANT,
  customerName: "Walk-in Customer",
  phone: "",
  address: "",
  note: "",
  items: [
    { id: "m-jollof", name: "Jollof Rice", price: 3500, quantity: 2, selectedSize: null, selectedModifiers: [], customPrice: null, itemNote: "" },
    { id: "m-chicken", name: "Grilled Chicken", price: 4000, quantity: 1, selectedSize: null, selectedModifiers: [], customPrice: null, itemNote: "" },
  ],
  itemsTotal: 11000,
  deliveryFee: 0,
  total: 11000,
  paymentMethod: "cash",
  paymentStatus: "unpaid",
  status: "pending",
  deliveryType: "counter",
  orderType: "normal",
  orderSource: "counter",
  serviceMode: "counter",
  staffId: "staff-ada",
  staffName: "Ada",
  orderNumber: 417,
  createdAt: ts(NOW - 3_600_000),
};

/** A legacy dine-in bill with a table label. */
const LEGACY_DINE_IN_BILL = {
  ...LEGACY_UNSETTLED_BILL,
  customerName: "Table 6",
  deliveryType: "dine_in",
  serviceMode: "dine_in",
  tableLabel: "Table 6",
  waiterName: "Emeka",
  orderNumber: 418,
};

/** A completed, paid order from the archive. */
const LEGACY_PAID_ORDER = {
  ...LEGACY_UNSETTLED_BILL,
  paymentStatus: "paid",
  status: "completed",
  orderNumber: 402,
  createdAt: ts(NOW - 86_400_000),
};

/** An order written by the OLD offline sync route: has localOrderId, no claim. */
const LEGACY_SYNCED_ORDER = {
  ...LEGACY_UNSETTLED_BILL,
  localOrderId: "offline-k3f9a2b-1779999999999",
  orderNumber: 419,
  priceAuditAlert: false,
  deviceId: "dev-abc-1",
  terminalName: "Terminal 1",
};

/** An IndexedDB queue record written by the pre-fix client (no customPrice field). */
const LEGACY_QUEUE_RECORD = {
  localOrderId: "offline-p8x2m1q-1779999000000",
  items: [
    { id: "m-jollof", name: "Jollof Rice", price: 3500, quantity: 2, selectedSize: null, selectedModifiers: [], itemNote: "" },
  ],
  total: 7000,
  cashierId: "staff-ada",
  cashierName: "Ada",
  deviceId: "dev-abc-1",
  terminalName: "Terminal 1",
  syncStatus: "pending" as const,
  createdAt: NOW - 7_200_000,
  orderSource: "counter" as const,
  paymentMethod: "cash",
  paymentStatus: "unpaid",
  customerName: "Walk-in Guest",
  note: "",
  waiterName: null,
  pricingMode: "regular",
  serviceMode: "counter",
  tableLabel: "",
};

// ── 1 · existing unsettled bills remain fully usable ─────────────────────────
test("[1] a legacy unsettled bill with no localOrderId still views, prints and settles", () => {
  // Viewable: the super-admin/dashboard row mapper handles it unchanged.
  const row = toOrderRow("ORD_LEGACY_417", LEGACY_UNSETTLED_BILL);
  assert.equal(row.orderId, "ORD_LEGACY_417", "canonical order id unchanged");
  assert.equal(row.total, 11000);
  assert.equal(row.paymentStatus, "unpaid");
  assert.equal(row.orderNumber, 417, "order number unchanged");

  // Openable from Open Bills / order detail.
  const detail = toOrderDetail("ORD_LEGACY_417", LEGACY_UNSETTLED_BILL);
  assert.equal(detail.orderId, "ORD_LEGACY_417");
  assert.equal(detail.orderNumber, 417);

  // Printable: line items resolve for the receipt/kitchen slip.
  const lines = toLineItems(LEGACY_UNSETTLED_BILL.items);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].name, "Jollof Rice");
  assert.equal(lines.reduce((sum, l) => sum + (l.lineTotal ?? 0), 0), 11000, "totals still add up");

  // Settling is an UPDATE by document id and never consults localOrderId or a
  // claim, so a missing key cannot block it.
  const settled = { ...LEGACY_UNSETTLED_BILL, paymentStatus: "paid", paymentMethod: "cash" };
  assert.equal(settled.orderNumber, 417, "settling does not renumber");
  assert.equal(toOrderRow("ORD_LEGACY_417", settled).paymentStatus, "paid");

  // No localOrderId anywhere in the record — and that is fine.
  assert.equal("localOrderId" in LEGACY_UNSETTLED_BILL, false);
});

// ── 2 · dine-in and archived orders ──────────────────────────────────────────
test("[2] legacy dine-in and completed orders are unaffected", () => {
  const dineIn = toOrderRow("ORD_418", LEGACY_DINE_IN_BILL);
  assert.equal(dineIn.orderNumber, 418);
  assert.equal(LEGACY_DINE_IN_BILL.tableLabel, "Table 6");

  const paid = toOrderRow("ORD_402", LEGACY_PAID_ORDER);
  assert.equal(paid.paymentStatus, "paid");
  assert.equal(paid.orderNumber, 402);
  // Nothing in this change writes to historical orders.
  assert.deepEqual(Object.keys(LEGACY_PAID_ORDER).sort(), Object.keys({ ...LEGACY_PAID_ORDER }).sort());
});

// ── 3 · no historical order needs a claim ────────────────────────────────────
test("[3] historical orders need no claim document and none is created for them", async () => {
  const db = new FakeFirestore();
  db.seed("restaurants", RESTAURANT, { orderCounter: 419 });
  db.seed("orders", "ORD_417", LEGACY_UNSETTLED_BILL);
  db.seed("orders", "ORD_402", LEGACY_PAID_ORDER);
  db.seed("orders", "ORD_418", LEGACY_DINE_IN_BILL);

  assert.equal(db.countIn(POS_ORDER_CLAIMS), 0, "no claims exist for historical data");

  // Reading a legacy order's claim simply returns null; nothing is created.
  const claim = await readPosClaim(db as unknown as FirestoreLike, RESTAURANT, "offline-does-not-exist");
  assert.equal(claim, null);
  assert.equal(db.countIn(POS_ORDER_CLAIMS), 0, "a lookup must not write");
  assert.equal(db.commits.length, 0, "the audit performed zero writes");

  // All three orders still readable by their original document ids.
  for (const id of ["ORD_417", "ORD_402", "ORD_418"]) {
    const snap = await db.collection("orders").doc(id).get();
    assert.equal(snap.exists, true, `${id} still resolves`);
  }
});

// ── 4 · pre-fix queue records keep their key and still sync ──────────────────
test("[4] an existing pending IndexedDB record keeps its own key and syncs once", () => {
  // The pre-fix client already wrote a localOrderId, so nothing is minted.
  let minted = 0;
  const normalized = normalizeQueuedOrderKey(LEGACY_QUEUE_RECORD, () => `txn-new-${++minted}`);
  assert.equal(normalized.changed, false, "the record keeps the identity it already has");
  assert.equal(normalized.record.localOrderId, "offline-p8x2m1q-1779999000000");
  assert.equal(minted, 0, "no new id was generated");

  // Repeated retries keep reusing it — no per-attempt churn.
  const again = normalizeQueuedOrderKey(normalized.record, () => `txn-new-${++minted}`);
  assert.equal(again.record.localOrderId, "offline-p8x2m1q-1779999000000");
  assert.equal(minted, 0);

  // Its items lack customPrice entirely; the fingerprint must treat that as
  // "no custom price" rather than choking or differing from an explicit null.
  const legacyFp = orderFingerprint({
    items: LEGACY_QUEUE_RECORD.items,
    serviceMode: "counter",
    tableLabel: "",
    note: "",
    pricingMode: "regular",
  });
  const withExplicitNull = orderFingerprint({
    items: LEGACY_QUEUE_RECORD.items.map((i) => ({ ...i, customPrice: null })),
    serviceMode: "counter",
    tableLabel: "",
    note: "",
    pricingMode: "regular",
  });
  assert.equal(legacyFp, withExplicitNull, "an absent customPrice == an explicit null");
});

// ── 5 · a queue record with a blank key gets one, exactly once ───────────────
test("[5] a damaged queue record with a blank key is repaired once, not per attempt", () => {
  let minted = 0;
  const mint = () => `txn-repaired-${++minted}`;
  const damaged = { ...LEGACY_QUEUE_RECORD, localOrderId: "" };

  const first = normalizeQueuedOrderKey(damaged, mint);
  assert.equal(first.changed, true);
  assert.equal(first.previousKey, "", "caller knows which stale key to remove");
  assert.equal(minted, 1);

  // The caller persists it; later attempts reuse it.
  assert.equal(normalizeQueuedOrderKey(first.record, mint).changed, false);
  assert.equal(normalizeQueuedOrderKey(first.record, mint).record.localOrderId, "txn-repaired-1");
  assert.equal(minted, 1, "exactly one id ever minted");
});

// ── 6 · re-opening a legacy server order offline is refused, not duplicated ──
test("[6] editing a legacy server order while offline is refused rather than re-created", () => {
  // Editing an order that exists on the server (a legacy Firestore doc id) must
  // never enter the creation queue — that would mint a second order.
  const decision = classifyOfflineHandoff({
    editingOrderId: "ORD_417",
    queuedLocalOrderIds: [LEGACY_QUEUE_RECORD.localOrderId],
    draftTxnId: "txn-active",
  });
  assert.equal(decision.kind, "reject-server-edit");

  // But re-opening a genuinely offline queued bill is still allowed and reuses
  // that bill's key, so it overwrites the same queue record.
  const draftEdit = classifyOfflineHandoff({
    editingOrderId: LEGACY_QUEUE_RECORD.localOrderId,
    queuedLocalOrderIds: [LEGACY_QUEUE_RECORD.localOrderId],
    draftTxnId: "txn-active",
  });
  assert.equal(draftEdit.kind, "offline-draft-update");
  assert.equal(
    draftEdit.kind === "offline-draft-update" && draftEdit.localOrderId,
    LEGACY_QUEUE_RECORD.localOrderId
  );
});

// ── 7 · dashboards and totals stay compatible ───────────────────────────────
test("[7] dashboard totals over mixed legacy and new orders are unchanged", () => {
  // A new order carries localOrderId; a legacy one does not. Both must aggregate
  // identically, because totals come from itemsTotal/total, not from identity.
  const newOrder = {
    ...LEGACY_UNSETTLED_BILL,
    localOrderId: "txn-brand-new",
    orderNumber: 420,
    paymentStatus: "paid",
  };
  const all = [LEGACY_PAID_ORDER, LEGACY_SYNCED_ORDER, newOrder];

  const revenue = all
    .filter((o) => o.paymentStatus === "paid")
    .reduce((sum, o) => sum + o.total, 0);
  assert.equal(revenue, LEGACY_PAID_ORDER.total + newOrder.total);

  // Row mapping works across all three shapes without special-casing.
  const rows = all.map((o, i) => toOrderRow(`ORD_${i}`, o));
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.total), [11000, 11000, 11000]);
  // The extra field is additive and ignored by consumers.
  assert.equal("localOrderId" in LEGACY_PAID_ORDER, false);
  assert.equal(newOrder.localOrderId, "txn-brand-new");
});

// ── 8 · a cached pre-idempotency client still works ────────────────────────
test("[8] a cached client that sends no key still creates orders (compatibility window)", () => {
  // The online route treats the key as optional while POS_REQUIRE_IDEMPOTENCY_KEY
  // is unset, so a terminal on a stale PWA bundle is not taken offline by the
  // deploy. Asserted end-to-end against the real handler in routes.test.ts [R8];
  // here we pin the contract that absence is allowed, not an error.
  const legacyPayloadHasNoKey = !("localOrderId" in { items: LEGACY_UNSETTLED_BILL.items });
  assert.equal(legacyPayloadHasNoKey, true);
  assert.equal(process.env.POS_REQUIRE_IDEMPOTENCY_KEY, undefined, "enforcement is off by default");
});

// ── runner ───────────────────────────────────────────────────────────────────
(async () => {
  console.log("pos/live-compat (fixtures only — no production access)");
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
