/**
 * Marketplace refund execution.
 *
 * The ledger already models refunds; this is the part that actually moves money
 * back, and the part that must never move it twice.
 *
 * ── Why a refund is a reservation, not a call ────────────────────────────────
 * A provider call can time out having succeeded. If a timeout is treated as a
 * failure and retried, the customer is refunded twice — the mirror image of the
 * duplicate-order bug, and harder to notice because nobody complains about
 * being paid. So a refund is CLAIMED before the provider is called, and a
 * timeout leaves the claim in flight for reconciliation rather than releasing
 * it for a retry.
 *
 * Pure over ports. No firebase, no fetch, no clock.
 */

import type { Minor, PriceSnapshot } from "./pricing";
import { entriesForRefund, type LedgerEntry, type RefundKind } from "./ledger";

/** Why the money is going back. Decides who absorbs it. */
export const REFUND_REASONS = [
  "restaurant_rejected",
  "customer_cancelled_pre_acceptance",
  "item_unavailable",
  "delivery_failed_pre_pickup",
  "delivery_failed_post_pickup",
  "goodwill",
  "operator_adjustment",
] as const;
export type RefundReason = (typeof REFUND_REASONS)[number];

export type Absorption = { restaurantMinor: Minor; platformMinor: Minor; deliveryMinor: Minor };

/**
 * Who absorbs a refund, by cause.
 *
 * These are commercial decisions, written down rather than left to whoever
 * writes the calling code. The one that matters is the last pair: before
 * pickup, the kitchen keeps nothing and the courier is not owed; AFTER pickup,
 * the food was cooked and collected, so the restaurant is still paid and the
 * platform absorbs the customer's refund. Getting that backwards is how a
 * restaurant loses trust in the marketplace in its first month.
 */
export function absorptionFor(reason: RefundReason, snapshot: PriceSnapshot): Absorption {
  const food = snapshot.restaurantPayableMinor;
  const markup = snapshot.markupTotalMinor;
  const deliveryFee = snapshot.deliveryFeeMinor;
  const deliveryCost = snapshot.deliveryPayableMinor;
  const deliveryMargin = deliveryFee - deliveryCost;

  switch (reason) {
    case "restaurant_rejected":
    case "item_unavailable":
      // The kitchen did not cook it. Everyone gives back what they took.
      return { restaurantMinor: food, platformMinor: markup + deliveryMargin, deliveryMinor: deliveryCost };

    case "customer_cancelled_pre_acceptance":
    case "delivery_failed_pre_pickup":
      // Nothing was made and nothing was carried.
      return { restaurantMinor: food, platformMinor: markup + deliveryMargin, deliveryMinor: deliveryCost };

    case "delivery_failed_post_pickup":
      // The food exists and is gone; the courier did the trip. The platform
      // carries the customer's refund rather than clawing it out of a kitchen
      // that did nothing wrong.
      return { restaurantMinor: 0, platformMinor: food + markup + deliveryMargin, deliveryMinor: deliveryCost };

    case "goodwill":
      return { restaurantMinor: 0, platformMinor: food + markup + deliveryFee - deliveryCost, deliveryMinor: deliveryCost };

    case "operator_adjustment":
      // Must be stated explicitly by the operator; there is no sensible default.
      return { restaurantMinor: 0, platformMinor: 0, deliveryMinor: 0 };
  }
}

export type RefundRequest = {
  orderId: string;
  restaurantId: string;
  reference: string;
  snapshot: PriceSnapshot;
  kind: RefundKind;
  reason: RefundReason;
  /** Minor units. Must not exceed what is left refundable. */
  amountMinor: Minor;
  absorbedBy?: Absorption;
  requestedBy: string;
  /** Distinguishes a genuine second refund from a replay of the first. */
  seq: number;
};

export type ProviderRefund = {
  status: "succeeded" | "failed" | "pending";
  providerReference: string | null;
  raw: unknown;
};

