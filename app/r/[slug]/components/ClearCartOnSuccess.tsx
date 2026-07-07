"use client";

import { useEffect } from "react";
import { clearStoredCart } from "./cart-storage";

/**
 * Clears the slug-scoped persisted cart once, on mount. Rendered only on the
 * Paystack payment-callback page when payment succeeded — the online-payment
 * flow deliberately does NOT clear the cart before redirecting to Paystack, so
 * an abandoned payment keeps the cart intact. It is cleared only here, after a
 * confirmed successful charge + order creation.
 */
export default function ClearCartOnSuccess({ slug }: { slug: string }) {
  useEffect(() => {
    clearStoredCart(slug);
  }, [slug]);
  return null;
}
