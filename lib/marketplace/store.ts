import "server-only";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import type { PaymentIntent, PaymentStore, ProviderVerification } from "./payment";
import { buildMarketplaceOrder, makeOrderCode, legacyStatusFor, type RestaurantState } from "./order";
import { entriesForPayment, type LedgerEntry } from "./ledger";
import { checkInvariants } from "./pricing";

/**
 * Firestore adapter for the marketplace commerce layer.
 *
 * ── What it may touch ────────────────────────────────────────────────────────
 * Creates marketplace orders in `orders`. Writes four new server-only
 * collections. It NEVER touches `prepared_items`, never increments
 * `restaurants.orderCounter`, never writes `pos_order_claims`, and never
 * modifies an order whose `orderSource` is not `marketplace`. A test scans this
 * file to prove it.
 *
 * ── The transaction that carries the whole guarantee ─────────────────────────
 * `materialiseOrder` creates the order, the ledger entries and the payment
 * record — and consumes the intent — in ONE Firestore transaction keyed on the
 * payment reference. A webhook, a browser callback and the reconciliation sweep
 * can all arrive for the same payment; exactly one order exists afterwards.
 */

export const INTENTS = "marketplace_payment_intents";
export const PAYMENTS = "marketplace_payments";
export const LEDGER = "marketplace_ledger_entries";
export const OUTBOX = "marketplace_notification_outbox";
export const ORDER_SOURCE_MARKETPLACE = "marketplace";

export class FirestoreMarketplaceStore implements PaymentStore {
  constructor(private readonly db: Firestore, private readonly random: () => number = Math.random) {}

  async putIntent(intent: PaymentIntent): Promise<void> {
    // The reference IS the document id, so the provider's own idempotency key
    // is ours too and a duplicate initialise cannot produce two intents.
    await this.db.collection(INTENTS).doc(intent.reference).set(intent);
  }

  async getIntent(reference: string): Promise<PaymentIntent | null> {
    const snap = await this.db.collection(INTENTS).doc(reference).get();
    return snap.exists ? (snap.data() as PaymentIntent) : null;
  }

  /** Checked before the intent — see the comment on the port. */
  async getOrderIdByReference(reference: string): Promise<string | null> {
    const snap = await this.db.collection(PAYMENTS).doc(reference).get();
    if (!snap.exists) return null;
    const orderId = snap.data()?.orderId;
    return typeof orderId === "string" && orderId ? orderId : null;
  }

  async materialiseOrder(args: {
    reference: string;
    intent: PaymentIntent;
    verification: ProviderVerification;
    nowMs: number;
  }): Promise<{ orderId: string; created: boolean }> {
    const { reference, intent, verification, nowMs } = args;

    // Refuse to write books that do not balance. Cheaper to fail here than to
    // find it in a settlement statement.
    const invariants = checkInvariants(intent.pricing);
    if (!invariants.ok) {
      throw new Error(`price snapshot fails its invariants: ${invariants.errors.join("; ")}`);
    }

    const paymentRef = this.db.collection(PAYMENTS).doc(reference);
    const intentRef = this.db.collection(INTENTS).doc(reference);
    const orderRef = this.db.collection("orders").doc();
    const orderCode = makeOrderCode(this.random);

    return this.db.runTransaction(async (tx) => {
      const existing = await tx.get(paymentRef);
      if (existing.exists) {
        const orderId = String(existing.data()?.orderId ?? "");
        // A payment record with no order behind it is an integrity fault. Never
        // paper over it by writing a replacement — that is how duplicates come
        // back.
        if (!orderId) throw new Error(`payment ${reference} exists with no order`);
        return { orderId, created: false };
      }

      const order = buildMarketplaceOrder({
        marketplaceOrderCode: orderCode,
        restaurantId: intent.restaurantId,
        restaurantName: intent.restaurantName || intent.restaurantId,
        customerId: intent.customerId,
        customerFirstName: intent.customerFirstName,
        customerPhone: intent.customerPhone,
        deliveryAddress: intent.deliveryAddress,
        deliveryLocation: intent.deliveryLocation ?? null,
        note: intent.note,
        items: intent.items,
        pricing: intent.pricing,
        paymentReference: reference,
        prepMins: intent.prepMins,
        correlationId: intent.correlationId,
        nowMs,
      });

      tx.set(orderRef, { ...order, createdAt: FieldValue.serverTimestamp(), createdAtMs: nowMs });

      // `create`, not `set`: if two transactions somehow reach here the second
      // fails with ALREADY_EXISTS rather than overwriting a payment record.
      tx.create(paymentRef, {
        reference, orderId: orderRef.id,
        restaurantId: intent.restaurantId, customerId: intent.customerId,
        amountChargedMinor: verification.amountMinor,
        providerFeeMinor: verification.feeMinor,
        provider: "paystack", state: "succeeded",
        verifiedAt: nowMs, correlationId: intent.correlationId,
      });

      for (const e of entriesForPayment({
        orderId: orderRef.id, restaurantId: intent.restaurantId,
        snapshot: intent.pricing, nowMs, createdBy: "payment-verify",
      })) {
        tx.create(this.db.collection(LEDGER).doc(e.entryId), e);
      }

      tx.delete(intentRef);
      return { orderId: orderRef.id, created: true };
    });
  }

  async recordFailure(reference: string, reason: string, nowMs: number): Promise<void> {
    await this.db.collection(PAYMENTS).doc(reference).set(
      { reference, state: "failed", reason, failedAt: nowMs },
      { merge: true }
    );
  }

