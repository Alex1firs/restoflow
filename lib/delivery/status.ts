/**
 * Three vocabularies, two translations.
 *
 *   Dispatcher status strings  →  canonical DeliveryState  →  what a customer reads
 *
 * Neither product adopts the other's words. Dispatcher stores free-form strings
 * shaped by a parcel-courier product (`pending`, `accepted`, `in_progress`);
 * RestoFlow has its own order lifecycle; the canonical states in contract.ts are
 * the only shared vocabulary, and this module is the only place the mapping
 * lives. One file to change when Dispatcher adds a status, one file to read when
 * a customer asks why their screen said something.
 *
 * Pure. No firebase, no fetch, no clock of its own.
 */

import {
  type DeliveryState,
  type FailureReason,
  type UnserviceableReason,
  isTerminal,
  stateRank,
} from "./contract";

// ── 1. Dispatcher → canonical ───────────────────────────────────────────────

/**
 * Dispatcher's own status vocabulary, read out of its source rather than
 * assumed: `functions/api_integration.js` writes `draft` and `pending`; the
 * Flutter app and `functions/index.js` move records through the rest.
 */
export type DispatcherStatus =
  | "draft"
  | "pending"
  | "accepted"
  | "assigned"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "declined"
  | "rescheduled"
  | "returned_to_sender";

export type DispatcherSnapshot = {
  status: string;
  /** Set once a rider has the food. The field that splits `in_progress` in two. */
  pickedUpAt?: string | number | null;
  /** Set when the rider reached the restaurant (proximity or manual). */
  arrivedAtPickupAt?: string | number | null;
  driverId?: string | null;
  /** Dispatcher's own re-broadcast marker: back to `pending` after a rider left. */
  reassigning?: boolean;
  failureReason?: string | null;
};

/**
 * Map a Dispatcher record to the canonical state.
 *
 * The single most important line here is the `in_progress` split. For a parcel
 * courier, "on the way to collect" and "on the way to deliver" are the same
 * state and the distinction is cosmetic. For food it is the difference between
 * a customer who is reassured and a customer who calls support, so we derive it
 * from `pickedUpAt` rather than asking Dispatcher to restate its whole model.
 *
 * Returns null for a status we do not recognise. The caller must treat that as
 * an integration fault to be logged and skipped — NOT as a default state, since
 * guessing here silently corrupts an order.
 */
export function toCanonicalState(snap: DispatcherSnapshot): DeliveryState | null {
  const s = (snap.status ?? "").trim().toLowerCase();

  switch (s) {
    case "draft":
      return "REQUESTED";

    case "pending":
      // Same stored status, two meanings: a job nobody has taken yet, and a job
      // whose rider walked away. Only `reassigning` can tell them apart, and the
      // customer-facing copy differs sharply between them.
      return snap.reassigning ? "REASSIGNING" : "SEARCHING_FOR_DRIVER";

    case "accepted":
    case "assigned":
      return "DRIVER_ASSIGNED";

    case "in_progress":
      if (snap.pickedUpAt) return "EN_ROUTE_TO_CUSTOMER";
      if (snap.arrivedAtPickupAt) return "ARRIVED_AT_PICKUP";
      return "DRIVER_TO_PICKUP";

    case "completed":
      return "DELIVERED";

    case "cancelled":
      return "CANCELLED";

    case "declined":
      // A rider declining is not the delivery failing — Dispatcher re-broadcasts.
      return "REASSIGNING";

    case "returned_to_sender":
      return "DELIVERY_FAILED";

    case "rescheduled":
      // Not modelled for food: a rescheduled meal is a failed delivery, and
      // pretending otherwise would leave an order open indefinitely.
      return "DELIVERY_FAILED";

    default:
      return null;
  }
}

// ── 2. Canonical → customer-facing ──────────────────────────────────────────

