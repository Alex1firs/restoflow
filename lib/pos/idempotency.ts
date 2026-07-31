/**
 * POS order idempotency.
 *
 * One real cashier transaction must produce exactly one canonical server order,
 * no matter how many times it is submitted. The cashier's device mints a stable
 * `localOrderId` before the first request leaves the terminal, and BOTH order
 * entry points — `/api/admin/pos` (online) and `/api/admin/pos/sync` (offline
 * queue drain) — funnel through `commitPosOrder` below, so an order attempted
 * online and later re-sent by the offline sync resolves to the same order.
 *
 * ── Why a reservation doc instead of a deterministic order ID ────────────────
 * Order document IDs are referenced all over the app (receipts, kitchen slips,
 * /track/[orderId], /api/orders/[orderId]/*, dashboards, payment records) and
 * are handed out as public tracking URLs. Rather than change how those IDs are
 * minted, uniqueness is enforced by a separate server-only claim document whose
 * ID *is* deterministic:
 *
 *     pos_order_claims/{restaurantId}__{localOrderId}
 *
 * The claim, the order document and the order-counter increment are all written
 * inside a single Firestore transaction, so they commit or fail together.
 *
 * ── Why this is atomic (and a bare query-then-create is not) ─────────────────
 * The claim ref is read inside the transaction, which puts it in the read set.
 * If a concurrent transaction creates the same claim first, this one is aborted
 * by Firestore and retried by the SDK; on retry the claim exists, so it returns
 * the already-created order instead of writing a second one. `tx.create()` adds
 * a second, independent guarantee: it fails outright if the document is already
 * there. Neither path can leak a duplicate order or a second order number.
 */

/** Server-only collection. Never read or written by a client — see firestore.rules. */
export const POS_ORDER_CLAIMS = "pos_order_claims";

/** Upper bound on an accepted idempotency key, to keep claim doc IDs sane. */
export const MAX_LOCAL_ORDER_ID_LENGTH = 200;

// ── Minimal structural Firestore types ───────────────────────────────────────
// Declared structurally (rather than importing firebase-admin) so this module
// stays dependency-free and can be unit-tested against a fake.

export interface DocSnapshotLike {
  exists: boolean;
  id: string;
  data(): Record<string, unknown> | undefined;
}

export interface DocRefLike {
  id: string;
  /** Non-transactional read, used only by the migration pre-check. */
  get(): Promise<DocSnapshotLike>;
}

export interface TransactionLike {
  get(ref: DocRefLike): Promise<DocSnapshotLike>;
  create(ref: DocRefLike, data: Record<string, unknown>): unknown;
  set(ref: DocRefLike, data: Record<string, unknown>): unknown;
  update(ref: DocRefLike, data: Record<string, unknown>): unknown;
}

export interface CollectionRefLike {
  doc(id?: string): DocRefLike;
}

export interface FirestoreLike {
  collection(name: string): CollectionRefLike;
  runTransaction<T>(fn: (tx: TransactionLike) => Promise<T>): Promise<T>;
}

// ── Claim document identity ──────────────────────────────────────────────────

// Underscore is deliberately NOT safe: `__` is the segment separator, so letting
// it through raw would make `("a", "b__c")` and `("a__b", "c")` both encode to
// `a__b__c` — two unrelated transactions collapsing onto one claim.
const SAFE_ID_CHAR = /^[A-Za-z0-9-]$/;

/**
 * Encodes one path segment into characters Firestore accepts in a document ID.
 * Disallowed characters become `-<hex charcode>-`, which keeps the mapping
 * injective: two different inputs can never encode to the same output, so
 * sanitising cannot collapse two distinct orders onto one claim.
 */
function encodeSegment(segment: string): string {
  let out = "";
  for (const char of segment) {
    out += SAFE_ID_CHAR.test(char) ? char : `-${char.codePointAt(0)!.toString(16)}-`;
  }
  return out;
}

/**
 * Deterministic claim document ID for a (restaurant, localOrderId) pair.
 * Scoped by restaurant so two restaurants can never contend on the same key.
 */
export function claimDocId(restaurantId: string, localOrderId: string): string {
  return `${encodeSegment(restaurantId)}__${encodeSegment(localOrderId)}`;
}

/**
 * Reads the claim for a key, or null when there is none.
 *
 * Used to decide whether the pre-fix migration lookup is needed at all. Not a
 * uniqueness check — `commitPosOrder` is the only thing that guarantees that.
 */
