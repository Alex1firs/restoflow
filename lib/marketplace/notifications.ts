/**
 * Who tells whom, and — just as importantly — who stays quiet.
 *
 * ── The rule ─────────────────────────────────────────────────────────────────
 * Whoever owns the audience owns the notification.
 *
 *   customer    → RestoFlow   (push, SMS fallback)
 *   restaurant  → RestoFlow   (existing Termii SMS + Telegram)
 *   rider       → Dispatcher  (existing FCM, prefs and channels)
 *
 * ── The duplicate this prevents ──────────────────────────────────────────────
 * Dispatcher's `sendDeliveryStatusAlerts` and `notifyClientOnPickupArrival`
 * notify "the client" on status changes. For a marketplace delivery the client
 * is a COMPANY, not a person — and the customer already hears from RestoFlow.
 * Left untouched, those functions either message nobody useful or, once a
 * contact reaches them, message the customer a second time in different words.
 * `dispatcherMustStaySilent` is the predicate that closes it.
 *
 * Pure. Produces messages; the caller sends them.
 */

import type { DeliveryState } from "../delivery/contract";
import { toCustomerFacing } from "../delivery/status";
import type { RestaurantState } from "./order";

export type Audience = "customer" | "restaurant" | "rider";
export type Owner = "restoflow" | "dispatcher";

/**
 * The ownership table, stated once so it can be asserted rather than assumed.
 */
export const NOTIFICATION_OWNER: Record<Audience, Owner> = {
  customer: "restoflow",
  restaurant: "restoflow",
  rider: "dispatcher",
};

/**
 * Whether Dispatcher must suppress its own client-facing notification.
 *
 * True for every marketplace job. Dispatcher keeps every rider notification it
 * already sends — those are its audience and its job.
 */
export function dispatcherMustStaySilent(delivery: { partner?: string | null; isExternal?: boolean }): boolean {
  return delivery.partner === "restoflow_marketplace";
}

export type CustomerEvent =
  | "payment_successful"
  | "restaurant_accepted"
  | "preparing"
  | "courier_assigned"
  | "courier_to_restaurant"
  | "courier_at_restaurant"
  | "picked_up"
  | "on_the_way"
  | "arriving"
  | "delivered"
  | "delivery_issue"
  | "order_rejected"
  | "refund_issued";

export type PushMessage = {
  event: CustomerEvent;
  title: string;
  body: string;
  /** Deep-link payload. No PII — a push notification is stored by the OS. */
  data: { orderId: string; orderCode: string; type: CustomerEvent };
  /** Whether it should make a sound. Reserved for things worth interrupting for. */
  urgent: boolean;
};

/**
 * Build the customer message for an event.
 *
 * Delivery copy is delegated to the delivery status module, so the customer
 * reads exactly the same words on the tracking screen and in the notification.
 * Two sources of wording is how "Courier assigned" and "A driver has been
 * allocated" end up on the same order.
 */
export function customerMessage(args: {
  event: CustomerEvent;
  orderId: string;
  orderCode: string;
  restaurantName: string;
  driverFirstName?: string;
  deliveryState?: DeliveryState;
}): PushMessage {
  const { event, orderId, orderCode, restaurantName } = args;
  const data = { orderId, orderCode, type: event };
  const m = (title: string, body: string, urgent = false): PushMessage =>
    ({ event, title, body, data, urgent });

  switch (event) {
    case "payment_successful":
      return m("Payment confirmed", `Your order from ${restaurantName} is on its way to the kitchen.`);
    case "restaurant_accepted":
      return m("Order accepted", `${restaurantName} is getting your order ready.`);
    case "preparing":
      return m("Preparing your food", `${restaurantName} has started cooking.`);
    case "order_rejected":
      return m("Order couldn't be accepted", `${restaurantName} can't take your order right now. You'll be refunded in full.`, true);
    case "refund_issued":
      return m("Refund on its way", "We've issued your refund. It can take a few days to appear.");
    case "delivery_issue":
      return m("There's a problem with your delivery", "Our team is looking into it and will be in touch.", true);
    default: {
      // Every delivery-driven event reuses the tracking screen's own wording.
      const state = args.deliveryState ?? deliveryStateFor(event);
      const copy = toCustomerFacing(state, { restaurantName, driverFirstName: args.driverFirstName });
      return m(copy.headline, copy.detail ?? `Order ${orderCode}`, copy.notify);
    }
  }
}

