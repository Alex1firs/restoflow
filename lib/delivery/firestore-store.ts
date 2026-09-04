import "server-only";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import type { DeliveryStore, DeliveryOrderView, TimelineEntry } from "./store";
import type { DeliveryProjection } from "./projection";
import type { RestaurantProgress } from "./status";
import { isDeliveryState } from "./contract";

/**
 * Firestore adapter for the delivery integration.
 *
 * ── What it may touch ────────────────────────────────────────────────────────
 * Reads `orders`. Writes ONLY the additive `delivery` map on a marketplace
 * order, plus two new server-only collections. It never touches `items`,
 * `total`, `paymentStatus`, `orderNumber`, `localOrderId`, `prepared_items`,
 * `restaurants.orderCounter` or `pos_order_claims` — asserted by a test, not
 * merely intended.
 *
 * ── Why the guards are in the transaction ────────────────────────────────────
 * Every write re-reads inside the transaction and refuses if the order is not a
 * marketplace order. A misrouted webhook must not be able to bolt a delivery
 * projection onto a cashier's till transaction, and the only place that can be
 * guaranteed is inside the write itself.
 */

export const EVENT_CLAIMS = "marketplace_delivery_events";
export const TIMELINE = "marketplace_delivery_timeline";
export const ORDER_SOURCE_MARKETPLACE = "marketplace";

export class FirestoreDeliveryStore implements DeliveryStore {
  constructor(private readonly db: Firestore) {}

  async getOrder(orderId: string): Promise<DeliveryOrderView | null> {
    const snap = await this.db.collection("orders").doc(orderId).get();
    if (!snap.exists) return null;
    const d = snap.data() ?? {};
    if (d.orderSource !== ORDER_SOURCE_MARKETPLACE) return null; // never a POS order
    return toView(snap.id, d);
  }

  async claimEvent(
    eventId: string,
    meta: { orderId: string; deliveryJobId: string; sequence: number; nowMs: number }
  ): Promise<boolean> {
    const ref = this.db.collection(EVENT_CLAIMS).doc(eventId);
    try {
      // `create` fails with ALREADY_EXISTS rather than overwriting, which makes
      // this a genuine atomic claim rather than a read-then-write race.
      await ref.create({
        eventId,
        orderId: meta.orderId,
        deliveryJobId: meta.deliveryJobId,
        sequence: meta.sequence,
        claimedAt: meta.nowMs,
        // Lets an operator expire old claims without reasoning about the schema.
        expiresAt: new Date(meta.nowMs + 30 * 86_400_000),
      });
      return true;
    } catch (err: unknown) {
      if (isAlreadyExists(err)) return false;
      throw err;
    }
  }

  async writeProjection(orderId: string, expectedSequence: number, next: DeliveryProjection): Promise<boolean> {
    const ref = this.db.collection("orders").doc(orderId);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return false;
      const d = snap.data() ?? {};
      if (d.orderSource !== ORDER_SOURCE_MARKETPLACE) return false;

      const stored = (d.delivery ?? null) as DeliveryProjection | null;
      const storedSeq = stored?.sequence ?? 0;
      if (storedSeq !== expectedSequence) return false; // someone else moved it

      // A field-path update, NOT a document set: only `delivery` is written, so
      // no other field on a live order can be disturbed by this subsystem.
      tx.update(ref, { delivery: next, deliveryUpdatedAt: FieldValue.serverTimestamp() });
      return true;
    });
  }

  async appendTimeline(orderId: string, entry: TimelineEntry): Promise<void> {
    await this.db.collection(TIMELINE).doc().create({ orderId, ...entry });
  }

  async findStaleDeliveries(olderThanMs: number, limit: number): Promise<DeliveryOrderView[]> {
    const snap = await this.db
      .collection("orders")
      .where("orderSource", "==", ORDER_SOURCE_MARKETPLACE)
      .where("delivery.lastEventAt", "<", olderThanMs)
      .limit(limit)
      .get();
    return snap.docs
      .map((doc) => toView(doc.id, doc.data() ?? {}))
      .filter((v): v is DeliveryOrderView => v !== null && v.delivery !== null);
  }

  async findDueForConfirm(nowMs: number, limit: number): Promise<Array<DeliveryOrderView & { confirmAt: number }>> {
    const snap = await this.db
      .collection("orders")
      .where("orderSource", "==", ORDER_SOURCE_MARKETPLACE)
      .where("delivery.state", "==", "REQUESTED")
      .where("deliveryConfirmAt", "<=", nowMs)
      .limit(limit)
      .get();
    return snap.docs
      .map((doc) => {
        const view = toView(doc.id, doc.data() ?? {});
        if (!view || !view.delivery) return null;
        return { ...view, confirmAt: Number((doc.data() ?? {}).deliveryConfirmAt ?? 0) };
      })
      .filter((v): v is DeliveryOrderView & { confirmAt: number } => v !== null);
  }
}

