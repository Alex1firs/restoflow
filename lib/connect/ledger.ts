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
 *   partner_receivable  +price    what the partner owes RestoFlow
 *   delivery_payable    −cost     what RestoFlow owes Dispatcher
 *   connect_revenue     −margin   what RestoFlow keeps
 *
 * Signs follow the marketplace convention: a positive entry is money owed TO
 * the platform, a negative is money owed BY it.
 */
export const CONNECT_ACCOUNTS = [
  "partner_receivable",
  "delivery_payable",
  "connect_revenue",
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
  createdAtMs: number;
};

export function connectEntries(args: {
  deliveryId: string;
  restaurantId: string;
  price: ConnectPrice;
  nowMs: number;
}): ConnectLedgerEntry[] {
  const { deliveryId, restaurantId, price, nowMs } = args;
  const reason = "delivery_requested";
  const e = (account: ConnectAccount, amountMinor: number, note: string): ConnectLedgerEntry => ({
    id: `${deliveryId}__${reason}__${account}`,
    deliveryId,
    restaurantId,
    account,
    amountMinor,
    reason: note,
    createdAtMs: nowMs,
  });

  return [
    e("partner_receivable", price.partnerPriceMinor, "owed by the partner"),
    e("delivery_payable", -price.dispatcherCostMinor, "owed to Dispatcher"),
    e("connect_revenue", -price.marginMinor, "RestoFlow logistics margin"),
  ];
}

/** A ledger that does not sum to zero is not a ledger. */
export function connectBalance(entries: ConnectLedgerEntry[]): number {
  return entries.reduce((sum, x) => sum + x.amountMinor, 0);
}
