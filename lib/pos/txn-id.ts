/**
 * POS transaction key minting.
 *
 * The lifecycle of a transaction's `localOrderId` — creation, persistence across
 * reload and browser restart, per-tab isolation, recovery and retirement — lives
 * in ./draft.ts. This module only mints the value.
 */

/**
 * Mints a fresh transaction key.
 *
 * Prefers `crypto.randomUUID`: this value is the server's uniqueness key, so two
 * terminals in one restaurant colliding on it would make a genuine order look
 * like a conflicting replay of another. Weak entropy is no longer cosmetic.
 */
export function mintTxnId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `txn-${crypto.randomUUID()}`;
  }
  const rand = () => Math.random().toString(36).substring(2, 12);
  return `txn-${rand()}${rand()}-${Date.now()}`;
}

/** Mints a key for a queue record that somehow lacks one. */
export function newPosTxnId(): string {
  return mintTxnId();
}