export type RefundClaim = {
  claimId: string;
  orderId: string;
  reference: string;
  amountMinor: Minor;
  state: "in_flight" | "succeeded" | "failed";
  providerReference: string | null;
  createdAt: number;
  resolvedAt: number | null;
};

export type RefundStore = {
  /**
   * The claim for this key, if one exists.
   *
   * Checked FIRST, before anything else. A succeeded refund has already reduced
   * the refundable balance, so a replay would otherwise be rejected as
   * "exceeds refundable" — indistinguishable from a genuine over-refund, and
   * the opposite of what a retrying caller needs to hear.
   */
  getClaim(claimId: string): Promise<RefundClaim | null>;
  /**
   * Reserve the right to refund, atomically.
   *
   * Returns the existing claim when one is already held for this key, so a
   * duplicate request never reaches the provider.
   */
  claimRefund(claim: { claimId: string; orderId: string; reference: string; amountMinor: Minor; nowMs: number }):
    Promise<{ claimed: boolean; existing: RefundClaim | null }>;
  resolveClaim(claimId: string, outcome: { state: "succeeded" | "failed"; providerReference: string | null; raw: unknown; nowMs: number }): Promise<void>;
  appendLedger(entries: LedgerEntry[]): Promise<void>;
  /** Sum of refunds already recorded against this order. */
  refundedTotal(orderId: string): Promise<Minor>;
  setOrderRefundState(orderId: string, state: "partial" | "full" | "failed", totalMinor: Minor): Promise<void>;
};

export type RefundResult =
  | { outcome: "refunded"; claimId: string; providerReference: string | null; entries: number }
  | { outcome: "replayed"; claimId: string; providerReference: string | null }
  | { outcome: "in_flight"; claimId: string }
  | { outcome: "exceeds_refundable"; refundableMinor: Minor }
  | { outcome: "invalid"; reason: string }
  | { outcome: "provider_failed"; claimId: string; reason: string };

/** Deterministic in (order, seq): a retry produces the same claim, not a second. */
export function refundClaimId(orderId: string, seq: number): string {
  return `${orderId}__refund__${seq}`;
}

