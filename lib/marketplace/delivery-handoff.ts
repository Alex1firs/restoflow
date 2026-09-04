import "server-only";
import type { Firestore } from "firebase-admin/firestore";
import { CONTRACT_VERSION, type CreateDeliveryRequest } from "@/lib/delivery/contract";
import { readDeliveryConfig } from "@/lib/delivery/config";
import { DispatcherClient } from "@/lib/delivery/dispatcher-client";
import { initialProjection, computeConfirmAt } from "@/lib/delivery/projection";

/**
 * The seam between "the customer has paid" and "a rider is coming".
 *
 * ── Why this is a separate step, not part of settlement ──────────────────────
 * `settlePayment` runs inside a transaction that must stay short and must not
 * fail on anything external. Calling another company's HTTPS API from inside it
 * would mean a Dispatcher timeout could roll back an order the customer has
 * already been charged for. So the order is created first and committed, and
 * the delivery is requested afterwards — the paid order is the durable record,
 * and the handoff is retried against it until it succeeds.
 *
 * ── Exactly one job per order, forever ───────────────────────────────────────
 * Three layers, and only the first is ours:
 *
 *   1. `order.delivery` is written only when a job is created, and a caller
 *      that finds it already set returns immediately. A replayed Paystack
 *      webhook therefore never reaches Dispatcher at all.
 *   2. `externalOrderId` is the marketplace order id — the idempotency anchor
 *      the contract is built on. If we do call twice, Dispatcher returns the
 *      SAME deliveryJobId rather than creating a second job.
 *   3. The write back is a compare-and-set on `delivery == null`, so two
 *      concurrent handoffs cannot both attach.
 *
 * That ordering matters: (1) makes the common case cheap, (2) makes the
 * uncommon case correct, and (3) makes the concurrent case safe.
 *
 * ── What Dispatcher is NOT told ──────────────────────────────────────────────
 * Only `deliveryFeeMinor` crosses. Not the food subtotal, not the restaurant
 * payable, not the platform margin, not the processor fee. Dispatcher computes
 * rider commission from the money field it receives, so sending a food total
 * would silently pay commission on the food. `findForbiddenKeys` in the client
 * refuses to transmit if any of them appear.
 */

export type HandoffResult =
  | { outcome: "created"; deliveryJobId: string }
  | { outcome: "already_attached"; deliveryJobId: string }
  | { outcome: "skipped"; reason: string }
  | { outcome: "failed"; reason: string; retryable: boolean };

