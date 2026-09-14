import type { Bps } from "./config";

/**
 * What a Connect partner pays RestoFlow for a delivery.
 *
 * ── Why this exists as its own rule ──────────────────────────────────────────
 * The marketplace's `customerDeliveryFee` is currently pass-through — it
 * returns the Dispatcher cost unchanged, so RestoFlow earns nothing on
 * logistics. Connect's whole premise is logistics revenue, so it cannot inherit
 * that, and the margin has to be a configured per-partner value rather than a
 * constant somebody has to find and change in six places later.
 *
 * ── What the partner sees ────────────────────────────────────────────────────
 * One number: the amount payable. The Dispatcher cost and RestoFlow's margin
 * are accounting facts, not quote copy — a partner quoted "₦1,200 plus our
 * ₦120" is being invited to negotiate with the wrong party.
 */
export type ConnectPrice = {
  /** What Dispatcher charges RestoFlow. Internal. */
  dispatcherCostMinor: number;
  /** RestoFlow's margin. Internal. */
  marginMinor: number;
  /** What the partner pays. The only figure shown. */
  partnerPriceMinor: number;
  marginBps: Bps;
};

/**
 * Round half-up on a non-negative amount.
 *
 * `Math.round` rounds -0.5 toward zero, which for money means a margin that
 * disagrees with itself either side of zero. Costs are never negative here, but
 * the rule is stated rather than assumed.
 */
function roundMinor(x: number): number {
  return Math.floor(x + 0.5);
}

export function priceConnectDelivery(args: {
  dispatcherCostMinor: number;
  marginBps: Bps;
}): ConnectPrice {
  const cost = Math.max(0, Math.round(args.dispatcherCostMinor));
  const bps = Math.max(0, Math.round(args.marginBps));

  // Computed from the cost, then added — never derived from the total, which
  // would make the margin a function of itself.
  const marginMinor = roundMinor((cost * bps) / 10_000);

  return {
    dispatcherCostMinor: cost,
    marginMinor,
    partnerPriceMinor: cost + marginMinor,
    marginBps: bps,
  };
}