export async function readPosClaim(
  db: FirestoreLike,
  restaurantId: string,
  localOrderId: string
): Promise<Record<string, unknown> | null> {
  const snap = await db
    .collection(POS_ORDER_CLAIMS)
    .doc(claimDocId(restaurantId, localOrderId))
    .get();
  return snap.exists ? (snap.data() ?? {}) : null;
}

/** Validates a client-supplied idempotency key. Returns null when acceptable. */
export function validateLocalOrderId(localOrderId: unknown): string | null {
  if (typeof localOrderId !== "string" || !localOrderId.trim()) {
    return "Missing unique localOrderId";
  }
  if (localOrderId.length > MAX_LOCAL_ORDER_ID_LENGTH) {
    return "localOrderId is too long";
  }
  return null;
}

// ── Payload fingerprint ──────────────────────────────────────────────────────

export interface FingerprintItem {
  id?: unknown;
  quantity?: unknown;
  /** Cashier-entered override price. Part of the order's intent, so it is included. */
  customPrice?: unknown;
  /** Reaches the kitchen, so a change to it is a materially different order. */
  itemNote?: unknown;
  selectedSize?: { name?: unknown } | null;
  selectedModifiers?: Array<{ name?: unknown }> | null;
}

export interface FingerprintInput {
  items: FingerprintItem[];
  serviceMode: string;
  tableLabel?: string;
  /** Order-level kitchen note. */
  note?: string;
  /** regular vs indoor pricing — changes what the customer is charged. */
  pricingMode?: string;
}

/** `null`/`undefined` and a missing field must fingerprint identically. */
function optionalNumber(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : `!${String(value)}`;
}

/**
 * Stable fingerprint of what the cashier actually rang up, used to detect an
 * idempotency key reused for a materially different order.
 *
 * INCLUDED — everything fixed at the moment of submission that changes what is
 * produced or what is charged:
 *   - item id, quantity, selected size, selected modifiers
 *   - customPrice (a manually entered price IS the order's intent)
 *   - per-item notes and the order-level note (both reach the kitchen)
 *   - pricingMode (regular vs indoor changes the amount charged)
 *   - serviceMode and tableLabel
 * Item lines are sorted, so a reordered cart is not a different order.
 *
 * EXCLUDED — fields that legitimately differ between the first attempt and a
 * later replay. Including any of them would raise a FALSE conflict on exactly
 * the sequence this fix exists to repair:
 *   - resolved unit prices and totals: the online route prices from the live
 *     catalogue while the sync route honours the price charged offline, and the
 *     catalogue can change in between. `customPrice` is fingerprinted instead —
 *     it is the cashier's input rather than a derived amount.
 *   - paymentMethod / paymentStatus: an offline bill can be settled locally
 *     before it ever syncs, so these are mutable after creation by design.
 *   - customerName: the two paths store different defaults for a walk-in
 *     ("Walk-in Customer" online vs "Walk-in Guest" in the queue record), so it
 *     is not comparable across them without changing stored data.
 *   - waiterName, cashier/device/terminal attribution.
 *   - createdAt, syncedAt, retry counters, auditLog, every other timestamp.
 */
export function orderFingerprint(input: FingerprintInput): string {
  const lines = (Array.isArray(input.items) ? input.items : []).map((item) => {
    const id = String(item?.id ?? "");
    const qty = Number(item?.quantity ?? 0);
    const size = String(item?.selectedSize?.name ?? "");
    const mods = (Array.isArray(item?.selectedModifiers) ? item.selectedModifiers : [])
      .map((m) => String(m?.name ?? ""))
      .sort()
      .join(",");
    const custom = optionalNumber(item?.customPrice);
    const itemNote = String(item?.itemNote ?? "").trim();
    return `${id}:${qty}:${size}:${mods}:${custom}:${itemNote}`;
  });
  lines.sort();
  const mode = String(input.serviceMode ?? "");
  const table = String(input.tableLabel ?? "");
  const note = String(input.note ?? "").trim();
  const pricing = String(input.pricingMode ?? "regular");
  return `v2|${mode}|${table}|${pricing}|${note}|${lines.join(";")}`;
}

// ── Commit ───────────────────────────────────────────────────────────────────

export type PosCommitResult =
  /** A brand new order was written and an order number consumed. */
  | { outcome: "created"; orderId: string; orderNumber: number }
  /** This key was already used for this same order; nothing was written. */
  | { outcome: "replayed"; orderId: string; orderNumber: number | null }
  /** This key was already used for a materially different order; nothing was written. */
  | { outcome: "conflict"; orderId: string }
  /**
   * A claim exists but the order it points at is gone — the claim and its order
   * are written in one transaction, so this should be impossible and means data
   * was deleted or corrupted out of band. Reported as a controlled server error;
   * writing a replacement order here would silently reintroduce duplicates.
   */
  | { outcome: "missing_order"; orderId: string };

