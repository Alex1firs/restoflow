/**
 * The marketplace order model.
 *
 * ── Same collection, different lifecycle ─────────────────────────────────────
 * Marketplace orders live in `orders` alongside POS and storefront orders,
 * discriminated by `orderSource: "marketplace"`. A separate collection would
 * fragment the restaurant's order screens, the reports, the AI layer and the
 * super-admin views — all of which already read `orders` and already branch on
 * `orderSource`.
 *
 * What they do NOT share is the cashier machinery: no `orderNumber`, no
 * `orderCounter` increment, no `localOrderId`, no `pos_order_claims`. A
 * marketplace order carries `marketplaceOrderCode` — a customer-facing
 * reference — and its own state machine.
 *
 * Pure. The Firestore shape is built here; the adapter writes it.
 */

import type { PriceSnapshot } from "./pricing";

export const ORDER_SOURCE = "marketplace" as const;

/** What the kitchen is doing. Drives the restaurant-facing screens. */
export const RESTAURANT_STATES = [
  "awaiting_payment", "placed", "accepted", "preparing", "ready", "rejected", "cancelled",
] as const;
export type RestaurantState = (typeof RESTAURANT_STATES)[number];

export const PAYMENT_STATES = [
  "pending", "paid", "failed", "refunded", "partially_refunded",
] as const;
export type PaymentState = (typeof PAYMENT_STATES)[number];

export const SETTLEMENT_STATES = ["unsettled", "scheduled", "paid", "on_hold"] as const;
export type SettlementState = (typeof SETTLEMENT_STATES)[number];

export const REFUND_STATES = ["none", "requested", "partial", "full", "failed"] as const;
export type RefundState = (typeof REFUND_STATES)[number];

export type MarketplaceOrderItem = {
  dishId: string;
  menuItemId: string;
  name: string;
  quantity: number;
  options: Array<{ groupId: string; optionId: string; name: string; priceMinor: number }>;
  note: string;
};

/**
 * The document written to `orders/{orderId}`.
 *
 * Every field a POS order also has keeps the same meaning, so existing screens,
 * reports and queries continue to work without knowing marketplace exists.
 */
export type MarketplaceOrder = {
  orderSource: typeof ORDER_SOURCE;
  /** Customer-facing. NOT the per-restaurant cashier sequence. */
  marketplaceOrderCode: string;
  restaurantId: string;
  /** Display name, frozen at checkout so history never shows an internal slug. */
  restaurantName: string;
  customerId: string;

  items: MarketplaceOrderItem[];
  /** Immutable. Never recomputed from the current menu. */
  pricing: PriceSnapshot;

  // ── Legacy-compatible mirrors, so existing readers keep working ──
  /** Mirrors pricing.customerSubtotal — what existing screens call itemsTotal. */
  itemsTotal: number;
  deliveryFee: number;
  total: number;
  paymentMethod: "online";
  paymentStatus: "paid" | "unpaid";
  status: "pending" | "preparing" | "ready" | "completed" | "rejected";
  deliveryType: "delivery";
  orderType: "normal";
  customerName: string;
  phone: string;
  address: string;
  /** Dropoff coordinates, carried from the quote so delivery uses the priced point. */
  deliveryLocation: { lat: number; lng: number } | null;
  note: string;

  // ── Marketplace lifecycle ──
  fulfillment: {
    restaurantState: RestaurantState;
    history: Array<{ state: string; at: number; by: string; reason?: string }>;
    acceptedAt: number | null;
    prepMins: number;
    readyAt: number | null;
  };
  payment: {
    state: PaymentState;
    provider: "paystack";
    reference: string | null;
    verifiedAt: number | null;
  };
  refund: { state: RefundState; totalMinor: number };
  settlement: { state: SettlementState; settlementId: string | null };

  /** Written by the delivery integration. Absent until a job is requested. */
  delivery?: unknown;
  /** Epoch ms at which the delivery job should be released to riders. */
  deliveryConfirmAt?: number | null;

  correlationId: string;
  createdAt: number;
  updatedAt: number;
};

/**
 * Customer-facing order code.
 *
 * Deliberately not sequential: a guessable code plus a weak endpoint is how
 * order enumeration happens, and there is no operational reason for a customer
 * reference to reveal how many orders the platform has taken.
 */
export function makeOrderCode(random: () => number = Math.random): string {
  const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1
  let out = "";
  for (let i = 0; i < 6; i++) out += ALPHABET[Math.floor(random() * ALPHABET.length)];
  return `RF-${out}`;
}

