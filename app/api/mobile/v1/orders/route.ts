import { getAdminDb } from "@/lib/firebase-admin";
import { withCustomer, badRequest, unprocessable } from "@/lib/marketplace/mobile-api";
import { addressesRef, toPublicAddress } from "@/lib/marketplace/customer";
import { quoteCart, type QuoteLineRequest } from "@/lib/marketplace/quote";
import { FirestoreMarketplaceStore } from "@/lib/marketplace/store";
import { INTENT_TTL_MS, type PaymentIntent } from "@/lib/marketplace/payment";
import { serverEnv } from "@/lib/env";
import { randomUUID } from "crypto";
import { toCustomerOrderSummary } from "@/lib/marketplace/customer-view";
import { resolveRestaurantNames } from "@/lib/marketplace/restaurant-names";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The caller's own orders.
 *
 * Scoped by `customerId == the verified token's uid`. There is no query
 * parameter that could widen it, and no route that lists orders generally.
 */
export const GET = withCustomer(async ({ customer }) => {
  const snap = await getAdminDb()
    .collection("orders")
    .where("orderSource", "==", "marketplace")
    .where("customerId", "==", customer.id)
    .orderBy("createdAtMs", "desc")
    .limit(50)
    .get();

  const rows = snap.docs.map((d) => ({ id: d.id, data: d.data() ?? {} }));

  // Only historic orders need this; ones placed since the name is frozen at
  // checkout already carry it.
  const missing = rows.filter((r) => !r.data.restaurantName).map((r) => String(r.data.restaurantId ?? ""));
  const names = await resolveRestaurantNames(getAdminDb(), missing);

  return rows.map((r) => toCustomerOrderSummary(r.id, r.data, names.get(String(r.data.restaurantId ?? "")) ?? null));
});

/**
 * Checkout.
 *
 * This route does NOT create an order. It re-prices the cart server-side and
 * parks the result as a payment intent keyed on a fresh reference; the order
 * comes into existence only when money actually arrives, in the single
 * transaction inside `materialiseOrder`. That is why a customer can press pay
 * twice, lose the network, and come back later without ever ending up with two
 * orders.
 *
 * The cart is re-priced here rather than trusting the quote the app is
 * holding. A quote is a display; this is the number that gets charged, and the
 * two must be computed the same way from the same source.
 */
/** Reserved TLDs that can never receive mail (RFC 2606 / RFC 6761). */
const UNDELIVERABLE_TLDS = [".invalid", ".test", ".example", ".localhost"];

function paystackEmailFor(email: string | null): string {
  if (!email) return "orders@restoflow.app";
  const lower = email.toLowerCase();
  if (UNDELIVERABLE_TLDS.some((t) => lower.endsWith(t))) return "orders@restoflow.app";
  return email;
}

