import "server-only";

/**
 * Paystack, for Connect.
 *
 * ── Reuse, not a second integration ──────────────────────────────────────────
 * Same secret key, same webhook, same HMAC verification as every other RestoFlow
 * payment. What differs is one `metadata.paymentType`, which is how the existing
 * webhook already tells an onboarding payment from a storefront order from a
 * marketplace order.
 *
 * ── No subaccount ────────────────────────────────────────────────────────────
 * The storefront splits to the restaurant's subaccount because the money is the
 * restaurant's. A Connect delivery fee is not: it is Dispatcher's cost plus
 * RestoFlow's margin, and the restaurant is owed none of it. So this collects to
 * the platform, exactly as marketplace checkout does.
 */

import { serverEnv } from "@/lib/env";

const PAYSTACK = "https://api.paystack.co";

export type InitResult =
  | { ok: true; reference: string; authorizationUrl: string }
  | { ok: false; reason: string };

/**
 * The same accessor every other payment path uses.
 *
 * `serverEnv` throws on a missing variable rather than sending an empty bearer
 * token and reading the provider's rejection as a network problem — so a
 * misconfigured environment fails where it is configured, not at a customer's
 * checkout.
 */
function secretKey(): string {
  try {
    return serverEnv.PAYSTACK_SECRET_KEY.trim();
  } catch {
    return "";
  }
}

/**
 * A staging build must never reach live money.
 *
 * The marketplace checkout makes the same check. It is cheap, and the failure it
 * prevents — a test run charging a real card — is not one you get to undo.
 */
export function keyIsTest(): boolean {
  return secretKey().startsWith("sk_test_");
}

export function refuseLiveKeyOutsideProduction(): string | null {
  const env = process.env.DELIVERY_ENVIRONMENT ?? "development";
  if (env !== "production" && !keyIsTest()) {
    return "refused: a non-test Paystack key outside production";
  }
  if (!secretKey()) return "PAYSTACK_SECRET_KEY is not set";
  return null;
}

export async function initializeConnectPayment(args: {
  reference: string;
  amountMinor: number;
  email: string;
  deliveryId: string;
  callbackUrl: string;
}): Promise<InitResult> {
  const refuse = refuseLiveKeyOutsideProduction();
  if (refuse) return { ok: false, reason: refuse };

  let res: Response;
  try {
    res = await fetch(`${PAYSTACK}/transaction/initialize`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secretKey()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: args.email,
        // Kobo, server-computed. No client ever supplies this.
        amount: args.amountMinor,
        currency: "NGN",
        reference: args.reference,
        callback_url: args.callbackUrl,
        // The branch the existing webhook routes on. No second webhook exists.
        metadata: {
          project: "rest",
          paymentType: "connect_delivery",
          connectDeliveryId: args.deliveryId,
          reference: args.reference,
        },
      }),
    });
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "network error" };
  }

  const body = (await res.json().catch(() => ({}))) as {
    status?: boolean;
    data?: { reference?: string; authorization_url?: string };
  };
  if (!res.ok || !body.status || !body.data?.authorization_url) {
    return { ok: false, reason: `paystack ${res.status}` };
  }
  return {
    ok: true,
    reference: body.data.reference ?? args.reference,
    authorizationUrl: body.data.authorization_url,
  };
}

export type RefundResult =
  | { ok: true; providerReference: string | null; alreadyRefunded: boolean }
  | { ok: false; reason: string };

/**
 * Refund a Connect payment.
 *
 * ── Why "already refunded" is a success ──────────────────────────────────────
 * Paystack refuses a second refund on a transaction it has already refunded.
 * That refusal is the outcome we wanted, so it is reported as success — treating
 * it as an error would make a retrying worker loop forever on a payment that is
 * already back with the customer.
 *
 * Idempotency is anchored on the payment reference, which is unique per Connect
 * delivery, so a replayed webhook, a retried worker and a manual reconciliation
 * all ask for the same refund rather than three of them.
 */
export async function refundConnectPayment(args: {
  reference: string;
  amountMinor: number;
  reason: string;
}): Promise<RefundResult> {
  const refuse = refuseLiveKeyOutsideProduction();
  if (refuse) return { ok: false, reason: refuse };

  let res: Response;
  try {
    res = await fetch(`${PAYSTACK}/refund`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secretKey()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        transaction: args.reference,
        amount: args.amountMinor,
        merchant_note: args.reason.slice(0, 200),
      }),
    });
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "network error" };
  }

  const body = (await res.json().catch(() => ({}))) as {
    status?: boolean;
    message?: string;
    data?: { id?: number | string; status?: string };
  };

  if (res.ok && body.status) {
    return { ok: true, providerReference: body.data?.id != null ? String(body.data.id) : null, alreadyRefunded: false };
  }

  const message = String(body.message ?? "");
  if (/already.*refund|has been refunded|duplicate/i.test(message)) {
    return { ok: true, providerReference: null, alreadyRefunded: true };
  }

  return { ok: false, reason: `paystack ${res.status}: ${message.slice(0, 160)}` };
}
