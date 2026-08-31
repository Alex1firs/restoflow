/**
 * Restaurant and courier settlement.
 *
 * ── Deliberately not automatic ───────────────────────────────────────────────
 * A payout is the one operation with no undo. The state machine below has a
 * human gate at APPROVED on purpose, and scheduled production payouts stay
 * disabled until separately approved. Everything here is built so that turning
 * automation on later is a policy change, not a rewrite.
 *
 * ── Why a payout is a reservation ────────────────────────────────────────────
 * Same shape as refunds, same reason: a transfer call can time out having
 * succeeded, and retrying a "failed" transfer pays a restaurant twice. So the
 * payout is claimed before the provider is called, and a timeout leaves it
 * PAYOUT_PENDING for reconciliation rather than releasing it.
 *
 * Pure over ports.
 */

import type { Minor } from "./pricing";
import type { LedgerEntry, Account } from "./ledger";
import { deriveBalances } from "./ledger";

export const SETTLEMENT_STATES = [
  "CALCULATED",      // the period is closed and the amount is known
  "APPROVED",        // a human has signed it off
  "PAYOUT_PENDING",  // the provider has been asked; outcome unknown
  "PAID",
  "FAILED",
  "NEEDS_ATTENTION", // a divergence a person must look at
] as const;
export type SettlementState = (typeof SETTLEMENT_STATES)[number];

export type Payee = "restaurant" | "courier_provider";

export type Settlement = {
  settlementId: string;
  payee: Payee;
  /** Restaurant slug, or the logistics provider's id. */
  payeeId: string;
  periodStart: number;
  periodEnd: number;
  orderIds: string[];
  grossMinor: Minor;
  refundsMinor: Minor;
  adjustmentsMinor: Minor;
  netPayableMinor: Minor;
  state: SettlementState;
  providerReference: string | null;
  approvedBy: string | null;
  approvedAt: number | null;
  paidAt: number | null;
  failureReason: string | null;
  createdAt: number;
};

const ALLOWED: Record<SettlementState, SettlementState[]> = {
  CALCULATED: ["APPROVED", "NEEDS_ATTENTION"],
  APPROVED: ["PAYOUT_PENDING", "NEEDS_ATTENTION"],
  PAYOUT_PENDING: ["PAID", "FAILED", "NEEDS_ATTENTION"],
  // Terminal. A paid settlement is never reopened; a correction is a new
  // adjustment entry in the next period, which is what keeps history honest.
  PAID: [],
  FAILED: ["APPROVED", "NEEDS_ATTENTION"],
  NEEDS_ATTENTION: ["APPROVED", "FAILED"],
};

export function canTransition(from: SettlementState, to: SettlementState): boolean {
  return ALLOWED[from].includes(to);
}

/**
 * Compute what a payee is owed for a period, from ledger entries alone.
 *
 * Refunds are already opposing entries, so they reduce the payable simply by
 * being summed — there is no separate subtraction to forget. A settlement is a
 * view over history, never a number somebody typed.
 */
export function calculateSettlement(args: {
  settlementId: string;
  payee: Payee;
  payeeId: string;
  periodStart: number;
  periodEnd: number;
  entries: readonly LedgerEntry[];
  nowMs: number;
}): Settlement {
  const account: Account = args.payee === "restaurant" ? "restaurant_payable" : "delivery_payable";

  const inPeriod = args.entries.filter(
    (e) => e.account === account && e.createdAt >= args.periodStart && e.createdAt < args.periodEnd
  );

  const gross = sum(inPeriod.filter((e) => e.amountMinor > 0).map((e) => e.amountMinor));
  const refunds = sum(
    inPeriod.filter((e) => e.amountMinor < 0 && e.kind.startsWith("refund")).map((e) => -e.amountMinor)
  );
  const adjustments = sum(
    inPeriod.filter((e) => e.amountMinor < 0 && e.kind === "adjustment").map((e) => -e.amountMinor)
  );
  // A payout already made in this period must not be counted as still owed.
  const paidOut = sum(
    inPeriod.filter((e) => e.kind === "settlement_payout").map((e) => -e.amountMinor)
  );

  const net = gross - refunds - adjustments - paidOut;

  return {
    settlementId: args.settlementId,
    payee: args.payee,
    payeeId: args.payeeId,
    periodStart: args.periodStart,
    periodEnd: args.periodEnd,
    orderIds: [...new Set(inPeriod.map((e) => e.orderId))],
    grossMinor: gross,
    refundsMinor: refunds,
    adjustmentsMinor: adjustments,
    netPayableMinor: net,
    // A negative or zero net needs a person: a payee who owes US money is not
    // something to resolve by transferring a negative amount.
    state: net > 0 ? "CALCULATED" : "NEEDS_ATTENTION",
    providerReference: null,
    approvedBy: null, approvedAt: null, paidAt: null, failureReason: null,
    createdAt: args.nowMs,
  };
}