export async function executeRefund(args: {
  request: RefundRequest;
  store: RefundStore;
  callProvider: (a: { reference: string; amountMinor: Minor; claimId: string }) => Promise<ProviderRefund>;
  nowMs: number;
  log?: (event: string, fields: Record<string, unknown>) => void;
}): Promise<RefundResult> {
  const { request: r, store, nowMs } = args;
  const log = args.log ?? (() => {});

  if (!Number.isInteger(r.amountMinor) || r.amountMinor <= 0) {
    return { outcome: "invalid", reason: "amount must be a positive integer in minor units" };
  }

  const claimId = refundClaimId(r.orderId, r.seq);

  // Idempotency first — "have I already done this?" before "may I do this?".
  const prior = await store.getClaim(claimId);
  if (prior?.state === "succeeded") {
    log("refund_replayed", { orderId: r.orderId, claimId });
    return { outcome: "replayed", claimId, providerReference: prior.providerReference };
  }
  if (prior?.state === "in_flight") {
    // A provider call may have succeeded and timed out. Releasing this for a
    // retry is how a customer gets refunded twice.
    log("refund_in_flight", { orderId: r.orderId, claimId });
    return { outcome: "in_flight", claimId };
  }

  const alreadyRefunded = await store.refundedTotal(r.orderId);
  const refundable = r.snapshot.totalChargedMinor - alreadyRefunded;
  if (r.amountMinor > refundable) {
    log("refund_exceeds_refundable", { orderId: r.orderId, requested: r.amountMinor, refundable });
    return { outcome: "exceeds_refundable", refundableMinor: refundable };
  }

  // Claim BEFORE calling the provider, atomically. The read above is an
  // optimisation and a better error message; THIS is what makes a concurrent
  // duplicate impossible.
  const { claimed, existing } = await store.claimRefund({
    claimId, orderId: r.orderId, reference: r.reference, amountMinor: r.amountMinor, nowMs,
  });

  if (!claimed && existing) {
    if (existing.state === "succeeded") {
      return { outcome: "replayed", claimId, providerReference: existing.providerReference };
    }
    if (existing.state === "in_flight") return { outcome: "in_flight", claimId };
    // A previously FAILED claim is retryable: the money definitely did not move.
  }

  let provider: ProviderRefund;
  try {
    provider = await args.callProvider({ reference: r.reference, amountMinor: r.amountMinor, claimId });
  } catch (err) {
    // Unknown, not failed. Left in flight deliberately.
    log("refund_provider_error", { orderId: r.orderId, claimId, error: String(err) });
    return { outcome: "in_flight", claimId };
  }

  if (provider.status === "pending") {
    return { outcome: "in_flight", claimId };
  }

  if (provider.status === "failed") {
    await store.resolveClaim(claimId, { state: "failed", providerReference: provider.providerReference, raw: provider.raw, nowMs });
    await store.setOrderRefundState(r.orderId, "failed", alreadyRefunded);
    return { outcome: "provider_failed", claimId, reason: "provider declined the refund" };
  }

  const absorbedBy = r.absorbedBy ?? absorptionFor(r.reason, r.snapshot);

  // Append, never rewrite. The original payment entries stay exactly as they
  // were; the refund is a new set of opposing rows.
  const entries = entriesForRefund({
    orderId: r.orderId, restaurantId: r.restaurantId, snapshot: r.snapshot,
    kind: r.kind, absorbedBy, nowMs, createdBy: r.requestedBy,
    reason: r.reason, seq: r.seq,
  });

  await store.appendLedger(entries);
  await store.resolveClaim(claimId, {
    state: "succeeded", providerReference: provider.providerReference, raw: provider.raw, nowMs,
  });

  const total = alreadyRefunded + r.amountMinor;
  await store.setOrderRefundState(
    r.orderId,
    total >= r.snapshot.totalChargedMinor ? "full" : "partial",
    total
  );

  log("refund_succeeded", {
    orderId: r.orderId, claimId, amountMinor: r.amountMinor,
    providerReference: provider.providerReference, reason: r.reason,
  });

  return { outcome: "refunded", claimId, providerReference: provider.providerReference, entries: entries.length };
}

/**
 * Resolve a claim left in flight by a timeout.
 *
 * Asks the provider what actually happened rather than guessing. An unknown
 * answer leaves the claim in flight — the one thing that must never happen is
 * releasing it and refunding again.
 */
export async function reconcileRefund(args: {
  claim: RefundClaim;
  store: RefundStore;
  lookup: (a: { reference: string; claimId: string }) => Promise<ProviderRefund | null>;
  snapshot: PriceSnapshot;
  restaurantId: string;
  reason: RefundReason;
  kind: RefundKind;
  seq: number;
  nowMs: number;
}): Promise<"resolved_succeeded" | "resolved_failed" | "still_unknown"> {
  const found = await args.lookup({ reference: args.claim.reference, claimId: args.claim.claimId });
  if (!found || found.status === "pending") return "still_unknown";

  if (found.status === "failed") {
    await args.store.resolveClaim(args.claim.claimId, {
      state: "failed", providerReference: found.providerReference, raw: found.raw, nowMs: args.nowMs,
    });
    return "resolved_failed";
  }

  await args.store.appendLedger(entriesForRefund({
    orderId: args.claim.orderId, restaurantId: args.restaurantId, snapshot: args.snapshot,
    kind: args.kind, absorbedBy: absorptionFor(args.reason, args.snapshot),
    nowMs: args.nowMs, createdBy: "refund-reconciler", reason: args.reason, seq: args.seq,
  }));
  await args.store.resolveClaim(args.claim.claimId, {
    state: "succeeded", providerReference: found.providerReference, raw: found.raw, nowMs: args.nowMs,
  });
  return "resolved_succeeded";
}