export async function requestDeliveryForOrder(args: {
  db: Firestore;
  orderId: string;
  nowMs: number;
}): Promise<HandoffResult> {
  const { db, orderId, nowMs } = args;

  const cfg = readDeliveryConfig();
  if (!cfg.ok || !cfg.config.enabled) {
    // Refuse rather than guess. An order with no delivery is recoverable; a
    // delivery requested against a misconfigured endpoint is not.
    return { outcome: "skipped", reason: "delivery_integration_disabled" };
  }

  const ref = db.collection("orders").doc(orderId);
  const snap = await ref.get();
  if (!snap.exists) return { outcome: "skipped", reason: "order_not_found" };
  const order = snap.data()!;

  if (order.orderSource !== "marketplace") return { outcome: "skipped", reason: "not_a_marketplace_order" };
  if (order.payment?.state !== "paid") return { outcome: "skipped", reason: "not_paid" };
  if (order.delivery?.deliveryJobId) {
    return { outcome: "already_attached", deliveryJobId: String(order.delivery.deliveryJobId) };
  }

  const restaurantSnap = await db.collection("restaurants").doc(String(order.restaurantId)).get();
  const restaurant = restaurantSnap.data() ?? {};
  const pickupLat = Number(restaurant.latitude);
  const pickupLng = Number(restaurant.longitude);
  if (!Number.isFinite(pickupLat) || !Number.isFinite(pickupLng)) {
    return { outcome: "failed", reason: "restaurant_has_no_coordinates", retryable: false };
  }

  const drop = order.deliveryLocation ?? order.pricing?.dropoff ?? null;
  const dropLat = Number(drop?.lat);
  const dropLng = Number(drop?.lng);
  if (!Number.isFinite(dropLat) || !Number.isFinite(dropLng)) {
    return { outcome: "failed", reason: "order_has_no_dropoff_coordinates", retryable: false };
  }

  const prepMins = Number(order.fulfillment?.prepMins ?? 30);
  const correlationId = String(order.correlationId || `mp-${orderId}`);

  const req: CreateDeliveryRequest = {
    contractVersion: CONTRACT_VERSION,
    correlationId,
    // THE idempotency anchor. Same order id ⇒ same job, on every retry.
    externalOrderId: orderId,
    quoteId: order.pricing?.quoteId ?? null,
    serviceType: "FOOD_STANDARD",
    pickup: {
      name: String(restaurant.name ?? order.restaurantId),
      address: String(restaurant.address ?? ""),
      location: { lat: pickupLat, lng: pickupLng },
      contactPhone: String(restaurant.notificationPhone ?? restaurant.phone ?? ""),
    },
    dropoff: {
      // First name only — the contract is explicit that a surname never travels.
      name: String(order.customerName ?? "Customer").split(/\s+/)[0] || "Customer",
      address: String(order.address ?? ""),
      location: { lat: dropLat, lng: dropLng },
      contactPhone: String(order.phone ?? ""),
      instructions: String(order.deliveryInstructions ?? ""),
    },
    readyAt: new Date(nowMs + prepMins * 60_000).toISOString(),
    // The DELIVERY charge only. Read from the frozen snapshot, never recomputed.
    deliveryFeeMinor: Number(order.pricing?.deliveryFeeMinor ?? 0),
    paymentCollection: "NONE",
    // No item names: a rider does not need to know what is in the bag.
    packageDescription: "Food delivery",
  };

  const log = (event: string, fields: Record<string, unknown>) =>
    console.log(JSON.stringify({ scope: "marketplace_delivery_handoff", event, orderId, ...fields }));

  const client = new DispatcherClient({
    baseUrl: cfg.config.baseUrl, apiKey: cfg.config.apiKey,
    signingSecret: cfg.config.signingSecret, log,
  });

  const res = await client.createDelivery(req);
  if (!res.ok) {
    log("create_failed", { kind: res.failure.kind, retryable: res.failure.retryable });
    return { outcome: "failed", reason: res.failure.kind, retryable: res.failure.retryable };
  }

  const projection = initialProjection({
    correlationId,
    quoteId: req.quoteId,
    nowMs,
  });
  projection.deliveryJobId = res.value.deliveryJobId;
  projection.state = res.value.state;
  projection.lastEventAt = nowMs;

  // Compare-and-set: only the caller that finds `delivery` still unset attaches.
  const attached = await db.runTransaction(async (tx) => {
    const fresh = await tx.get(ref);
    const existing = fresh.data()?.delivery;
    if (existing?.deliveryJobId) return String(existing.deliveryJobId);
    tx.update(ref, {
      delivery: projection,
      // When to release the job to riders: back off from the food being ready
      // by the courier's travel time, so a rider is not idling at the counter.
      deliveryConfirmAt: computeConfirmAt({
        acceptedAtMs: nowMs,
        prepMins,
        etaToPickupMins: res.value.etaToPickupMins ?? null,
        nowMs,
      }),
      updatedAt: nowMs,
    });
    return null;
  });

  if (attached) {
    // Another handoff won the race. Dispatcher's idempotency means it is the
    // same job, so there is nothing to undo.
    log("already_attached_by_race", { deliveryJobId: attached });
    return { outcome: "already_attached", deliveryJobId: attached };
  }

  log("created", { deliveryJobId: res.value.deliveryJobId, state: res.value.state });
  return { outcome: "created", deliveryJobId: res.value.deliveryJobId };
}
