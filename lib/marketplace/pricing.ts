/**
 * Marketplace pricing — base price in, customer price out, snapshot forever.
 *
 * ── The guarantee this file exists to make ───────────────────────────────────
 * A restaurant's POS price is never touched. The POS reads `prepared_items`;
 * the storefront and the marketplace read `menu_items`; the marketplace price
 * is a THIRD layer computed on top of `menu_items.price` and written only onto
 * the order. There is no code path by which a markup reaches a cashier's till,
 * and that holds without changing a line of POS code.
 *
 * ── Why the output is a snapshot ─────────────────────────────────────────────
 * Resolution is pure and deterministic, and its result is written once onto the
 * order and never recomputed. A restaurant editing its menu tomorrow, or an
 * operator changing a markup, cannot alter what yesterday's order says the
 * restaurant is owed. Historical orders are read, never re-derived.
 *
 * All money is in MINOR UNITS (kobo) and every value is an integer. Floating
 * point does not belong anywhere near a payable.
 */

/** Every amount in this module is an integer number of kobo. */
export type Minor = number;

export type MarkupRule =
  | { type: "none" }
  /** basis points, so 20% is 2000 — no float percentages in money maths. */
  | { type: "percent"; bps: number }
  /** A flat addition to the base price, per unit. */
  | { type: "fixed"; amountMinor: Minor }
  /** An explicit customer-facing price, ignoring the base entirely. */
  | { type: "absolute"; amountMinor: Minor };

export type PricingConfig = {
  /** Platform default, used when a restaurant sets none. */
  platformDefault: MarkupRule;
  /** Restaurant-level default, used when an item sets none. */
  restaurantDefault: MarkupRule | null;
  /** Round the customer price UP to this step, so prices look deliberate. */
  roundToMinor: Minor;
  /** Bumped whenever the resolution rules themselves change. */
  rulesVersion: number;
};

export const DEFAULT_ROUND_TO: Minor = 5000; // ₦50

export type ResolvedSource = "item" | "restaurant" | "platform";

export type LineInput = {
  dishId: string;
  name: string;
  quantity: number;
  /** The restaurant's own price, per unit, from `menu_items.price`. */
  basePriceMinor: Minor;
  /** Per-unit total of chosen options. Marked up with the base. */
  optionsTotalMinor?: Minor;
  /** Item-level override. Wins over the restaurant and platform defaults. */
  override?: MarkupRule | null;
  note?: string;
};

export type PricedLine = {
  dishId: string;
  name: string;
  quantity: number;
  basePriceMinor: Minor;
  optionsTotalMinor: Minor;
  /** After markup and rounding. What the customer sees, per unit. */
  customerPriceMinor: Minor;
  markupApplied: { source: ResolvedSource; rule: MarkupRule };
  /** basePrice + options, per unit — what the restaurant earns. */
  restaurantUnitMinor: Minor;
  lineRestaurantMinor: Minor;
  lineCustomerMinor: Minor;
  note: string;
};

/**
 * The immutable commercial record of one order.
 *
 * Written once at checkout. Every downstream number — restaurant payable,
 * platform margin, refund basis, settlement — is read from here, never
 * recomputed from a menu that may since have changed.
 */
export type PriceSnapshot = {
  currency: "NGN";
  rulesVersion: number;
  computedAt: number;
  lines: PricedLine[];
  /** Σ restaurant unit × qty. What the restaurant earns before deductions. */
  restaurantSubtotalMinor: Minor;
  /** Σ customer unit × qty. What the customer is charged for food. */
  customerSubtotalMinor: Minor;
  /** customerSubtotal − restaurantSubtotal. */
  markupTotalMinor: Minor;
  deliveryFeeMinor: Minor;
  /** What Dispatcher charges us. Cost, not revenue. */
  deliveryCostMinor: Minor;
  discounts: Array<{ code: string; amountMinor: Minor; fundedBy: "platform" | "restaurant" }>;
  discountTotalMinor: Minor;
  taxMinor: Minor;
  processorFeeMinor: Minor;
  /** The single number the customer is charged. */
  totalChargedMinor: Minor;
  /** restaurantSubtotal − restaurant-funded discounts. */
  restaurantPayableMinor: Minor;
  /** What we owe Dispatcher for this delivery. */
  deliveryPayableMinor: Minor;
  /** markup + delivery margin − platform-funded discounts − processor fee. */
  platformGrossMinor: Minor;
  quoteId: string | null;
};