/** What is still owed right now, ignoring periods. Drives the ops board. */
export function outstandingFor(entries: readonly LedgerEntry[], payee: Payee): Minor {
  const b = deriveBalances(entries);
  return payee === "restaurant" ? b.restaurant_payable : b.delivery_payable;
}

// ── Execution ───────────────────────────────────────────────────────────────

export type PayoutAttempt = {
  status: "succeeded" | "failed" | "pending";
  providerReference: string | null;
  failureReason: string | null;
};

export type SettlementStore = {
  get(settlementId: string): Promise<Settlement | null>;
  /** Compare-and-set on state. Returns false when somebody moved it first. */
  transition(settlementId: string, from: SettlementState, to: SettlementState, patch: Partial<Settlement>): Promise<boolean>;
  /** The ledger entries that record the money leaving. */
  appendPayoutEntries(entries: LedgerEntry[]): Promise<void>;
};

export type PayoutResult =
  | { outcome: "paid"; providerReference: string | null }
  | { outcome: "already_paid"; providerReference: string | null }
  | { outcome: "pending" }
  | { outcome: "failed"; reason: string }
  | { outcome: "refused"; reason: string };

/**
 * Pay a settlement.
 *
 * The compare-and-set into PAYOUT_PENDING is the guard: two operators clicking
 * Pay at the same moment produce one transfer, because only one of them can
 * make that transition.
 */
export async function executePayout(args: {
  settlementId: string;
  store: SettlementStore;
  callProvider: (a: { settlement: Settlement }) => Promise<PayoutAttempt>;
  buildEntries: (s: Settlement, nowMs: number) => LedgerEntry[];
  nowMs: number;
  log?: (event: string, fields: Record<string, unknown>) => void;
}): Promise<PayoutResult> {
  const log = args.log ?? (() => {});
  const settlement = await args.store.get(args.settlementId);
  if (!settlement) return { outcome: "refused", reason: "settlement not found" };

  if (settlement.state === "PAID") {
    // Idempotent by state, not by hope.
    return { outcome: "already_paid", providerReference: settlement.providerReference };
  }
  if (settlement.state === "PAYOUT_PENDING") {
    return { outcome: "pending" };
  }
  if (settlement.state !== "APPROVED") {
    return { outcome: "refused", reason: `a ${settlement.state} settlement cannot be paid — it must be APPROVED first` };
  }
  if (settlement.netPayableMinor <= 0) {
    return { outcome: "refused", reason: "nothing to pay" };
  }

  const reserved = await args.store.transition(args.settlementId, "APPROVED", "PAYOUT_PENDING", {});
  if (!reserved) {
    // Somebody else won the race and is paying it right now.
    return { outcome: "pending" };
  }

  let attempt: PayoutAttempt;
  try {
    attempt = await args.callProvider({ settlement });
  } catch (err) {
    // Unknown. Stays PAYOUT_PENDING for reconciliation — releasing it back to
    // APPROVED is how a restaurant gets paid twice.
    log("payout_provider_error", { settlementId: args.settlementId, error: String(err) });
    return { outcome: "pending" };
  }

  if (attempt.status === "pending") return { outcome: "pending" };

  if (attempt.status === "failed") {
    await args.store.transition(args.settlementId, "PAYOUT_PENDING", "FAILED", {
      failureReason: attempt.failureReason, providerReference: attempt.providerReference,
    });
    return { outcome: "failed", reason: attempt.failureReason ?? "provider declined" };
  }

  // The money moved. Record it in the ledger BEFORE marking paid, so a crash
  // between the two leaves a settlement that looks unpaid with entries that
  // say otherwise — visible and reconcilable — rather than the reverse.
  await args.store.appendPayoutEntries(args.buildEntries(settlement, args.nowMs));
  await args.store.transition(args.settlementId, "PAYOUT_PENDING", "PAID", {
    providerReference: attempt.providerReference, paidAt: args.nowMs,
  });

  log("payout_paid", {
    settlementId: args.settlementId, payee: settlement.payee,
    amountMinor: settlement.netPayableMinor, providerReference: attempt.providerReference,
  });

  return { outcome: "paid", providerReference: attempt.providerReference };
}

/** Ledger entries recording a payout. Debits the payable, credits nothing new. */
export function payoutEntries(s: Settlement, nowMs: number): LedgerEntry[] {
  const account: Account = s.payee === "restaurant" ? "restaurant_payable" : "delivery_payable";
  const base = {
    orderId: `settlement:${s.settlementId}`,
    restaurantId: s.payee === "restaurant" ? s.payeeId : "",
    currency: "NGN" as const,
    kind: "settlement_payout" as const,
    createdAt: nowMs,
    createdBy: "payout-run",
    note: `${s.payee} settlement ${s.settlementId}`,
  };
  return [
    { ...base, entryId: `${s.settlementId}__payout__${account}`, account, amountMinor: -s.netPayableMinor },
    { ...base, entryId: `${s.settlementId}__payout__platform_revenue`, account: "platform_revenue", amountMinor: s.netPayableMinor },
  ];
}

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
