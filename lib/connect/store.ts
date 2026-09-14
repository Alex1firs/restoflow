import "server-only";
import type { Firestore } from "firebase-admin/firestore";
import type { ConnectDelivery, ConnectRefund } from "./types";
import type { ConnectLedgerEntry } from "./ledger";

/**
 * Persistence for Connect.
 *
 * ── Isolation is structural, not a filter somebody remembers ─────────────────
 * Every read takes the restaurantId of the caller and checks it against the
 * record. A Connect partner asking for a delivery id that belongs to somebody
 * else gets `null` — the same answer as an id that does not exist, so the API
 * cannot be used to discover which ids are real.
 *
 * ── Handover codes never live on the delivery ────────────────────────────────
 * `connect_handover` is a separate, deny-all collection, exactly as
 * `order_handover` is for the marketplace. The receiving code is the customer's
 * proof; the partner has no business reading it, and a record the partner can
 * read is a record the partner can read entirely.
 */

const DELIVERIES = "connect_deliveries";
const HANDOVER = "connect_handover";
const LEDGER = "connect_ledger_entries";
const REFS = "connect_payment_refs";

export class ConnectStore {
  constructor(private db: Firestore) {}

  async create(delivery: ConnectDelivery): Promise<void> {
    // `create` rather than `set`: a deterministic id that already exists is a
    // replay, and must collide rather than overwrite.
    await this.db.collection(DELIVERIES).doc(delivery.id).create(delivery as Record<string, unknown>);
  }

  /** Scoped read. A mismatched restaurantId is indistinguishable from not found. */
  async get(restaurantId: string, id: string): Promise<ConnectDelivery | null> {
    const snap = await this.db.collection(DELIVERIES).doc(id).get();
    if (!snap.exists) return null;
    const d = snap.data() as ConnectDelivery;
    if (d.restaurantId !== restaurantId) return null;
    return d;
  }

  /** Unscoped read for server-side paths that have already authorised (webhooks). */
  async getInternal(id: string): Promise<ConnectDelivery | null> {
    const snap = await this.db.collection(DELIVERIES).doc(id).get();
    return snap.exists ? (snap.data() as ConnectDelivery) : null;
  }

  async list(restaurantId: string, limit = 50): Promise<ConnectDelivery[]> {
    const snap = await this.db
      .collection(DELIVERIES)
      .where("restaurantId", "==", restaurantId)
      .orderBy("createdAtMs", "desc")
      .limit(limit)
      .get();
    return snap.docs.map((d) => d.data() as ConnectDelivery);
  }

  async update(id: string, patch: Partial<ConnectDelivery>): Promise<void> {
    await this.db.collection(DELIVERIES).doc(id).update({ ...patch, updatedAtMs: Date.now() });
  }

  /**
   * Attach the Dispatcher job, once and only once.
   *
   * Compare-and-set on `delivery == null`, the same guard the marketplace
   * handoff uses: two concurrent requests for one delivery must produce one
   * job, and the loser must find the winner's rather than create a second.
   */
  async attachDelivery(id: string, patch: Partial<ConnectDelivery>): Promise<boolean> {
    const ref = this.db.collection(DELIVERIES).doc(id);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return false;
      const current = snap.data() as ConnectDelivery;
      if (current.delivery) return false;
      tx.update(ref, { ...patch, updatedAtMs: Date.now() });
      return true;
    });
  }

  /**
   * Payment reference → Connect delivery.
   *
   * Its own document rather than a query, because the webhook arrives with
   * nothing but a reference and must resolve it in one read, deterministically.
   */
  async mapReference(reference: string, deliveryId: string): Promise<void> {
    await this.db.collection(REFS).doc(reference).set({ reference, deliveryId, createdAtMs: Date.now() });
  }

  async deliveryIdForReference(reference: string): Promise<string | null> {
    const snap = await this.db.collection(REFS).doc(reference).get();
    return snap.exists ? String(snap.data()?.deliveryId ?? "") || null : null;
  }

  /**
   * Claim the payment, once.
   *
   * Compare-and-set on `payment.paidAtMs == null`. Two webhook deliveries of the
   * same charge — which Paystack does send — must produce one dispatch and one
   * set of ledger rows.
   */
  async markPaid(id: string, nowMs: number): Promise<boolean> {
    const ref = this.db.collection(DELIVERIES).doc(id);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return false;
      const d = snap.data() as ConnectDelivery;
      if (!d.payment || d.payment.paidAtMs) return false;
      tx.update(ref, { state: "paid", "payment.paidAtMs": nowMs, updatedAtMs: nowMs });
      return true;
    });
  }

  /** Claim the single refund obligation. A second caller gets false, never a second refund. */
  async claimRefund(id: string, refund: ConnectRefund): Promise<boolean> {
    const ref = this.db.collection(DELIVERIES).doc(id);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return false;
      const d = snap.data() as ConnectDelivery;
      if (d.refund) return false;
      tx.update(ref, { refund, state: "refund_pending", updatedAtMs: Date.now() });
      return true;
    });
  }

  /** Server-only. The partner sees the pickup code; nobody reads the receiving code but us. */
  async writeHandover(id: string, codes: { pickupCode: string | null; receivingCode: string | null }): Promise<void> {
    await this.db.collection(HANDOVER).doc(id).set({
      deliveryId: id,
      ...codes,
      createdAtMs: Date.now(),
    });
  }

  /** Deterministic ids mean a replay writes the same rows rather than doubling the books. */
  async writeLedger(entries: ConnectLedgerEntry[]): Promise<void> {
    const batch = this.db.batch();
    for (const e of entries) {
      batch.set(this.db.collection(LEDGER).doc(e.id), e as Record<string, unknown>);
    }
    await batch.commit();
  }

  async ledgerFor(deliveryId: string): Promise<ConnectLedgerEntry[]> {
    const snap = await this.db.collection(LEDGER).where("deliveryId", "==", deliveryId).get();
    return snap.docs.map((d) => d.data() as ConnectLedgerEntry);
  }
}