// ── Resolution ──────────────────────────────────────────────────────────────

/**
 * First rule that applies wins, most specific first:
 *   item override → restaurant default → platform default.
 *
 * A configured `{type:"none"}` is a real answer and stops the walk — "this
 * restaurant takes no markup" must be expressible, and must not silently fall
 * through to the platform default.
 */
export function resolveMarkup(
  itemOverride: MarkupRule | null | undefined,
  config: PricingConfig
): { source: ResolvedSource; rule: MarkupRule } {
  if (itemOverride) return { source: "item", rule: itemOverride };
  if (config.restaurantDefault) return { source: "restaurant", rule: config.restaurantDefault };
  return { source: "platform", rule: config.platformDefault };
}

/** Apply one rule to one unit price. Never returns less than the base. */
export function applyMarkup(baseMinor: Minor, rule: MarkupRule): Minor {
  switch (rule.type) {
    case "none":
      return baseMinor;
    case "percent":
      // Integer maths throughout: bps/10000, rounded once, at the end.
      return baseMinor + Math.round((baseMinor * rule.bps) / 10_000);
    case "fixed":
      return baseMinor + rule.amountMinor;
    case "absolute":
      // An explicit customer price. Guarded below so it can never sit under the
      // restaurant's own price and turn a sale into a loss.
      return rule.amountMinor;
  }
}

export function roundUpTo(valueMinor: Minor, stepMinor: Minor): Minor {
  if (!stepMinor || stepMinor <= 0) return Math.ceil(valueMinor);
  return Math.ceil(valueMinor / stepMinor) * stepMinor;
}

export function priceLine(input: LineInput, config: PricingConfig): PricedLine {
  const options = input.optionsTotalMinor ?? 0;
  const restaurantUnit = input.basePriceMinor + options;
  const { source, rule } = resolveMarkup(input.override, config);

  const marked = applyMarkup(restaurantUnit, rule);
  const rounded = roundUpTo(marked, config.roundToMinor);

  // The floor exists because an `absolute` override is operator-entered and a
  // typo must not produce a line the platform pays the restaurant to sell.
  const customerUnit = Math.max(rounded, restaurantUnit);

  return {
    dishId: input.dishId,
    name: input.name,
    quantity: input.quantity,
    basePriceMinor: input.basePriceMinor,
    optionsTotalMinor: options,
    customerPriceMinor: customerUnit,
    markupApplied: { source, rule },
    restaurantUnitMinor: restaurantUnit,
    lineRestaurantMinor: restaurantUnit * input.quantity,
    lineCustomerMinor: customerUnit * input.quantity,
    note: input.note ?? "",
  };
}

export type SnapshotInput = {
  lines: LineInput[];
  config: PricingConfig;
  /** What the customer is charged for delivery. RestoFlow's decision. */
  deliveryFeeMinor: Minor;
  /** What Dispatcher charges us. Their quote. */
  deliveryCostMinor: Minor;
  quoteId: string | null;
  discounts?: Array<{ code: string; amountMinor: Minor; fundedBy: "platform" | "restaurant" }>;
  taxMinor?: Minor;
  /** Estimated at checkout; corrected from the provider at verification. */
  processorFeeMinor?: Minor;
  nowMs: number;
};

