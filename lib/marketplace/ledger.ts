/**
 * The marketplace ledger.
 *
 * ── Why a ledger and not a set of fields on the order ────────────────────────
 * "What is the restaurant owed?" must be answerable months later, after a
 * partial refund, a goodwill credit and a menu change. Fields get overwritten;
 * entries do not. Every money movement is one immutable row, balances are
 * DERIVED by summing them, and a correction is a new opposing entry rather than
 * an edit. That is the property that makes the books auditable and makes
 * refunds safe to build on.
 *
 * It is cheap to build now and effectively impossible to backfill later, which
 * is why it exists before the first real payment rather than after.
 *
 * Pure: no firebase, no clock. Entries are produced here and written by the
 * store adapter.
 */

import type { Minor, PriceSnapshot } from "./pricing";

/** Where value sits. Entries for one order sum to zero across all accounts. */
export const ACCOUNTS = [
  "customer",            // what the customer paid in (negative = out to them)
  "restaurant_payable",  // what we owe the restaurant
  "delivery_payable",    // what we owe Dispatcher
  "platform_revenue",    // what we keep
  "processor",           // what the payment provider takes
  "tax_payable",
] as const;
export type Account = (typeof ACCOUNTS)[number];

export const ENTRY_KINDS = [
  "customer_payment",
  "food_base",
  "markup",
  "delivery_fee_charged",
  "delivery_cost",
  "delivery_margin",
  "discount_platform",
  "discount_restaurant",
  "processor_fee",
  "tax",
  "refund_food",
  "refund_delivery",
  "refund_full",
  "adjustment",
  "settlement_payout",
] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

/**
 * One immutable movement. Never updated, never deleted.
 *
 * `entryId` is deterministic in (orderId, kind, account, seq) so a retried
 * write produces the same document rather than a second row — the same
 * idempotency discipline as everywhere else in this integration.
 */
export type LedgerEntry = {
  entryId: string;
  orderId: string;
  restaurantId: string;
  currency: "NGN";
  kind: EntryKind;
  account: Account;
  /** Signed minor units. Positive = value into the account. */
  amountMinor: Minor;
  createdAt: number;
  createdBy: string;
  note: string;
};

export type Balances = Record<Account, Minor>;

export function emptyBalances(): Balances {
  return {
    customer: 0, restaurant_payable: 0, delivery_payable: 0,
    platform_revenue: 0, processor: 0, tax_payable: 0,
  };
}

/** Balances are DERIVED. There is no stored balance to drift. */
export function deriveBalances(entries: readonly LedgerEntry[]): Balances {
  const b = emptyBalances();
  for (const e of entries) b[e.account] += e.amountMinor;
  return b;
}

/** The books balance when every account sums to zero. */
export function isBalanced(entries: readonly LedgerEntry[]): boolean {
  return sum(entries.map((e) => e.amountMinor)) === 0;
}

function entry(
  orderId: string, restaurantId: string, kind: EntryKind, account: Account,
  amountMinor: Minor, nowMs: number, createdBy: string, note = "", seq = 0
): LedgerEntry {
  return {
    entryId: `${orderId}__${kind}__${account}${seq ? `__${seq}` : ""}`,
    orderId, restaurantId, currency: "NGN", kind, account,
    amountMinor, createdAt: nowMs, createdBy, note,
  };
}

/**
 * The entry set for a captured payment.
 *
 * Reads as double-entry: the customer account is debited the full amount they
 * paid, and that same amount is distributed across everyone with a claim on it.
 * The set sums to zero by construction, and `checkInvariants` on the snapshot
 * has already proven the numbers agree before we get here.
 */
export function entriesForPayment(args: {
  orderId: string;
  restaurantId: string;
  snapshot: PriceSnapshot;
  nowMs: number;
  createdBy: string;
}): LedgerEntry[] {
  const { orderId: o, restaurantId: r, snapshot: s, nowMs: t, createdBy: by } = args;
  const e = (k: EntryKind, a: Account, amt: Minor, note = "") => entry(o, r, k, a, amt, t, by, note);

  const out: LedgerEntry[] = [
    // Money in, from the customer.
    e("customer_payment", "customer", -s.totalChargedMinor, "customer paid"),
    // …and where it goes.
    e("food_base", "restaurant_payable", s.restaurantPayableMinor, "restaurant food payable"),
    e("delivery_cost", "delivery_payable", s.deliveryPayableMinor, "owed to Dispatcher"),
    e("processor_fee", "processor", s.processorFeeMinor, "payment provider"),
    e("tax", "tax_payable", s.taxMinor, "tax collected"),
    e("markup", "platform_revenue", s.platformGrossMinor, "platform gross"),
  ];

  return out.filter((x) => x.amountMinor !== 0);
}