export interface PosCommitInput {
  db: FirestoreLike;
  restaurantId: string;
  /** Stable idempotency key. Required — callers without one use `createPosOrderUnkeyed`. */
  localOrderId: string;
  /** Fingerprint from `orderFingerprint`, used for conflict detection. */
  fingerprint: string;
  /** Where the attempt came from, recorded on the claim for investigation. */
  source: "online" | "sync";
  /** Builds the order document once the order number has been allocated. */
  buildOrderData: (orderNumber: number) => Record<string, unknown>;
  /** Injected for deterministic tests. */
  nowMs?: number;
}

/**
 * Creates the order, or returns the canonical order already created under this
 * idempotency key. A replay performs NO writes at all: no second order, no
 * second order number, no repeated side effects.
 */
export async function commitPosOrder(input: PosCommitInput): Promise<PosCommitResult> {
  const { db, restaurantId, localOrderId, fingerprint, source, buildOrderData } = input;
  const nowMs = input.nowMs ?? Date.now();

  const claimRef = db.collection(POS_ORDER_CLAIMS).doc(claimDocId(restaurantId, localOrderId));
  const restaurantRef = db.collection("restaurants").doc(restaurantId);
  // Allocated outside the transaction so an SDK retry reuses the same ID rather
  // than burning a new one. Transaction writes are buffered until commit, so an
  // aborted attempt never leaves this document behind.
  const orderRef = db.collection("orders").doc();

  return db.runTransaction(async (tx) => {
    // All reads first — Firestore requires reads to precede writes.
    const claimSnap = await tx.get(claimRef);

    if (claimSnap.exists) {
      const claim = claimSnap.data() ?? {};
      const existingOrderId = String(claim.orderId ?? "");
      if (claim.fingerprint !== fingerprint) {
        return { outcome: "conflict", orderId: existingOrderId } as const;
      }

      // Verify the canonical order is really there before reporting a replay.
      // Read inside the transaction so the check cannot race a concurrent write.
      // Guard the empty id first: `.doc("")` is rejected by Firestore.
      if (!existingOrderId) {
        return { outcome: "missing_order", orderId: "" } as const;
      }
      const existingOrderSnap = await tx.get(db.collection("orders").doc(existingOrderId));
      if (!existingOrderSnap.exists) {
        return { outcome: "missing_order", orderId: existingOrderId } as const;
      }

      const existingNumber = claim.orderNumber;
      return {
        outcome: "replayed",
        orderId: existingOrderId,
        orderNumber: typeof existingNumber === "number" ? existingNumber : null,
      } as const;
    }

    const restaurantSnap = await tx.get(restaurantRef);
    if (!restaurantSnap.exists) {
      throw new Error("Restaurant not found");
    }

    const currentCounter = (restaurantSnap.data()?.orderCounter as number | undefined) ?? 99;
    const orderNumber = currentCounter + 1;

    // `create` throws if the claim appeared since the read above, which is the
    // hard guarantee that two concurrent requests cannot both create an order.
    tx.create(claimRef, {
      restaurantId,
      localOrderId,
      orderId: orderRef.id,
      orderNumber,
      fingerprint,
      source,
      createdAtMs: nowMs,
    });
    tx.update(restaurantRef, { orderCounter: orderNumber });
    tx.set(orderRef, buildOrderData(orderNumber));

    return { outcome: "created", orderId: orderRef.id, orderNumber } as const;
  });
}

/**
 * Legacy path for clients that predate idempotency keys.
 *
 * The POS is an installable PWA, so terminals in the field can still be running
 * a cached bundle that sends no `localOrderId`. Those requests keep exactly the
 * behaviour they have today — a new order plus an order number, with no claim
 * and no dedupe — so deploying this change cannot break a live terminal. Once
 * the terminal picks up the new bundle it gets the idempotent path.
 */