export function buildSnapshot(input: SnapshotInput): PriceSnapshot {
  const lines = input.lines.map((l) => priceLine(l, input.config));

  const restaurantSubtotal = sum(lines.map((l) => l.lineRestaurantMinor));
  const customerSubtotal = sum(lines.map((l) => l.lineCustomerMinor));
  const discounts = input.discounts ?? [];
  const discountTotal = sum(discounts.map((d) => d.amountMinor));
  const restaurantFunded = sum(discounts.filter((d) => d.fundedBy === "restaurant").map((d) => d.amountMinor));
  const platformFunded = discountTotal - restaurantFunded;

  const tax = input.taxMinor ?? 0;
  const processorFee = input.processorFeeMinor ?? 0;

  const totalCharged = customerSubtotal + input.deliveryFeeMinor + tax - discountTotal;

  return {
    currency: "NGN",
    rulesVersion: input.config.rulesVersion,
    computedAt: input.nowMs,
    lines,
    restaurantSubtotalMinor: restaurantSubtotal,
    customerSubtotalMinor: customerSubtotal,
    markupTotalMinor: customerSubtotal - restaurantSubtotal,
    deliveryFeeMinor: input.deliveryFeeMinor,
    deliveryCostMinor: input.deliveryCostMinor,
    discounts,
    discountTotalMinor: discountTotal,
    taxMinor: tax,
    processorFeeMinor: processorFee,
    totalChargedMinor: totalCharged,
    restaurantPayableMinor: restaurantSubtotal - restaurantFunded,
    deliveryPayableMinor: input.deliveryCostMinor,
    // Everything left after the restaurant and the courier are paid, minus what
    // the platform itself funded.
    //
    // Tax is deliberately NOT in here. It is collected on behalf of a tax
    // authority and is a separate claim on the money, not revenue — including
    // it double-counted the tax against the ledger, which is how the property
    // test caught it.
    platformGrossMinor:
      (customerSubtotal - restaurantSubtotal) +
      (input.deliveryFeeMinor - input.deliveryCostMinor) -
      platformFunded - processorFee,
    quoteId: input.quoteId,
  };
}

// ── Invariants ──────────────────────────────────────────────────────────────

export type InvariantResult = { ok: true } | { ok: false; errors: string[] };

/**
 * Two identities that must hold on every snapshot, asserted at write time and
 * property-tested across randomised inputs.
 *
 *   customerSubtotal + delivery + tax − discounts  ==  totalCharged
 *   restaurantPayable + deliveryPayable + platformGross + processorFee + tax
 *                                                  ==  totalCharged
 *
 * The second is the one that catches a mistake: if the money coming in does not
 * equal the money going out plus what we keep, some number is wrong, and it is
 * far cheaper to find that here than in a settlement statement.
 */
export function checkInvariants(s: PriceSnapshot): InvariantResult {
  const errors: string[] = [];

  const charged = s.customerSubtotalMinor + s.deliveryFeeMinor + s.taxMinor - s.discountTotalMinor;
  if (charged !== s.totalChargedMinor) {
    errors.push(`totalCharged ${s.totalChargedMinor} ≠ subtotal+delivery+tax−discount ${charged}`);
  }

  // Every party with a claim on the money the customer paid: the restaurant,
  // the courier, the payment provider, the tax authority, and us.
  const distributed =
    s.restaurantPayableMinor + s.deliveryPayableMinor + s.platformGrossMinor +
    s.processorFeeMinor + s.taxMinor;
  if (distributed !== s.totalChargedMinor) {
    errors.push(`distribution ${distributed} ≠ totalCharged ${s.totalChargedMinor}`);
  }

  if (s.markupTotalMinor < 0) errors.push("markupTotal is negative");
  if (s.restaurantPayableMinor < 0) errors.push("restaurantPayable is negative");
  if (s.totalChargedMinor < 0) errors.push("totalCharged is negative");

  for (const l of s.lines) {
    if (!Number.isInteger(l.customerPriceMinor)) errors.push(`${l.dishId}: non-integer customer price`);
    if (l.customerPriceMinor < l.restaurantUnitMinor) {
      errors.push(`${l.dishId}: customer price below the restaurant's own price`);
    }
    if (!Number.isInteger(l.quantity) || l.quantity < 1) errors.push(`${l.dishId}: bad quantity`);
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

/** Display helper. Never used for arithmetic. */
export function formatNaira(minor: Minor): string {
  return `₦${(minor / 100).toLocaleString("en-NG", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

/**
 * What the customer is charged for delivery, given what Dispatcher charges us.
 *
 * Pass-through at launch (audit decision D2): the customer pays the courier
 * cost and the platform takes its margin on the food, not on the ride. The
 * margin field exists on the snapshot so this policy can change later without
 * a schema change or a migration of historical orders.
 */
export function customerDeliveryFee(dispatcherFeeMinor: number): number {
  return dispatcherFeeMinor;
}
