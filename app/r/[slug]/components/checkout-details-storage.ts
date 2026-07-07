// Slug-scoped, consent-gated checkout-detail persistence for storefronts.
//
// A CONVENIENCE CACHE ONLY — it lets a returning customer skip retyping their
// name / phone / delivery address when they order again from the SAME restaurant.
// It is explicitly NOT an account: no login, no OTP, no Firestore profile, no
// session token, no cross-restaurant identity. Everything lives in this browser's
// localStorage, namespaced per restaurant slug, and is written only after the
// customer opts in via the checkout checkbox.
//
// Hard privacy rule: this module NEVER stores payment credentials, Paystack
// references, order IDs, or auth/session tokens. `saveCheckoutDetails` rebuilds
// the persisted object field-by-field from a FIXED ALLOWLIST (see `sanitize`), so
// handing it a larger object can never leak extra data to disk. Same guard runs
// on read, so a tampered/legacy blob can't reintroduce disallowed fields.

export type SavedFulfillment = "delivery" | "pickup" | "dine_in";
export type SavedPayment = "online" | "cash" | "whatsapp";

export type SavedCheckoutDetails = {
  fullName?: string;
  phone?: string;
  address?: string;      // delivery address (free text)
  area?: string;         // area/city if kept separate (delivery zone id)
  apartment?: string;    // apartment/suite if present
  instructions?: string; // delivery instructions / note
  fulfillment?: SavedFulfillment;
  payment?: SavedPayment;
};

// Versioned + namespaced by slug so Food Kapitol's details can never surface on
// Tricia's Kitchen. Bumping v1 invalidates all prior blobs.
const KEY_PREFIX = "restoflow_checkout_details:v1:";

// Contact details don't go stale like cart prices, but an unbounded PII cache on
// a potentially shared device is undesirable — expire after ~180 days.
const TTL_MS = 180 * 24 * 60 * 60 * 1000;

// Reject pathologically large strings (quota abuse / accidental blobs).
const MAX_LEN = 500;

const FULFILLMENTS: readonly SavedFulfillment[] = ["delivery", "pickup", "dine_in"];
const PAYMENTS: readonly SavedPayment[] = ["online", "cash", "whatsapp"];

type Stored = { details: SavedCheckoutDetails; expiresAt: number };

export function checkoutDetailsKey(slug: string): string {
  return `${KEY_PREFIX}${slug}`;
}

function cleanStr(x: unknown): string | undefined {
  if (typeof x !== "string") return undefined;
  const s = x.trim();
  if (!s) return undefined;
  return s.slice(0, MAX_LEN);
}

// The core privacy safeguard: build a fresh object naming ONLY allowlisted,
// non-sensitive checkout-convenience fields. Any other property on `input`
// (card data, references, tokens, order IDs, …) is silently discarded.
function sanitize(input: SavedCheckoutDetails | null | undefined): SavedCheckoutDetails {
  const out: SavedCheckoutDetails = {};
  if (!input || typeof input !== "object") return out;
  const fullName = cleanStr(input.fullName); if (fullName) out.fullName = fullName;
  const phone = cleanStr(input.phone); if (phone) out.phone = phone;
  const address = cleanStr(input.address); if (address) out.address = address;
  const area = cleanStr(input.area); if (area) out.area = area;
  const apartment = cleanStr(input.apartment); if (apartment) out.apartment = apartment;
  const instructions = cleanStr(input.instructions); if (instructions) out.instructions = instructions;
  if (input.fulfillment && FULFILLMENTS.includes(input.fulfillment)) out.fulfillment = input.fulfillment;
  if (input.payment && PAYMENTS.includes(input.payment)) out.payment = input.payment;
  return out;
}

export type LoadOptions = {
  // If provided, a saved preference not in the list is dropped (option no longer
  // offered by this restaurant) — the rest of the details still restore.
  allowedFulfillment?: readonly SavedFulfillment[];
  allowedPayment?: readonly SavedPayment[];
};

/** Read saved details for a slug. Returns null if absent, expired, malformed, or empty. */
export function loadCheckoutDetails(slug: string, opts: LoadOptions = {}): SavedCheckoutDetails | null {
  if (typeof window === "undefined" || !slug) return null;
  const key = checkoutDetailsKey(slug);
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Stored> | null;
    if (!parsed || typeof parsed.expiresAt !== "number" || !parsed.details) {
      window.localStorage.removeItem(key);
      return null;
    }
    if (Date.now() > parsed.expiresAt) {
      window.localStorage.removeItem(key);
      return null;
    }
    const details = sanitize(parsed.details);
    // Drop a preferred fulfillment/payment that is no longer enabled.
    if (details.fulfillment && opts.allowedFulfillment && !opts.allowedFulfillment.includes(details.fulfillment)) {
      delete details.fulfillment;
    }
    if (details.payment && opts.allowedPayment && !opts.allowedPayment.includes(details.payment)) {
      delete details.payment;
    }
    return Object.keys(details).length ? details : null;
  } catch {
    return null;
  }
}

/** Persist consent-gated details for a slug. A wholly-empty payload removes the key. */
export function saveCheckoutDetails(slug: string, details: SavedCheckoutDetails): void {
  if (typeof window === "undefined" || !slug) return;
  const key = checkoutDetailsKey(slug);
  try {
    const clean = sanitize(details);
    if (Object.keys(clean).length === 0) {
      window.localStorage.removeItem(key);
      return;
    }
    const payload: Stored = { details: clean, expiresAt: Date.now() + TTL_MS };
    window.localStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // best-effort — ignore quota / private-mode write failures
  }
}

/** Remove saved details for THIS slug only (leaves other restaurants untouched). */
export function clearCheckoutDetails(slug: string): void {
  if (typeof window === "undefined" || !slug) return;
  try {
    window.localStorage.removeItem(checkoutDetailsKey(slug));
  } catch {
    // ignore
  }
}

/** Cheap presence check — whether any saved details exist for this slug. */
export function hasSavedCheckoutDetails(slug: string): boolean {
  return loadCheckoutDetails(slug) !== null;
}