/**
 * Map the marketplace lifecycle onto the legacy `status` field.
 *
 * Existing restaurant screens, reports and the AI layer all read `status`.
 * Keeping it in step means a marketplace order renders correctly in every
 * screen that predates marketplace, without those screens changing.
 */
export function legacyStatusFor(restaurantState: RestaurantState): MarketplaceOrder["status"] {
  switch (restaurantState) {
    case "awaiting_payment":
    case "placed":
    case "accepted": return "pending";
    case "preparing": return "preparing";
    case "ready": return "ready";
    case "rejected": return "rejected";
    case "cancelled": return "rejected";
  }
}

export type BuildOrderInput = {
  marketplaceOrderCode: string;
  restaurantId: string;
  /** Display name, frozen at checkout. Never an internal slug. */
  restaurantName: string;
  customerId: string;
  customerFirstName: string;
  customerPhone: string;
  deliveryAddress: string;
  /**
   * Dropoff coordinates.
   *
   * Persisted alongside the address because the delivery handoff needs a
   * LatLng and a street string cannot be turned back into one without a
   * paid geocode — and geocoding at handoff time would mean a courier is
   * dispatched to a slightly different place than the customer was quoted
   * for. The quote priced THIS point; the delivery must use the same one.
   */
  deliveryLocation: { lat: number; lng: number } | null;
  note: string;
  items: MarketplaceOrderItem[];
  pricing: PriceSnapshot;
  paymentReference: string;
  prepMins: number;
  correlationId: string;
  nowMs: number;
};

/** Built ONLY after a payment is verified. There is no unpaid marketplace order. */
export function buildMarketplaceOrder(input: BuildOrderInput): MarketplaceOrder {
  const p = input.pricing;
  return {
    orderSource: ORDER_SOURCE,
    marketplaceOrderCode: input.marketplaceOrderCode,
    restaurantId: input.restaurantId,
    restaurantName: input.restaurantName,
    customerId: input.customerId,
    items: input.items,
    pricing: p,

    // Minor units are the truth; these mirrors are in naira because that is
    // what every existing screen already renders.
    itemsTotal: p.customerSubtotalMinor / 100,
    deliveryFee: p.deliveryFeeMinor / 100,
    total: p.totalChargedMinor / 100,
    paymentMethod: "online",
    paymentStatus: "paid",
    status: "pending",
    deliveryType: "delivery",
    orderType: "normal",
    customerName: input.customerFirstName,
    phone: input.customerPhone,
    address: input.deliveryAddress,
    deliveryLocation: input.deliveryLocation ?? null,
    note: input.note,

    fulfillment: {
      restaurantState: "placed",
      history: [{ state: "placed", at: input.nowMs, by: "system" }],
      acceptedAt: null,
      prepMins: input.prepMins,
      readyAt: null,
    },
    payment: {
      state: "paid",
      provider: "paystack",
      reference: input.paymentReference,
      verifiedAt: input.nowMs,
    },
    refund: { state: "none", totalMinor: 0 },
    settlement: { state: "unsettled", settlementId: null },

    correlationId: input.correlationId,
    createdAt: input.nowMs,
    updatedAt: input.nowMs,
  };
}

export type TransitionResult =
  | { ok: true; next: RestaurantState; legacyStatus: MarketplaceOrder["status"] }
  | { ok: false; reason: string };

/**
 * The restaurant-side state machine.
 *
 * Explicit transitions only. An illegal move is refused rather than silently
 * ignored, so a double-tapped Accept and a genuinely wrong request are
 * distinguishable — the first is idempotent, the second is a bug worth seeing.
 */
const ALLOWED: Record<RestaurantState, RestaurantState[]> = {
  awaiting_payment: ["placed", "cancelled"],
  placed: ["accepted", "rejected", "cancelled"],
  accepted: ["preparing", "cancelled"],
  preparing: ["ready", "cancelled"],
  ready: [],          // handover to the courier ends the restaurant's part
  rejected: [],
  cancelled: [],
};

export function transitionRestaurant(from: RestaurantState, to: RestaurantState): TransitionResult {
  if (from === to) {
    // A retry, not an error. Accepting twice must report success.
    return { ok: true, next: to, legacyStatus: legacyStatusFor(to) };
  }
  if (!ALLOWED[from].includes(to)) {
    return { ok: false, reason: `cannot move a ${from} order to ${to}` };
  }
  return { ok: true, next: to, legacyStatus: legacyStatusFor(to) };
}

/** Whether a customer may still cancel without a human deciding. */
export function customerMayCancel(state: RestaurantState): boolean {
  return state === "placed";
}