  // ── Restaurant workflow ───────────────────────────────────────────────────

  /**
   * Move a marketplace order's restaurant state.
   *
   * Every guard is INSIDE the transaction, including the `orderSource` check:
   * a misrouted call must not be able to move a cashier's till transaction, and
   * the only place that can be guaranteed is in the write itself.
   */
  async transitionRestaurantState(args: {
    orderId: string;
    restaurantId: string;
    to: RestaurantState;
    by: string;
    reason?: string;
    nowMs: number;
    /** Pure decision function, injected so the rule lives in one place. */
    decide: (from: RestaurantState, to: RestaurantState) =>
      { ok: true; next: RestaurantState } | { ok: false; reason: string };
  }): Promise<{ ok: true; from: RestaurantState; to: RestaurantState } | { ok: false; reason: string }> {
    const ref = this.db.collection("orders").doc(args.orderId);

    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return { ok: false as const, reason: "order not found" };

      const d = snap.data() ?? {};
      if (d.orderSource !== ORDER_SOURCE_MARKETPLACE) {
        return { ok: false as const, reason: "not a marketplace order" };
      }
      // Tenant isolation, enforced in the write rather than trusted to the route.
      if (d.restaurantId !== args.restaurantId) {
        return { ok: false as const, reason: "order belongs to another restaurant" };
      }

      const from = (d.fulfillment?.restaurantState ?? "placed") as RestaurantState;
      const decision = args.decide(from, args.to);
      if (!decision.ok) return { ok: false as const, reason: decision.reason };

      const patch: Record<string, unknown> = {
        "fulfillment.restaurantState": decision.next,
        "fulfillment.history": FieldValue.arrayUnion({
          state: decision.next, at: args.nowMs, by: args.by,
          ...(args.reason ? { reason: args.reason } : {}),
        }),
        // Kept in step so every screen that predates marketplace renders it.
        status: legacyStatusFor(decision.next),
        updatedAt: args.nowMs,
      };

      if (decision.next === "accepted" && !d.fulfillment?.acceptedAt) {
        patch["fulfillment.acceptedAt"] = args.nowMs;
      }
      if (decision.next === "ready") patch["fulfillment.readyAt"] = args.nowMs;

      tx.update(ref, patch);
      return { ok: true as const, from, to: decision.next };
    });
  }

  /**
   * Remember that this order still owes Dispatcher a delivery request.
   *
   * Written when the restaurant accepts, cleared when the job attaches. It
   * exists because Firestore cannot query for an ABSENT field: without a
   * marker there is no way to ask "which accepted orders never got a courier",
   * and an acceptance that happened while Dispatcher was unreachable would
   * simply never be retried.
   */
  async markHandoffPending(orderId: string, nowMs: number): Promise<void> {
    await this.db.collection("orders").doc(orderId).update({ deliveryHandoffPending: nowMs });
  }

  async clearHandoffPending(orderId: string): Promise<void> {
    await this.db.collection("orders").doc(orderId).update({ deliveryHandoffPending: null });
  }

  /** Accepted orders still waiting on a delivery job, oldest first. */
  async findPendingHandoffs(olderThanMs: number, limit: number): Promise<string[]> {
    const snap = await this.db
      .collection("orders")
      .where("deliveryHandoffPending", "<=", olderThanMs)
      .orderBy("deliveryHandoffPending", "asc")
      .limit(limit)
      .get();
    return snap.docs.map((d) => d.id);
  }

  /** Schedules the moment the delivery job is released to riders. */
  async setDeliveryConfirmAt(orderId: string, confirmAt: number): Promise<void> {
    await this.db.collection("orders").doc(orderId).update({ deliveryConfirmAt: confirmAt });
  }

  async markAttention(orderId: string, reason: string, nowMs: number): Promise<void> {
    await this.db.collection("orders").doc(orderId).update({
      "delivery.reconcileState": "attention",
      attentionReason: reason,
      attentionAt: nowMs,
    });
  }

  // ── Notification outbox ───────────────────────────────────────────────────

  /**
   * Notifications are queued, not sent inline.
   *
   * A push provider being slow must never fail an order write, and a retried
   * webhook must not re-send a message the customer already has. The document
   * id is deterministic in (order, event), so a duplicate enqueue is a no-op.
   */
  async enqueueNotification(args: {
    orderId: string; audience: "customer" | "restaurant";
    event: string; payload: Record<string, unknown>; nowMs: number;
  }): Promise<boolean> {
    const id = `${args.orderId}__${args.audience}__${args.event}`;
    try {
      await this.db.collection(OUTBOX).doc(id).create({
        ...args, state: "queued", attempts: 0, createdAt: args.nowMs,
      });
      return true;
    } catch (err) {
      if (isAlreadyExists(err)) return false; // already queued or sent
      throw err;
    }
  }

  async ledgerFor(orderId: string): Promise<LedgerEntry[]> {
    const snap = await this.db.collection(LEDGER).where("orderId", "==", orderId).get();
    return snap.docs.map((d) => d.data() as LedgerEntry);
  }
}

function isAlreadyExists(err: unknown): boolean {
  const e = err as { code?: number | string };
  return e?.code === 6 || e?.code === "already-exists" ||
    /ALREADY_EXISTS/i.test(String((err as Error)?.message ?? ""));
}
