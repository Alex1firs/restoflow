/**
 * The operations row and detail — pure mapping, no Firestore, no React.
 *
 * Everything an operator needs to answer "where is this order?" in one place:
 * payment, restaurant, preparation, delivery, courier, ETA, issue, settlement.
 * It is built from the order document alone, so the board renders without
 * calling Dispatcher on every page load.
 *
 * Kept separate from the route so the shaping — including what is deliberately
 * NOT shown — is unit-testable.
 */

import type { DeliveryState } from "../delivery/contract";
import { toCustomerFacing } from "../delivery/status";
import type { OrderFinancials } from "./ledger";

export type OpsRow = {
  orderId: string;
  orderCode: string;
  restaurantId: string;
  /** First name only. An operations list is not a reason to render full PII. */
  customerFirstName: string;
  totalChargedMinor: number;
  restaurantPayableMinor: number;
  platformGrossMinor: number;
  paymentState: string;
  restaurantState: string;
  deliveryState: DeliveryState | null;
  deliveryJobId: string | null;
  courierFirstName: string | null;
  etaToDropoffMins: number | null;
  issue: string | null;
  needsAttention: boolean;
  settlementState: string;
  createdAtMs: number;
  /** Minutes since the order was placed — the number an operator scans for. */
  ageMins: number;
};

export type OpsAction =
  | "view_delivery"
  | "retry_delivery_creation"
  | "request_courier_now"
  | "reassign_courier"
  | "cancel_delivery"
  | "open_in_dispatcher"
  | "flag_for_refund";

export function toOpsRow(orderId: string, d: Record<string, unknown>, nowMs: number): OpsRow {
  const pricing = (d.pricing ?? {}) as Record<string, number>;
  const fulfilment = (d.fulfillment ?? {}) as Record<string, unknown>;
  const payment = (d.payment ?? {}) as Record<string, unknown>;
  const delivery = (d.delivery ?? null) as Record<string, unknown> | null;
  const settlement = (d.settlement ?? {}) as Record<string, unknown>;
  const issue = (delivery?.issue ?? null) as { kind?: string; reason?: string } | null;
  const createdAtMs = typeof d.createdAtMs === "number" ? d.createdAtMs : 0;

  return {
    orderId,
    orderCode: String(d.marketplaceOrderCode ?? ""),
    restaurantId: String(d.restaurantId ?? ""),
    customerFirstName: String(d.customerName ?? ""),
    totalChargedMinor: Number(pricing.totalChargedMinor ?? 0),
    restaurantPayableMinor: Number(pricing.restaurantPayableMinor ?? 0),
    platformGrossMinor: Number(pricing.platformGrossMinor ?? 0),
    paymentState: String(payment.state ?? "unknown"),
    restaurantState: String(fulfilment.restaurantState ?? "placed"),
    deliveryState: (delivery?.state ?? null) as DeliveryState | null,
    deliveryJobId: (delivery?.deliveryJobId ?? null) as string | null,
    courierFirstName: ((delivery?.driver ?? null) as { firstName?: string } | null)?.firstName ?? null,
    etaToDropoffMins: typeof delivery?.etaToDropoffMins === "number" ? delivery.etaToDropoffMins : null,
    issue: issue ? `${issue.kind}: ${issue.reason}` : null,
    // The two states that mean a person must look: an escalated delivery, or a
    // paid order that never got a delivery job at all.
    needsAttention:
      delivery?.reconcileState === "attention" ||
      (payment.state === "paid" && !delivery && createdAtMs > 0 && nowMs - createdAtMs > 10 * 60_000),
    settlementState: String(settlement.state ?? "unsettled"),
    createdAtMs,
    ageMins: createdAtMs ? Math.floor((nowMs - createdAtMs) / 60_000) : 0,
  };
}

export type TimelineEntry = {
  at: number;
  lane: "payment" | "restaurant" | "preparation" | "dispatcher" | "delivery";
  label: string;
  detail: string | null;
};

/**
 * The combined timeline: one ordered story across five lanes.
 *
 * Support's actual question is "where is this order?", and answering it should
 * never require opening two systems. Delivery events are labelled with the
 * CUSTOMER-facing wording so an operator reads what the customer read.
 */
export function buildTimeline(d: Record<string, unknown>, deliveryEvents: Array<Record<string, unknown>>): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  const payment = (d.payment ?? {}) as Record<string, unknown>;
  const fulfilment = (d.fulfillment ?? {}) as Record<string, unknown>;

  if (typeof payment.verifiedAt === "number") {
    out.push({ at: payment.verifiedAt, lane: "payment", label: "Payment verified",
      detail: String(payment.reference ?? "") });
  }

  for (const h of (fulfilment.history ?? []) as Array<Record<string, unknown>>) {
    const state = String(h.state ?? "");
    out.push({
      at: Number(h.at ?? 0),
      lane: state === "preparing" || state === "ready" ? "preparation" : "restaurant",
      label: restaurantLabel(state),
      detail: h.reason ? String(h.reason) : null,
    });
  }

  for (const e of deliveryEvents) {
    const state = String(e.state ?? "");
    const copy = state ? toCustomerFacing(state as DeliveryState) : null;
    out.push({
      at: Number(e.at ?? 0),
      lane: e.source === "reconciler" ? "dispatcher" : "delivery",
      label: copy ? copy.headline : String(e.event ?? "delivery event"),
      detail: e.detail ? String(e.detail) : null,
    });
  }

  return out.sort((a, b) => a.at - b.at);
}

function restaurantLabel(state: string): string {
  switch (state) {
    case "placed": return "Order placed";
    case "accepted": return "Restaurant accepted";
    case "preparing": return "Preparing";
    case "ready": return "Ready for pickup";
    case "rejected": return "Restaurant rejected";
    case "cancelled": return "Cancelled";
    default: return state;
  }
}

/**
 * Which actions an operator may take, given the state.
 *
 * Deliberately narrow. Every one of these goes through the Dispatcher API —
 * RestoFlow never writes to Dispatcher's database, so an operator cannot put
 * the two systems into a state neither believes in.
 */
export function availableActions(row: OpsRow): OpsAction[] {
  const actions: OpsAction[] = [];
  const terminal = row.deliveryState === "DELIVERED" || row.deliveryState === "CANCELLED" ||
                   row.deliveryState === "DELIVERY_FAILED";

  if (row.deliveryJobId) actions.push("view_delivery", "open_in_dispatcher");

  // Paid, accepted, and no job: the retry that rescues an order whose delivery
  // creation failed.
  if (row.paymentState === "paid" && !row.deliveryJobId && row.restaurantState !== "rejected") {
    actions.push("retry_delivery_creation");
  }
  if (row.deliveryState === "REQUESTED") actions.push("request_courier_now");
  if (row.deliveryState === "SEARCHING_FOR_DRIVER" || row.deliveryState === "REASSIGNING") {
    actions.push("reassign_courier");
  }
  if (row.deliveryJobId && !terminal) actions.push("cancel_delivery");
  if (row.paymentState === "paid") actions.push("flag_for_refund");

  return actions;
}

/** The commercial summary shown on the detail page. */
export type OpsFinancials = OrderFinancials & { currency: "NGN" };
