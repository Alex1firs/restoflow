import type { DeliveryState } from "@/lib/delivery/contract";
import { toCustomerFacing } from "@/lib/delivery/status";
import type { RestaurantState } from "./order";

/**
 * What a customer is allowed to see of their own order.
 *
 * Deliberately NOT `server-only`: this module holds no secret, reaches no
 * database and imports nothing from `next`. Keeping it pure is what lets the
 * allowlist below be asserted directly by a test.
 *
 * An allowlist, built field by field. A DTO assembled by spreading the stored
 * document would ship the price snapshot's `restaurantPayableMinor` and
 * `platformGrossMinor` to a phone the first time somebody added a field.
 */

export type CustomerOrderStage =
  | "confirmed" | "restaurant_accepted" | "preparing" | "finding_rider"
  | "courier_assigned" | "courier_to_restaurant" | "courier_at_restaurant"
  | "picked_up" | "on_the_way" | "arriving" | "delivered";

export type CustomerProblem = "cancelled" | "rejected" | "delivery_failed" | null;

/**
 * Collapse the two state machines into the ONE stage a customer reads.
 *
 * Delivery wins once the food is with a rider; before that the kitchen does.
 * Same precedence as the server-side reducer, expressed for a phone.
 */
export function toCustomerStage(
  restaurantState: RestaurantState,
  deliveryState: DeliveryState | null
): { stage: CustomerOrderStage; problem: CustomerProblem } {
  if (restaurantState === "rejected") return { stage: "confirmed", problem: "rejected" };
  if (restaurantState === "cancelled") return { stage: "confirmed", problem: "cancelled" };

  switch (deliveryState) {
    case "CANCELLED": return { stage: "confirmed", problem: "cancelled" };
    case "DELIVERY_FAILED": return { stage: "on_the_way", problem: "delivery_failed" };
    case "DELIVERED": return { stage: "delivered", problem: null };
    case "ARRIVING": return { stage: "arriving", problem: null };
    case "EN_ROUTE_TO_CUSTOMER": return { stage: "on_the_way", problem: null };
    case "PICKED_UP": return { stage: "picked_up", problem: null };
    case "ARRIVED_AT_PICKUP":
    case "WAITING_FOR_ORDER": return { stage: "courier_at_restaurant", problem: null };
    case "DRIVER_TO_PICKUP": return { stage: "courier_to_restaurant", problem: null };
    case "DRIVER_ASSIGNED": return { stage: "courier_assigned", problem: null };

    // A job exists and is out to riders, but nobody has taken it yet. Worth
    // its own stage: "Preparing" while the kitchen is done and everyone is
    // waiting on a rider is the wrong answer to "where is my food".
    // REASSIGNING lands here too — from the customer's side, losing a rider
    // and looking for the first one are the same wait.
    case "SEARCHING_FOR_DRIVER":
    case "REASSIGNING":
    case "DRIVER_CANCELLED": return { stage: "finding_rider", problem: null };

    default: break;
  }

  // No rider yet — the kitchen's progress is the whole story.
  switch (restaurantState) {
    case "preparing":
    case "ready": return { stage: "preparing", problem: null };
    case "accepted": return { stage: "restaurant_accepted", problem: null };
    default: return { stage: "confirmed", problem: null };
  }
}

/**
 * What to say when there is no delivery job yet.
 *
 * Before the restaurant accepts, no rider has been booked and nothing is
 * cooking — so the delivery state machine has nothing to report and must not
 * be asked. Reading a fabricated "REQUESTED" here is how a paid order that the
 * kitchen has not even seen ends up telling the customer their food is being
 * prepared.
 */
export function restaurantFacing(
  restaurantState: RestaurantState
): { headline: string; detail: string | null } {
  switch (restaurantState) {
    case "awaiting_payment":
      return { headline: "Confirming your payment", detail: null };
    case "placed":
      return { headline: "Waiting for restaurant", detail: "We've sent your order to the kitchen." };
    case "accepted":
      return { headline: "Restaurant accepted your order", detail: "They're getting it ready." };
    case "preparing":
      return { headline: "Preparing your order", detail: null };
    case "ready":
      return { headline: "Your order is ready", detail: "We're finding you a rider." };
    case "rejected":
      return { headline: "Your order couldn't be accepted", detail: "You'll be refunded in full." };
    case "cancelled":
      return { headline: "Order cancelled", detail: "Any payment will be refunded." };
  }
}