/**
 * Map a raw order document to the narrow view this subsystem sees.
 *
 * Everything is defensively coerced: these documents predate the integration,
 * are written by three different routes, and a marketplace order that is
 * missing a field must degrade rather than throw inside a webhook handler.
 */
function toView(orderId: string, d: Record<string, unknown>): DeliveryOrderView | null {
  const restaurantId = typeof d.restaurantId === "string" ? d.restaurantId : "";
  if (!restaurantId) return null;

  const raw = (d.delivery ?? null) as Record<string, unknown> | null;
  let delivery: DeliveryProjection | null = null;

  if (raw && isDeliveryState(raw.state)) {
    delivery = {
      provider: "dispatcher",
      deliveryJobId: typeof raw.deliveryJobId === "string" ? raw.deliveryJobId : null,
      quoteId: typeof raw.quoteId === "string" ? raw.quoteId : null,
      state: raw.state,
      sequence: typeof raw.sequence === "number" ? raw.sequence : 0,
      driver: (raw.driver ?? null) as DeliveryProjection["driver"],
      etaToPickupMins: numOrNull(raw.etaToPickupMins),
      etaToDropoffMins: numOrNull(raw.etaToDropoffMins),
      requestedAt: numOrNull(raw.requestedAt),
      assignedAt: numOrNull(raw.assignedAt),
      pickedUpAt: numOrNull(raw.pickedUpAt),
      deliveredAt: numOrNull(raw.deliveredAt),
      lastEventAt: typeof raw.lastEventAt === "number" ? raw.lastEventAt : 0,
      issue: (raw.issue ?? null) as DeliveryProjection["issue"],
      correlationId: typeof raw.correlationId === "string" ? raw.correlationId : "",
      reconcileState: (raw.reconcileState === "stale" || raw.reconcileState === "attention") ? raw.reconcileState : "ok",
    };
  }

  return {
    orderId,
    restaurantId,
    customerId: typeof d.customerId === "string" ? d.customerId : "",
    restaurantProgress: toProgress(d),
    delivery,
  };
}

/**
 * Derive the kitchen's progress from the order's existing `status` field, so
 * marketplace orders keep using the vocabulary every restaurant screen already
 * renders rather than acquiring a parallel one.
 */
function toProgress(d: Record<string, unknown>): RestaurantProgress {
  const fulfilment = (d.fulfillment ?? {}) as Record<string, unknown>;
  // `restaurantState` is where the marketplace state machine writes. Reading
  // only `state` meant every marketplace order fell through to the legacy
  // `status` field — which maps `accepted` to "pending" — so tracking could
  // never report that the restaurant had accepted, no matter what it had done.
  const s = String(fulfilment.restaurantState ?? fulfilment.state ?? d.status ?? "pending");
  switch (s) {
    case "accepted": return "accepted";
    case "preparing": return "preparing";
    case "ready": return "ready";
    case "rejected": return "rejected";
    case "cancelled": return "cancelled";
    default: return "placed";
  }
}

const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function isAlreadyExists(err: unknown): boolean {
  const e = err as { code?: number | string };
  return e?.code === 6 || e?.code === "already-exists" || /ALREADY_EXISTS/i.test(String((err as Error)?.message ?? ""));
}
