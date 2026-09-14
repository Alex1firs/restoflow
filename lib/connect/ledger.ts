import type { ConnectPrice } from "./pricing";

/**
 * The books for one Connect delivery.
 *
 * ── Why not the marketplace ledger ───────────────────────────────────────────
 * That one has five entries and starts from a customer payment RestoFlow
 * collected — customer, restaurant_payable, platform_revenue, processor,
 * delivery_payable. A Connect delivery has no customer payment: the partner
 * took the money on WhatsApp, in cash, or through its own POS, and RestoFlow
 * never touches it. Reusing that shape would mean inventing a customer entry
 * for money that did not move, which is how a ledger stops meaning anything.
 *
 * So three entries, and they still sum to zero:
 *
 *   payment_received    +price    what the payer actually paid
 *   delivery_payable    −cost     what RestoFlow owes Dispatcher
 *   connect_revenue     −margin   what RestoFlow keeps
 *
 * ── Payer is a dimension, not a second ledger ────────────────────────────────
 * Whether the customer or the restaurant paid changes who the money came from,
 * not what happened to it. Two ledger shapes for one event would mean every
 * report had to know about both, and the day one of them gained an entry the
 * other would quietly disagree. So `payer` rides on the entry.
 *
 * Signs follow the marketplace convention: a positive entry is money owed TO
 * the platform, a negative is money owed BY it.
 */
export const CONNECT_ACCOUNTS = [
  /** Money actually received, from whichever party paid. */
  "payment_received",
  "delivery_payable",
  "connect_revenue",
  /**
   * Retained for the future Enterprise invoiced path only.
   *
   * It was the right account when Connect was going to bill a prepaid partner.
   * Under customer-paid-per-delivery the money arrives BEFORE the courier is
   * requested, so there is nothing owing and a receivable would be a debt
   * nobody has.
   */
  "partner_receivable",
] as const;
export type ConnectAccount = (typeof CONNECT_ACCOUNTS)[number];

export type ConnectLedgerEntry = {
  /** Deterministic: `<deliveryId>__<reason>__<account>`. Replays collide, never duplicate. */
  id: string;
  deliveryId: string;
  restaurantId: string;
  account: ConnectAccount;
  amountMinor: number;
  reason: string;
  /** Accounting dimension: who the money came from. */
  payer: "customer" | "restaurant";
  createdAtMs: number;
};

export function connectEntries(args: {
  deliveryId: string;
  restaurantId: string;
  price: ConnectPrice;
  payer: "customer" | "restaurant";
  nowMs: number;
}): ConnectLedgerEntry[] {
  const { deliveryId, restaurantId, price, payer, nowMs } = args;
  const reason = "delivery_paid";
  const e = (account: ConnectAccount, amountMinor: number, note: string): ConnectLedgerEntry => ({
    id: `${deliveryId}__${reason}__${account}`,
    deliveryId,
    restaurantId,
    account,
    amountMinor,
    reason: note,
    payer,
    createdAtMs: nowMs,
  });

  return [
    e("payment_received", price.partnerPriceMinor, `paid by the ${payer}`),
    e("delivery_payable", -price.dispatcherCostMinor, "owed to Dispatcher"),
    e("connect_revenue", -price.marginMinor, "RestoFlow logistics margin"),
  ];
}

/**
 * Reverse a paid delivery that produced no courier.
 *
 * Not a negative of the original rows on their own ids — that would overwrite
 * them, because the ids are deterministic. A refund is its own event with its
 * own reason, so the history keeps both: money came in, money went back.
 */
export function connectRefundEntries(args: {
  deliveryId: string;
  restaurantId: string;
  price: ConnectPrice;
  payer: "customer" | "restaurant";
  nowMs: number;
}): ConnectLedgerEntry[] {
  const { deliveryId, restaurantId, price, payer, nowMs } = args;
  const reason = "delivery_refunded";
  const e = (account: ConnectAccount, amountMinor: number, note: string): ConnectLedgerEntry => ({
    id: `${deliveryId}__${reason}__${account}`,
    deliveryId, restaurantId, account, amountMinor, reason: note, payer, createdAtMs: nowMs,
  });

  return [
    e("payment_received", -price.partnerPriceMinor, `refunded to the ${payer}`),
    e("delivery_payable", price.dispatcherCostMinor, "no courier was engaged"),
    e("connect_revenue", price.marginMinor, "margin reversed"),
  ];
}

/** A ledger that does not sum to zero is not a ledger. */
export function connectBalance(entries: ConnectLedgerEntry[]): number {
  return entries.reduce((sum, x) => sum + x.amountMinor, 0);
}