export type RefundKind = "full" | "food_only" | "delivery_only";

/**
 * Refund entries.
 *
 * A refund NEVER edits the original snapshot or the entries that recorded it.
 * It appends opposing rows, so the history reads as what actually happened: we
 * charged, then we gave some back.
 *
 * Who absorbs it is deliberately explicit. A restaurant rejection refunds the
 * food from the restaurant's payable; a delivery failure after pickup does not,
 * because the kitchen cooked it. That is a commercial decision (§D5 of the
 * audit) and it belongs in the caller, not hidden in a default here.
 */
export function entriesForRefund(args: {
  orderId: string;
  restaurantId: string;
  snapshot: PriceSnapshot;
  kind: RefundKind;
  /** Which accounts give the money back. Must be stated, never assumed. */
  absorbedBy: { restaurantMinor: Minor; platformMinor: Minor; deliveryMinor: Minor };
  nowMs: number;
  createdBy: string;
  reason: string;
  /** Distinguishes a second partial refund from a replay of the first. */
  seq: number;
}): LedgerEntry[] {
  const { orderId: o, restaurantId: r, nowMs: t, createdBy: by, reason, seq } = args;
  const total =
    args.absorbedBy.restaurantMinor + args.absorbedBy.platformMinor + args.absorbedBy.deliveryMinor;

  const kind: EntryKind =
    args.kind === "full" ? "refund_full" : args.kind === "food_only" ? "refund_food" : "refund_delivery";

  const out: LedgerEntry[] = [
    entry(o, r, kind, "customer", total, t, by, reason, seq),
    entry(o, r, kind, "restaurant_payable", -args.absorbedBy.restaurantMinor, t, by, reason, seq),
    entry(o, r, kind, "platform_revenue", -args.absorbedBy.platformMinor, t, by, reason, seq),
    entry(o, r, kind, "delivery_payable", -args.absorbedBy.deliveryMinor, t, by, reason, seq),
  ];
  return out.filter((x) => x.amountMinor !== 0);
}

/** A manual correction. Always paired, always attributed, never a silent edit. */
export function entriesForAdjustment(args: {
  orderId: string; restaurantId: string;
  from: Account; to: Account; amountMinor: Minor;
  nowMs: number; createdBy: string; reason: string; seq: number;
}): LedgerEntry[] {
  const { orderId: o, restaurantId: r, nowMs: t, createdBy: by, reason, seq } = args;
  return [
    entry(o, r, "adjustment", args.from, -args.amountMinor, t, by, reason, seq),
    entry(o, r, "adjustment", args.to, args.amountMinor, t, by, reason, seq * 1000 + 1),
  ];
}

/** The commercial answer to "what happened with this order?" */
export type OrderFinancials = {
  customerPaidMinor: Minor;
  restaurantOwedMinor: Minor;
  deliveryOwedMinor: Minor;
  processorCostMinor: Minor;
  discountCostMinor: Minor;
  platformGrossMinor: Minor;
  refundedMinor: Minor;
  settlementOutstandingMinor: Minor;
  balanced: boolean;
};

export function summarise(entries: readonly LedgerEntry[], snapshot: PriceSnapshot): OrderFinancials {
  const b = deriveBalances(entries);
  const refunded = sum(
    entries.filter((e) => e.account === "customer" && e.amountMinor > 0).map((e) => e.amountMinor)
  );
  // The customer account holds −(charged) plus +(refunds), so its balance is
  // the NET. Gross paid is that net with the refunds added back.
  const netFromCustomer = -b.customer;
  const grossPaid = netFromCustomer + refunded;

  return {
    customerPaidMinor: grossPaid,
    restaurantOwedMinor: b.restaurant_payable,
    deliveryOwedMinor: b.delivery_payable,
    processorCostMinor: b.processor,
    discountCostMinor: snapshot.discountTotalMinor,
    platformGrossMinor: b.platform_revenue,
    refundedMinor: refunded,
    // What is still owed after any payout already made. A settlement payout
    // debits restaurant_payable, so the remaining balance IS the outstanding
    // amount — there is no separate figure to keep in step.
    settlementOutstandingMinor: b.restaurant_payable,
    balanced: isBalanced(entries),
  };
}

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
