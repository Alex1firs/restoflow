// Pure location-match logic for the pre-checkout notice (G4).
// No React, no fetch, no DOM — unit-testable with tsx. Compares the state a
// customer picked on /discover against the restaurant's own state, and produces
// the notice kind + wording. State-level only (D2); city is wording-only.

export type LocationMatch = "same" | "different" | "restaurant-unknown" | "no-customer-state";

export type LocationNotice = {
  kind: LocationMatch;
  /** Whether the storefront should render a warning banner at all. */
  show: boolean;
  /** Short banner title (empty when nothing to show). */
  title: string;
  /** Supporting line (empty when nothing to show). */
  body: string;
};

/** Case/space-insensitive state equality (mirrors /discover's sameState). */
export function sameState(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
}

/**
 * Classify the customer↔restaurant location relationship.
 * - no customer state (direct visit / no selection) → nothing shown (D5, direct-visit rule).
 * - restaurant has no state, customer does → soft unknown-location note (D5).
 * - same state → silent (D4).
 * - different state → out-of-area warning (D1 soft).
 */
export function classifyLocation(input: {
  customerState: string | null;
  restaurantState: string | null;
  customerCity?: string | null;
}): LocationNotice {
  const customerState = (input.customerState ?? "").trim();
  const restaurantState = (input.restaurantState ?? "").trim();

  if (!customerState) {
    return { kind: "no-customer-state", show: false, title: "", body: "" };
  }

  if (!restaurantState) {
    return {
      kind: "restaurant-unknown",
      show: true,
      title: "This restaurant hasn't listed its location yet.",
      body: `If you're ordering delivery, confirm they cover ${customerState} before you pay.`,
    };
  }

  if (sameState(customerState, restaurantState)) {
    return { kind: "same", show: false, title: "", body: "" };
  }

  return {
    kind: "different",
    show: true,
    title: `Heads up — this restaurant is in ${restaurantState}, but you're browsing ${customerState}.`,
    body: `Delivery may not reach ${customerState}. Confirm the restaurant delivers to your area (or choose pickup) before ordering.`,
  };
}