function deliveryStateFor(event: CustomerEvent): DeliveryState {
  switch (event) {
    case "courier_assigned": return "DRIVER_ASSIGNED";
    case "courier_to_restaurant": return "DRIVER_TO_PICKUP";
    case "courier_at_restaurant": return "ARRIVED_AT_PICKUP";
    case "picked_up": return "PICKED_UP";
    case "on_the_way": return "EN_ROUTE_TO_CUSTOMER";
    case "arriving": return "ARRIVING";
    case "delivered": return "DELIVERED";
    default: return "REQUESTED";
  }
}

/**
 * Which delivery states are worth waking a phone for.
 *
 * Deliberately short. A notification for every internal transition trains a
 * customer to swipe them all away, including the one that mattered.
 */
export const CUSTOMER_PUSH_STATES: readonly DeliveryState[] = [
  "DRIVER_ASSIGNED", "PICKED_UP", "ARRIVING", "DELIVERED", "DELIVERY_FAILED", "CANCELLED",
] as const;

export function shouldPushForDelivery(state: DeliveryState): boolean {
  return CUSTOMER_PUSH_STATES.includes(state);
}

// ── Restaurant ──────────────────────────────────────────────────────────────

export type RestaurantEvent =
  | "new_marketplace_order"
  | "courier_assigned"
  | "courier_arriving"
  | "courier_at_restaurant"
  | "order_cancelled";

export type RestaurantMessage = { event: RestaurantEvent; text: string; urgent: boolean };

/**
 * Restaurant alerts go through the channels already wired — Termii SMS and
 * Telegram — so no new infrastructure and no new opt-in.
 *
 * The last three exist so a kitchen can time the bagging: hot food sitting on
 * a pass because nobody knew the courier had arrived is the most common
 * avoidable failure in this product.
 */
export function restaurantMessage(args: {
  event: RestaurantEvent;
  orderCode: string;
  itemsSummary: string;
  restaurantSubtotalMinor: number;
  driverFirstName?: string;
}): RestaurantMessage {
  const naira = `₦${(args.restaurantSubtotalMinor / 100).toLocaleString("en-NG")}`;
  const who = args.driverFirstName || "A courier";

  switch (args.event) {
    case "new_marketplace_order":
      // The restaurant's OWN subtotal, never the customer's total. Showing the
      // marked-up figure would misrepresent what they earn.
      return { event: args.event, urgent: true,
        text: `NEW ONLINE ORDER ${args.orderCode} — RestoFlow Marketplace. PAID. Delivery.\n${args.itemsSummary}\nYou earn: ${naira}\nAccept or reject in your dashboard.` };
    case "courier_assigned":
      return { event: args.event, urgent: false, text: `${args.orderCode}: ${who} is coming to collect.` };
    case "courier_arriving":
      return { event: args.event, urgent: false, text: `${args.orderCode}: ${who} is arriving — please have it bagged.` };
    case "courier_at_restaurant":
      return { event: args.event, urgent: true, text: `${args.orderCode}: ${who} is at your counter.` };
    case "order_cancelled":
      return { event: args.event, urgent: true, text: `${args.orderCode} has been cancelled. Please stop preparing it.` };
  }
}

/** Restaurant-state changes that warrant telling the customer. */
export function customerEventForRestaurantState(state: RestaurantState): CustomerEvent | null {
  switch (state) {
    case "accepted": return "restaurant_accepted";
    case "preparing": return "preparing";
    case "rejected": return "order_rejected";
    default: return null; // `placed` and `ready` are covered by other events
  }
}