export function toCustomerOrderSummary(
  orderId: string,
  d: Record<string, unknown>,
  /**
   * Display name for orders written before `restaurantName` was stored.
   *
   * Passed in rather than looked up here so this module stays pure. Without it
   * the fallback chain ends at `restaurantId` — an internal slug — which is
   * exactly what a customer must never be shown.
   */
  restaurantNameFallback?: string | null
) {
  const fulfilment = (d.fulfillment ?? {}) as Record<string, unknown>;
  const delivery = (d.delivery ?? null) as Record<string, unknown> | null;
  const pricing = (d.pricing ?? {}) as Record<string, number>;
  const items = Array.isArray(d.items) ? d.items : [];

  const { stage, problem } = toCustomerStage(
    (fulfilment.restaurantState ?? "placed") as RestaurantState,
    (delivery?.state ?? null) as DeliveryState | null
  );

  return {
    id: orderId,
    code: String(d.marketplaceOrderCode ?? ""),
    restaurantName: String(d.restaurantName ?? restaurantNameFallback ?? d.restaurantId ?? ""),
    restaurantLogoUrl: (d.restaurantLogoUrl as string | undefined) ?? null,
    totalMinor: Number(pricing.totalChargedMinor ?? 0),
    stage, problem,
    placedAt: new Date(Number(d.createdAtMs ?? 0)).toISOString(),
    itemCount: items.reduce((s: number, i: unknown) => s + Number((i as { quantity?: number })?.quantity ?? 1), 0),
    isActive: problem === null && stage !== "delivered",
  };
}

export function toCustomerOrderDetail(
  orderId: string,
  d: Record<string, unknown>,
  restaurantNameFallback?: string | null
) {
  const summary = toCustomerOrderSummary(orderId, d, restaurantNameFallback);
  const pricing = (d.pricing ?? {}) as Record<string, number>;
  const fulfilment = (d.fulfillment ?? {}) as Record<string, unknown>;
  const items = Array.isArray(d.items) ? d.items : [];

  return {
    ...summary,
    lines: items.map((raw) => {
      const i = (raw ?? {}) as Record<string, unknown>;
      return {
        lineId: String(i.dishId ?? ""),
        itemId: String(i.dishId ?? ""),
        name: String(i.name ?? ""),
        imageUrl: null,
        // Per-unit customer price, from the frozen snapshot.
        unitPriceMinor: unitPriceFor(pricing, String(i.dishId ?? "")),
        optionsPriceMinor: 0,
        quantity: Number(i.quantity ?? 1),
        selectedOptions: Array.isArray(i.options) ? i.options : [],
        note: String(i.note ?? ""),
      };
    }),
    deliveryAddress: String(d.address ?? ""),
    deliveryInstructions: String(d.deliveryInstructions ?? ""),
    paymentStatus: String(((d.payment ?? {}) as { state?: string }).state ?? "pending"),
    quote: {
      serviceable: true, reason: null,
      subtotalMinor: Number(pricing.customerSubtotalMinor ?? 0),
      deliveryFeeMinor: Number(pricing.deliveryFeeMinor ?? 0),
      discountMinor: Number(pricing.discountTotalMinor ?? 0),
      taxMinor: Number(pricing.taxMinor ?? 0),
      totalMinor: Number(pricing.totalChargedMinor ?? 0),
      etaMins: null, quoteId: null, expiresAt: null,
    },
    timeline: buildCustomerTimeline(d),
  };
}

/**
 * The customer's timeline.
 *
 * Restaurant and delivery events, in the customer's own words — the same
 * function the tracking screen uses, so the two can never diverge. Operational
 * reasons and internal state names are dropped, not softened.
 */
function buildCustomerTimeline(d: Record<string, unknown>) {
  const out: Array<{ at: string; label: string; detail: string | null }> = [];
  const fulfilment = (d.fulfillment ?? {}) as Record<string, unknown>;
  const payment = (d.payment ?? {}) as Record<string, unknown>;
  const delivery = (d.delivery ?? null) as Record<string, unknown> | null;

  if (typeof payment.verifiedAt === "number") {
    out.push({ at: new Date(payment.verifiedAt).toISOString(), label: "Order confirmed", detail: null });
  }
  for (const raw of (fulfilment.history ?? []) as Array<Record<string, unknown>>) {
    const label = restaurantLabel(String(raw.state ?? ""));
    if (label) out.push({ at: new Date(Number(raw.at ?? 0)).toISOString(), label, detail: null });
  }
  for (const [key, state] of [
    ["assignedAt", "DRIVER_ASSIGNED"], ["pickedUpAt", "PICKED_UP"], ["deliveredAt", "DELIVERED"],
  ] as const) {
    const at = delivery?.[key];
    if (typeof at === "number") {
      out.push({
        at: new Date(at).toISOString(),
        label: toCustomerFacing(state as DeliveryState, {
          driverFirstName: ((delivery?.driver ?? null) as { firstName?: string } | null)?.firstName,
        }).headline,
        detail: null,
      });
    }
  }
  return out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

function restaurantLabel(state: string): string | null {
  switch (state) {
    case "accepted": return "Restaurant accepted your order";
    case "preparing": return "Preparing your food";
    case "rejected": return "Your order couldn't be accepted";
    // `placed` is already covered by "Order confirmed"; `ready` is invisible to
    // the customer, who cares about the courier, not the pass.
    default: return null;
  }
}

function unitPriceFor(pricing: Record<string, unknown>, dishId: string): number {
  const lines = (pricing.lines ?? []) as Array<Record<string, number | string>>;
  const line = lines.find((l) => l.dishId === dishId);
  return Number(line?.customerPriceMinor ?? 0);
}