export const POST = withCustomer(async ({ customer, req }) => {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return badRequest("Invalid request body");

  const { restaurantSlug, addressId, lines, note } = body as Record<string, unknown>;
  if (typeof restaurantSlug !== "string" || !restaurantSlug.trim()) return badRequest("Choose a restaurant.");
  if (!Array.isArray(lines) || lines.length === 0) return badRequest("Your cart is empty.");
  if (typeof addressId !== "string" || !addressId) return unprocessable("Choose where we should deliver.", { code: "NO_ADDRESS" });

  const db = getAdminDb();
  const addressSnap = await addressesRef(db, customer.id).doc(addressId).get();
  if (!addressSnap.exists) return unprocessable("We couldn't find that address.", { code: "NO_ADDRESS" });
  const address = toPublicAddress(addressSnap.id, addressSnap.data() ?? {});

  const nowMs = Date.now();
  const correlationId = `mp-${randomUUID().slice(0, 12)}`;
  const quote = await quoteCart({
    db,
    restaurantSlug: restaurantSlug.trim(),
    lines: lines as QuoteLineRequest[],
    dropoff: address.location,
    nowMs,
    correlationId,
  });

  if (!quote.ok) return unprocessable(quote.error, { code: "QUOTE_FAILED" });
  if (!quote.serviceable) return unprocessable(quote.reason, { code: quote.code });

  // A phone number is required to place an order — a courier has to be able to
  // reach somebody at the door.
  if (!customer.phone) return unprocessable("Add a phone number before ordering.", { code: "NO_PHONE" });

  const reference = `MPR-${randomUUID().replace(/-/g, "").slice(0, 20).toUpperCase()}`;
  const intent: PaymentIntent = {
    reference,
    restaurantId: restaurantSlug.trim(),
    restaurantName: quote.restaurantName,
    customerId: customer.id,
    customerFirstName: customer.name.split(" ")[0] || "Customer",
    customerPhone: customer.phone,
    deliveryAddress: address.line1,
    deliveryLocation: address.location,
    note: typeof note === "string" ? note.slice(0, 500) : "",
    items: quote.items,
    pricing: quote.snapshot,
    quoteId: quote.quoteId,
    prepMins: quote.prepMins,
    correlationId,
    createdAt: nowMs,
    expiresAt: nowMs + INTENT_TTL_MS,
  };

  // Written BEFORE the provider is called, deliberately.
  //
  // If Paystack succeeds and this write had not happened, the customer could
  // pay for a basket that does not exist. The other way round leaves an
  // orphan intent, which the TTL sweep clears and nobody ever sees.
  await new FirestoreMarketplaceStore(db).putIntent(intent);

  // A staging deployment must never be able to charge a real card.
  //
  // Checked here rather than at boot because this is the only line that moves
  // money: if the wrong key is ever configured, the failure should be a
  // refused checkout, not a live charge somebody has to refund. The key's
  // value is never logged — only the prefix decides.
  if (
    process.env.DELIVERY_ENVIRONMENT === "staging" &&
    !serverEnv.PAYSTACK_SECRET_KEY.startsWith("sk_test_")
  ) {
    console.error(JSON.stringify({
      scope: "marketplace_checkout", event: "refused_non_test_key_in_staging", reference,
    }));
    return unprocessable(
      "Staging is not configured with a test payment key.",
      { code: "LIVE_KEY_IN_STAGING" }
    );
  }

  // Server-side initialize, the same as the storefront checkout: the reference
  // and the amount are ours, and no Paystack key of any kind reaches the phone.
  // Note there is no `subaccount` — marketplace money is collected by the
  // platform and settled out through the ledger, not split at the gateway.
  const init = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serverEnv.PAYSTACK_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      // Paystack rejects reserved, undeliverable TLDs (.invalid, .test,
      // .example, .localhost) — which is exactly what synthetic staging
      // accounts use so they can never receive real mail. Substitute only for
      // those; a real customer's address must still reach them, because this
      // is where the provider sends the receipt.
      email: paystackEmailFor(customer.email),
      amount: quote.snapshot.totalChargedMinor,
      currency: "NGN",
      reference,
      callback_url: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/marketplace/payment/callback`,
      // `paymentType` is what routes the webhook to the marketplace branch
      // rather than the storefront one.
      metadata: { project: "rest", paymentType: "marketplace_order", reference },
    }),
  });

  if (!init.ok) {
    console.error(JSON.stringify({
      scope: "marketplace_checkout", event: "provider_init_failed",
      reference, correlationId, status: init.status,
      // The provider's error text, which carries no secret and is the only way
      // to tell "bad email" from "bad key" from "amount out of range".
      providerError: await init.text().catch(() => "<unreadable>"),
    }));
    return unprocessable("We couldn't start your payment. Please try again.", { code: "PROVIDER_ERROR" });
  }

  const { data } = await init.json() as { data: { authorization_url: string } };

  console.log(JSON.stringify({
    scope: "marketplace_checkout", event: "intent_created",
    reference, correlationId, customerId: customer.id, restaurantId: intent.restaurantId,
    totalMinor: quote.snapshot.totalChargedMinor,
  }));

  return {
    reference,
    authorizationUrl: data.authorization_url,
    amountMinor: quote.snapshot.totalChargedMinor,
    currency: "NGN",
    expiresAt: new Date(intent.expiresAt).toISOString(),
  };
});