export async function createPosOrderUnkeyed(input: {
  db: FirestoreLike;
  restaurantId: string;
  buildOrderData: (orderNumber: number) => Record<string, unknown>;
}): Promise<{ outcome: "created"; orderId: string; orderNumber: number }> {
  const { db, restaurantId, buildOrderData } = input;
  const restaurantRef = db.collection("restaurants").doc(restaurantId);
  const orderRef = db.collection("orders").doc();

  return db.runTransaction(async (tx) => {
    const restaurantSnap = await tx.get(restaurantRef);
    if (!restaurantSnap.exists) {
      throw new Error("Restaurant not found");
    }
    const currentCounter = (restaurantSnap.data()?.orderCounter as number | undefined) ?? 99;
    const orderNumber = currentCounter + 1;

    tx.update(restaurantRef, { orderCounter: orderNumber });
    tx.set(orderRef, buildOrderData(orderNumber));

    return { outcome: "created", orderId: orderRef.id, orderNumber } as const;
  });
}

/**
 * Ensures a queued offline order carries a usable idempotency key.
 *
 * Records written before this fix already have a `localOrderId` (it is the
 * IndexedDB keyPath), so in practice this is a no-op that returns the existing
 * key unchanged — which is the important half of the contract: an old record
 * must keep the identity it already has and reuse it on every retry.
 *
 * If a record somehow has a blank key, one is minted ONCE and the caller writes
 * it back to IndexedDB before syncing, so later attempts reuse it rather than
 * generating a fresh id per attempt.
 */
export function normalizeQueuedOrderKey<T extends { localOrderId?: unknown }>(
  record: T,
  mintId: () => string
): { record: T & { localOrderId: string }; previousKey: unknown; changed: boolean } {
  const current = record.localOrderId;
  if (typeof current === "string" && current.trim()) {
    return {
      record: record as T & { localOrderId: string },
      previousKey: current,
      changed: false,
    };
  }
  return {
    record: { ...record, localOrderId: mintId() },
    previousKey: current,
    changed: true,
  };
}

// ── Offline hand-off classification ──────────────────────────────────────────

export type OfflineHandoff =
  /** A brand new order — safe to queue under the draft's transaction key. */
  | { kind: "new"; localOrderId: string }
  /**
   * Re-opening a bill that only ever existed in the offline queue. Queuing it
   * again overwrites that same queue record, because the key is unchanged.
   */
  | { kind: "offline-draft-update"; localOrderId: string }
  /**
   * An edit to an order that already exists on the server. This MUST NOT be
   * queued: the creation queue only knows how to create, so handing it a server
   * order id would make the sync route mint a second order — a new document, a
   * new order number, the customer's bill duplicated.
   */
  | { kind: "reject-server-edit"; orderId: string };

/**
 * Decides what the offline fallback may do with a submission that failed to
 * reach the server.
 *
 * `editingOrderId` is overloaded in the POS: for a queued offline bill it holds
 * that bill's localOrderId, but for a real order it holds the server document
 * id. Only membership in the offline queue distinguishes them, so that is what
 * this checks.
 */
export function classifyOfflineHandoff(input: {
  editingOrderId: string | null | undefined;
  queuedLocalOrderIds: readonly string[];
  draftTxnId: string;
}): OfflineHandoff {
  const { editingOrderId, queuedLocalOrderIds, draftTxnId } = input;
  if (!editingOrderId) {
    return { kind: "new", localOrderId: draftTxnId };
  }
  if (queuedLocalOrderIds.includes(editingOrderId)) {
    return { kind: "offline-draft-update", localOrderId: editingOrderId };
  }
  return { kind: "reject-server-edit", orderId: editingOrderId };
}

/**
 * Back-fills a claim for an order created before this fix shipped.
 *
 * Orders written by the previous sync route carry a `localOrderId` but have no
 * claim document. Without this, a queue record that was mid-flight across the
 * deploy would look brand new and duplicate. The sync route looks the order up
 * by `localOrderId` first and calls this so later retries take the atomic path.
 *
 * Uses `create`, so a claim written by a concurrent request is never clobbered.
 */
export async function backfillClaim(input: {
  db: FirestoreLike;
  restaurantId: string;
  localOrderId: string;
  orderId: string;
  orderNumber: number | null;
  fingerprint: string;
  nowMs?: number;
}): Promise<void> {
  const { db, restaurantId, localOrderId, orderId, orderNumber, fingerprint } = input;
  const claimRef = db.collection(POS_ORDER_CLAIMS).doc(claimDocId(restaurantId, localOrderId));
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(claimRef);
    if (snap.exists) return;
    tx.create(claimRef, {
      restaurantId,
      localOrderId,
      orderId,
      orderNumber,
      fingerprint,
      source: "backfill",
      createdAtMs: input.nowMs ?? Date.now(),
    });
  });
}