export type CustomerFacing = {
  /** Short line for the tracking screen. */
  headline: string;
  /** Optional second line. Null when the headline says enough. */
  detail: string | null;
  /** Whether to show the live map. */
  showMap: boolean;
  /** Whether to offer message / call actions. */
  showContact: boolean;
  /** Whether this warrants a push notification. */
  notify: boolean;
  /** Whether the customer should be routed to support. */
  needsSupport: boolean;
};

/**
 * The customer never sees an internal state name, an operational failure code,
 * or a reason that would make them feel responsible for something they cannot
 * fix. Two states are deliberately silent:
 *
 *   SEARCHING_FOR_DRIVER — during minute 3 of a 25-minute cook there is nothing
 *     wrong, and "looking for a courier" invents anxiety about a non-problem.
 *   CUSTOMER_UNREACHABLE / RESTAURANT_DELAY — annotations for operations, not
 *     status updates. The customer is being called; they do not need a banner.
 */
export function toCustomerFacing(
  state: DeliveryState,
  opts: { restaurantName?: string; driverFirstName?: string } = {}
): CustomerFacing {
  const who = opts.driverFirstName?.trim() || "Your courier";
  const place = opts.restaurantName?.trim() || "the restaurant";

  const base = { detail: null as string | null, showMap: false, showContact: false, notify: false, needsSupport: false };

  switch (state) {
    case "REQUESTED":
      // The job is reserved but riders cannot see it yet — it is released when
      // the food is close to ready. The kitchen is the story at this point.
      return { ...base, headline: "Preparing your order", detail: "We'll find you a rider shortly." };

    case "SEARCHING_FOR_DRIVER":
      // Out to riders and nobody has taken it. Saying "preparing" here answers
      // the wrong question when the kitchen is already done.
      return { ...base, headline: "Finding a rider", detail: "We're matching you with a rider nearby." };

    case "DRIVER_ASSIGNED":
      return { ...base, headline: "Courier assigned", detail: `${who} will collect your order.`, notify: true, showContact: true };

    case "DRIVER_TO_PICKUP":
      return { ...base, headline: `${who} is heading to the restaurant`, showMap: true, showContact: true };

    case "ARRIVED_AT_PICKUP":
      return { ...base, headline: `${who} is at the restaurant`, showMap: true, showContact: true };

    case "WAITING_FOR_ORDER":
      return { ...base, headline: `${who} is at the restaurant`, detail: "Waiting for your food to be ready.", showMap: true, showContact: true };

    case "PICKED_UP":
      return { ...base, headline: "Your food has been picked up", detail: `${who} is on the way.`, notify: true, showMap: true, showContact: true };

    case "EN_ROUTE_TO_CUSTOMER":
      return { ...base, headline: "Your order is on the way", showMap: true, showContact: true };

    case "ARRIVING":
      return { ...base, headline: `${who} is arriving soon`, detail: "Please be available to receive your order.", notify: true, showMap: true, showContact: true };

    case "DELIVERED":
      return { ...base, headline: "Delivered", detail: `Enjoy your food from ${place}.`, notify: true };

    case "REASSIGNING":
    case "DRIVER_CANCELLED":
      // Never "your rider cancelled" — that reads as a failure the customer must
      // act on, and there is nothing for them to do.
      return { ...base, headline: "Finding you another courier", detail: "This won't take long.", notify: false };

    case "CUSTOMER_UNREACHABLE":
      return { ...base, headline: "Your order is on the way", detail: "Your courier is trying to reach you.", showMap: true, showContact: true, notify: true };

    case "RESTAURANT_DELAY":
      return { ...base, headline: "Your food is taking a little longer", detail: "We're staying on it.", showMap: true, showContact: true };

    case "DELIVERY_FAILED":
      return { ...base, headline: "There was a problem with your delivery", detail: "Our team is looking into it.", notify: true, needsSupport: true };

    case "CANCELLED":
      return { ...base, headline: "Order cancelled", detail: "Any payment will be refunded.", notify: true, needsSupport: true };
  }
}

/**
 * Operational failure reasons never reach a customer verbatim. This is the only
 * sanctioned softening, and it is deliberately lossy — support has the real
 * reason on the order timeline.
 */
