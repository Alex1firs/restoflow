import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { authoriseConnect } from "@/lib/connect/http";
import { preparePayment } from "@/lib/connect/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Choose who pays, and open a checkout.
 *
 * This replaced the old "request a courier" action. Dispatch is no longer
 * something an HTTP caller can do: it happens behind the Paystack webhook, once
 * the money is confirmed. That ordering is the whole point of the billing model
 * — a courier is never commissioned against a payment that has not landed.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authoriseConnect();
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    // An empty body is fine; payer defaults below.
  }

  const payer = body.payer === "restaurant" ? "restaurant" : "customer";

  const result = await preparePayment({
    db: getAdminDb(),
    restaurantId: auth.caller.restaurantId,
    deliveryId: id,
    payer,
    payerEmail: typeof body.payerEmail === "string" ? body.payerEmail : undefined,
  });

  if (!result.ok) {
    const status = result.reason === "not_found" ? 404 : 422;
    return NextResponse.json({ error: result.reason, detail: result.detail }, { status });
  }

  return NextResponse.json({
    id,
    payer,
    // The amount the payer will be charged. If a near-expiry quote was
    // refreshed, this is the NEW number and `priceChanged` says so — the caller
    // must show it before sending anybody to checkout.
    amountMinor: result.amountMinor,
    priceChanged: result.priceChanged,
    // Where the payer completes payment. For "restaurant" the admin opens it
    // in-session; for "customer" the restaurant sends the guest link below.
    checkoutUrl: result.authorizationUrl,
    payLink: result.delivery.trackingToken
      ? `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/d/${id}?t=${result.delivery.trackingToken}`
      : null,
  });
}
