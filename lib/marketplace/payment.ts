/**
 * The marketplace payment lifecycle.
 *
 * ── Separate from everything that exists ─────────────────────────────────────
 * The storefront's Paystack flow (`/api/orders/initialize`) settles to the
 * RESTAURANT's subaccount and is untouched. Marketplace payments are collected
 * by the platform, because a markup cannot be retained from money that never
 * arrives. Two flows, one provider, no shared code path.
 *
 * ── Why the order is created at verification, not at checkout ────────────────
 * A pending intent holds the basket; the order comes into existence only when a
 * payment is verified server-side. That single choice removes a whole class of
 * failure: there is no such thing as an unpaid marketplace order to reconcile,
 * abandon, or accidentally send to a kitchen.
 *
 * Pure over a store port, so every replay and race below is exercised in tests.
 */

import type { PriceSnapshot } from "./pricing";
import type { MarketplaceOrderItem } from "./order";

/** What is held between "customer pressed pay" and "money arrived". */
export type PaymentIntent = {
  reference: string;
  restaurantId: string;
  customerId: string;
  customerFirstName: string;
  customerPhone: string;
  deliveryAddress: string;
  deliveryLocation: { lat: number; lng: number };
  note: string;
  items: MarketplaceOrderItem[];
  /** Computed and frozen at checkout. Never recomputed at verification. */
  pricing: PriceSnapshot;
  quoteId: string | null;
  prepMins: number;
  correlationId: string;
  createdAt: number;
  expiresAt: number;
};

/** Intents older than this are swept; the customer re-checks-out. */
export const INTENT_TTL_MS = 30 * 60_000;

export type ProviderVerification = {
  reference: string;
  status: "success" | "failed" | "pending";
  /** Minor units, as the provider reports them. */
  amountMinor: number;
  /** Actual processor fee, when the provider tells us. */
  feeMinor: number | null;
};

export type PaymentStore = {
  /**
   * The order this reference has already produced, if any.
   *
   * Checked FIRST, before the intent. The intent is consumed when the order is
   * created, so a duplicate webhook arriving afterwards has no intent to find —
   * and would otherwise be reported as "not ours" rather than "already done".
   * Idempotency asks "have I already done this?" before "do I have the inputs?".
   */
  getOrderIdByReference(reference: string): Promise<string | null>;
  getIntent(reference: string): Promise<PaymentIntent | null>;
  /**
   * Create the order and consume the intent in ONE transaction, keyed on the
   * payment reference.
   *
   * Returns the existing order id when the reference has already produced one.
   * This is the whole idempotency story: a webhook, a client callback and a
   * verify poll can all arrive for the same payment, and exactly one order
   * exists afterwards.
   */
  materialiseOrder(args: {
    reference: string;
    intent: PaymentIntent;
    verification: ProviderVerification;
    nowMs: number;
  }): Promise<{ orderId: string; created: boolean }>;
  /** Records a failed or reversed payment without creating an order. */
  recordFailure(reference: string, reason: string, nowMs: number): Promise<void>;
};

export type SettleResult =
  | { outcome: "created"; orderId: string }
  | { outcome: "replayed"; orderId: string }
  | { outcome: "amount_mismatch"; expectedMinor: number; actualMinor: number }
  | { outcome: "no_intent" }
  | { outcome: "pending" }
  | { outcome: "failed"; reason: string };

/**
 * Turn a verified provider payment into exactly one marketplace order.
 *
 * Every entry point — the Paystack webhook, the customer's return from the
 * checkout page, and the reconciliation sweep — calls this. They race, they
 * repeat, and they arrive out of order; the transaction inside
 * `materialiseOrder` is what makes that safe rather than the caller being
 * careful.
 */
export async function settlePayment(args: {
  verification: ProviderVerification;
  store: PaymentStore;
  nowMs: number;
  log?: (event: string, fields: Record<string, unknown>) => void;
}): Promise<SettleResult> {
  const { verification: v, store, nowMs } = args;
  const log = args.log ?? (() => {});

  if (v.status === "pending") return { outcome: "pending" };

  // Already settled. Every later delivery of this payment — webhook retry,
  // client callback, reconciliation sweep — lands here and stops.
  const already = await store.getOrderIdByReference(v.reference);
  if (already) {
    log("marketplace_payment_replayed", { reference: v.reference, orderId: already });
    return { outcome: "replayed", orderId: already };
  }

  const intent = await store.getIntent(v.reference);

  if (v.status === "failed") {
    // No intent to fail is not an error worth retrying — the sweep will have
    // cleaned it up, or it was never ours.
    if (intent) await store.recordFailure(v.reference, "provider reported failure", nowMs);
    return { outcome: "failed", reason: "provider reported failure" };
  }

  if (!intent) {
    // Either the intent expired, or this reference belongs to a different
    // product on the same Paystack account. Neither may create an order.
    log("marketplace_payment_no_intent", { reference: v.reference });
    return { outcome: "no_intent" };
  }

  // The amount is checked against the FROZEN snapshot, not recomputed. A
  // mismatch means the customer paid something other than what we quoted, and
  // creating an order for it would silently accept a wrong price.
  if (v.amountMinor !== intent.pricing.totalChargedMinor) {
    log("marketplace_payment_amount_mismatch", {
      reference: v.reference,
      expected: intent.pricing.totalChargedMinor,
      actual: v.amountMinor,
    });
    return {
      outcome: "amount_mismatch",
      expectedMinor: intent.pricing.totalChargedMinor,
      actualMinor: v.amountMinor,
    };
  }

  const result = await store.materialiseOrder({ reference: v.reference, intent, verification: v, nowMs });

  log(result.created ? "marketplace_order_created" : "marketplace_payment_replayed", {
    reference: v.reference, orderId: result.orderId, correlationId: intent.correlationId,
  });

  return result.created
    ? { outcome: "created", orderId: result.orderId }
    : { outcome: "replayed", orderId: result.orderId };
}

/**
 * Whether the actual processor fee should replace the estimate on the snapshot.
 *
 * The estimate is made at checkout; the provider reports the truth at
 * verification. Correcting it keeps the ledger honest — but the correction is
 * an ADJUSTMENT entry, never an edit to the frozen snapshot.
 */
export function processorFeeDelta(snapshot: PriceSnapshot, v: ProviderVerification): number {
  if (v.feeMinor === null) return 0;
  return v.feeMinor - snapshot.processorFeeMinor;
}

export function isIntentExpired(intent: PaymentIntent, nowMs: number): boolean {
  return nowMs > intent.expiresAt;
}