export function failureToCustomerDetail(reason: FailureReason): string {
  switch (reason) {
    case "CUSTOMER_UNREACHABLE":
    case "CUSTOMER_REFUSED":
    case "ADDRESS_NOT_FOUND":
      return "We couldn't complete your delivery. Our team will contact you.";
    default:
      return "There was a problem with your delivery. Our team is looking into it.";
  }
}

export function unserviceableToCustomerDetail(reason: UnserviceableReason): string {
  switch (reason) {
    case "OUT_OF_RANGE":
    case "NO_COVERAGE":
      return "This restaurant doesn't deliver to your address yet.";
    case "NO_RIDERS":
      return "No couriers are available right now. Please try again shortly.";
    case "OUTSIDE_HOURS":
      return "This restaurant isn't accepting delivery orders right now.";
    case "INVALID_ADDRESS":
      return "We couldn't locate that address. Please check it and try again.";
    case "PROVIDER_ERROR":
      return "We couldn't work out delivery for this order. Please try again shortly.";
  }
}

// ── 3. Canonical → RestoFlow order fulfilment ───────────────────────────────

/**
 * RestoFlow's marketplace order lifecycle. Separate from the POS `status` field
 * and from the delivery state; composed from BOTH the restaurant's progress and
 * the delivery's progress by `reduceOrderState` below.
 */
export type RestaurantProgress =
  | "placed"
  | "accepted"
  | "preparing"
  | "ready"
  | "rejected"
  | "cancelled";

export type MarketplaceOrderState =
  | "placed"
  | "accepted"
  | "preparing"
  | "ready"
  | "out_for_delivery"
  | "completed"
  | "cancelled"
  | "attention";

/**
 * The ONE place the two state machines meet.
 *
 * A delivery event never writes the order state directly — it updates the
 * projection, and this pure reducer derives the order state from both machines.
 * That is what stops a duplicated or out-of-order webhook from corrupting an
 * order rather than merely the projection it landed in.
 *
 * Precedence, in order:
 *   1. Restaurant rejection or cancellation wins outright — there is no order.
 *   2. A terminal delivery failure needs a human, so it becomes `attention`
 *      rather than silently completing or cancelling.
 *   3. Once the food is with a rider, delivery drives the state.
 *   4. Before pickup, the restaurant drives it.
 */
export function reduceOrderState(
  restaurant: RestaurantProgress,
  delivery: DeliveryState | null
): MarketplaceOrderState {
  if (restaurant === "rejected" || restaurant === "cancelled") return "cancelled";

  if (delivery === "CANCELLED") return "cancelled";
  if (delivery === "DELIVERY_FAILED") return "attention";
  if (delivery === "DELIVERED") return "completed";

  if (delivery && stateRank(delivery) >= stateRank("PICKED_UP")) {
    return "out_for_delivery";
  }

  switch (restaurant) {
    case "placed": return "placed";
    case "accepted": return "accepted";
    case "preparing": return "preparing";
    case "ready": return "ready";
  }
}

/**
 * Derived, not received: Dispatcher cannot know whether the food is ready, and
 * RestoFlow can. When a rider is standing at the counter and the kitchen has
 * not finished, the honest state is WAITING_FOR_ORDER — and it is the state
 * that makes a restaurant delay visible without blaming anyone in the app.
 */
export function deriveWaitingForOrder(
  delivery: DeliveryState,
  restaurant: RestaurantProgress
): DeliveryState {
  if (delivery === "ARRIVED_AT_PICKUP" && restaurant !== "ready") return "WAITING_FOR_ORDER";
  return delivery;
}

/**
 * Whether a customer may see live courier location for a delivery in this state.
 *
 * Two independent gates, both required: a rider must actually be assigned
 * (before that there is nothing to show), and the delivery must not be
 * terminal. The second is a privacy rule, not a UX one — location access ends
 * at completion and does not resume.
 */
export function trackingAllowed(state: DeliveryState): boolean {
  if (isTerminal(state)) return false;
  return stateRank(state) >= stateRank("DRIVER_ASSIGNED");
}
