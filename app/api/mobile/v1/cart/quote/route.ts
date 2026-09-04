import { getAdminDb } from "@/lib/firebase-admin";
import { withCustomer, badRequest, unprocessable } from "@/lib/marketplace/mobile-api";
import { addressesRef } from "@/lib/marketplace/customer";
import { quoteCart, type QuoteLineRequest } from "@/lib/marketplace/quote";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The price of a cart.
 *
 * The request carries item ids, quantities, chosen option ids and an ADDRESS
 * ID — never a price and never coordinates. The address is resolved from the
 * caller's own subcollection, so a customer cannot quote a delivery to
 * somebody else's home to discover where they live.
 */
export const POST = withCustomer(async ({ customer, req }) => {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return badRequest("Invalid request body");

  const { restaurantSlug, addressId, lines } = body as Record<string, unknown>;

  if (typeof restaurantSlug !== "string" || !restaurantSlug.trim()) {
    return badRequest("Choose a restaurant.");
  }
  if (!Array.isArray(lines)) return badRequest("Your cart is empty.");
  if (typeof addressId !== "string" || !addressId) {
    return unprocessable("Choose where we should deliver.", { code: "NO_ADDRESS" });
  }

  const db = getAdminDb();

  const addressSnap = await addressesRef(db, customer.id).doc(addressId).get();
  if (!addressSnap.exists) {
    // Somebody else's address id resolves to nothing, exactly like a
    // non-existent one.
    return unprocessable("We couldn't find that address.", { code: "NO_ADDRESS" });
  }
  const address = addressSnap.data() as { location: { lat: number; lng: number } };

  const result = await quoteCart({
    db,
    restaurantSlug: restaurantSlug.trim(),
    lines: lines as QuoteLineRequest[],
    dropoff: address.location,
    nowMs: Date.now(),
  });

  if (!result.ok) return unprocessable(result.error, { code: "QUOTE_FAILED" });

  if (!result.serviceable) {
    return {
      serviceable: false, reason: result.reason, code: result.code,
      subtotalMinor: 0, deliveryFeeMinor: 0, discountMinor: 0, taxMinor: 0,
      totalMinor: 0, etaMins: null, quoteId: null, expiresAt: null,
    };
  }

  const s = result.snapshot;
  // Only the figures the customer needs. The restaurant's subtotal, the markup
  // and the platform margin stay on the server.
  return {
    serviceable: true,
    reason: null,
    subtotalMinor: s.customerSubtotalMinor,
    deliveryFeeMinor: s.deliveryFeeMinor,
    discountMinor: s.discountTotalMinor,
    taxMinor: s.taxMinor,
    totalMinor: s.totalChargedMinor,
    etaMins: result.etaMins,
    quoteId: result.quoteId,
    expiresAt: result.expiresAt,
  };
});
