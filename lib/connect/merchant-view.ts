import type { ConnectDelivery } from "./types";

/**
 * What the restaurant is allowed to see.
 *
 * ── Two things are deliberately absent ───────────────────────────────────────
 * The Dispatcher cost and RestoFlow's margin, because a partner shown "your
 * price is our cost plus our cut" is being invited to negotiate with the wrong
 * party; and the RECEIVING code, which is the customer's proof at the door. A
 * restaurant that can read it can hand it to a rider who never arrived.
 *
 * The PICKUP code is included — that one is the restaurant's, and it is how
 * staff check the rider in front of them is the right rider.
 */
export type MerchantStage =
  | "draft" | "awaiting_payment" | "paid" | "finding_courier" | "courier_assigned"
  | "at_restaurant" | "picked_up" | "on_the_way" | "delivered"
  | "unfulfilled" | "refund_pending" | "refunded" | "refund_failed" | "cancelled";

export type MerchantDelivery = {
  id: string;
  stage: MerchantStage;
  /** Plain words for an operator. Never Dispatcher's vocabulary. */
  stageLabel: string;
  customerName: string;
  customerPhone: string;
  destination: string;
  packageDescription: string;
  readyAt: string;
  payer: "customer" | "restaurant" | null;
  priceMinor: number | null;
  paid: boolean;
  quoteExpiresAtMs: number | null;
  distanceKm: number | null;
  etaToPickupMins: number | null;
  etaToDropoffMins: number | null;
  /** The restaurant's own code, shown once a rider is actually coming. */
  pickupCode: string | null;
  courierFirstName: string | null;
  trackingUrl: string | null;
  checkoutUrl: string | null;
  createdAtMs: number;
};

const DELIVERY_STAGE: Record<string, { stage: MerchantStage; label: string }> = {
  REQUESTED: { stage: "finding_courier", label: "Finding a courier" },
  SEARCHING_FOR_DRIVER: { stage: "finding_courier", label: "Finding a courier" },
  DRIVER_ASSIGNED: { stage: "courier_assigned", label: "Courier assigned" },
  DRIVER_TO_PICKUP: { stage: "courier_assigned", label: "Courier on the way to you" },
  ARRIVED_AT_PICKUP: { stage: "at_restaurant", label: "Courier at your restaurant" },
  WAITING_FOR_ORDER: { stage: "at_restaurant", label: "Courier waiting for the order" },
  PICKED_UP: { stage: "picked_up", label: "Picked up" },
  EN_ROUTE_TO_CUSTOMER: { stage: "on_the_way", label: "On the way to the customer" },
  ARRIVING: { stage: "on_the_way", label: "Arriving at the customer" },
  DELIVERED: { stage: "delivered", label: "Delivered" },
  DELIVERY_FAILED: { stage: "unfulfilled", label: "Delivery failed" },
  CANCELLED: { stage: "cancelled", label: "Cancelled" },
  REASSIGNING: { stage: "finding_courier", label: "Finding another courier" },
  DRIVER_CANCELLED: { stage: "finding_courier", label: "Finding another courier" },
};

const RECORD_STAGE: Record<string, { stage: MerchantStage; label: string }> = {
  draft: { stage: "draft", label: "Draft" },
  quoted: { stage: "draft", label: "Quoted" },
  awaiting_payment: { stage: "awaiting_payment", label: "Waiting for payment" },
  paid: { stage: "paid", label: "Paid" },
  payment_held_unfulfilled: { stage: "unfulfilled", label: "Couldn't be delivered" },
  refund_pending: { stage: "refund_pending", label: "Refund in progress" },
  refunded: { stage: "refunded", label: "Refunded" },
  refund_failed: { stage: "refund_failed", label: "Refund needs attention" },
  cancelled: { stage: "cancelled", label: "Cancelled" },
};

/** Stages at which the rider is genuinely coming, so the code is useful rather than early. */
const PICKUP_CODE_FROM: MerchantStage[] = ["courier_assigned", "at_restaurant", "picked_up", "on_the_way", "delivered"];

export function merchantView(d: ConnectDelivery, appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ""): MerchantDelivery {
  // Once Dispatcher owns the job its state is the truth; before that, ours is.
  const fromDelivery = d.delivery ? DELIVERY_STAGE[d.delivery.state] : null;
  const fromRecord = RECORD_STAGE[d.state] ?? { stage: "draft" as MerchantStage, label: "Draft" };
  const { stage, label } = fromDelivery && d.state === "requested" ? fromDelivery : fromRecord;

  return {
    id: d.id,
    stage,
    stageLabel: label,
    customerName: d.dropoff.name,
    customerPhone: d.dropoff.contactPhone,
    destination: d.dropoff.address,
    packageDescription: d.packageDescription,
    readyAt: d.readyAt,
    payer: d.payer,
    priceMinor: d.payment?.amountMinor ?? d.quote?.partnerPriceMinor ?? null,
    paid: !!d.payment?.paidAtMs,
    quoteExpiresAtMs: d.quote?.expiresAtMs ?? null,
    distanceKm: d.quote?.distanceKm ?? null,
    etaToPickupMins: d.quote?.etaToPickupMins ?? null,
    etaToDropoffMins: d.quote?.etaToDropoffMins ?? null,
    pickupCode: PICKUP_CODE_FROM.includes(stage) ? d.delivery?.pickupCode ?? null : null,
    courierFirstName: d.delivery?.driver?.firstName ?? null,
    trackingUrl: d.trackingToken && appUrl ? `${appUrl}/d/${d.id}?t=${d.trackingToken}` : null,
    checkoutUrl: d.payment?.paidAtMs ? null : d.payment?.authorizationUrl ?? null,
    createdAtMs: d.createdAtMs,
  };
}
