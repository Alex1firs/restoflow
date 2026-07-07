// Slug-scoped, TTL-bounded cart persistence for restaurant storefronts.
//
// This is a plain module (no React) so the CartContext and the Paystack payment
// callback page can share the EXACT same storage key format. Every access is
// guarded (`typeof window`) and wrapped in try/catch — a persistence failure
// (private mode, quota, disabled storage) must NEVER block cart, checkout, or
// payment. It degrades silently to the previous in-memory behaviour.

export type CartItem = {
  id: string;
  name: string;
  price: number;
  quantity: number;
};

// Versioned + namespaced. The slug is part of the key so two restaurants opened
// on the same device (e.g. sequential subdomains) can never share a cart.
const KEY_PREFIX = "restoflow_cart:v1:";

// Carts expire so a stale cart (old prices / now-unavailable items) doesn't
// linger for days. Prices are always re-validated server-side at order time,
// but 24h keeps the UX honest.
const TTL_MS = 24 * 60 * 60 * 1000;

type StoredCart = { items: CartItem[]; expiresAt: number };

export function cartStorageKey(slug: string): string {
  return `${KEY_PREFIX}${slug}`;
}

function isValidItem(x: unknown): x is CartItem {
  if (!x || typeof x !== "object") return false;
  const i = x as Record<string, unknown>;
  return (
    typeof i.id === "string" && i.id.length > 0 &&
    typeof i.name === "string" &&
    typeof i.price === "number" && Number.isFinite(i.price) &&
    typeof i.quantity === "number" && Number.isInteger(i.quantity) && i.quantity > 0
  );
}

/** Read the persisted cart for a slug. Returns [] if absent, expired, or malformed. */
export function loadCart(slug: string): CartItem[] {
  if (typeof window === "undefined" || !slug) return [];
  const key = cartStorageKey(slug);
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<StoredCart> | null;
    if (!parsed || !Array.isArray(parsed.items) || typeof parsed.expiresAt !== "number") {
      window.localStorage.removeItem(key);
      return [];
    }
    if (Date.now() > parsed.expiresAt) {
      window.localStorage.removeItem(key);
      return [];
    }
    return parsed.items.filter(isValidItem);
  } catch {
    return [];
  }
}

/** Persist the cart for a slug. An empty cart removes the key entirely. */
export function saveCart(slug: string, items: CartItem[]): void {
  if (typeof window === "undefined" || !slug) return;
  const key = cartStorageKey(slug);
  try {
    if (!items || items.length === 0) {
      window.localStorage.removeItem(key);
      return;
    }
    const payload: StoredCart = { items, expiresAt: Date.now() + TTL_MS };
    window.localStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // best-effort — ignore quota / private-mode write failures
  }
}

/** Remove the persisted cart for a slug (used after a confirmed order/payment). */
export function clearStoredCart(slug: string): void {
  if (typeof window === "undefined" || !slug) return;
  try {
    window.localStorage.removeItem(cartStorageKey(slug));
  } catch {
    // ignore
  }
}
