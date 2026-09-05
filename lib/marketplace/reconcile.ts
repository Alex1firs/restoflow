import "server-only";
import type { Firestore } from "firebase-admin/firestore";
import { serverEnv } from "@/lib/env";
import {
  classifyPaystackStatus, settlePayment,
  type ProviderVerification, type SettleResult,
} from "./payment";
import { FirestoreMarketplaceStore, INTENTS } from "./store";
import { announceOrderCreated } from "./announce";
import type { VerifyOutcome } from "./payment";

/**
 * Payment reconciliation — the path that does not depend on a webhook arriving.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * Until now the Paystack webhook was the ONLY way a payment became an order. A
 * webhook is somebody else's HTTP call to a serverless endpoint: it can be
 * delayed past the customer's patience, dropped by a deploy, or lost to a
 * signature mismatch. When that happened the customer's money was real and
 * their order did not exist — recoverable only by hand.
 *
 * Reconciliation asks Paystack directly instead of waiting to be told. It is
 * the same question, asked in the other direction, and it runs from two places:
 *
 *   1. The customer returning from the hosted checkout page, who wants an
 *      answer in seconds rather than whenever the webhook lands.
 *   2. The sweep, for the customer who paid and then closed the app.
 *
 * Both funnel into `settlePayment`, which asks "have I already made an order
 * for this reference?" first. So the webhook and both reconciliation paths can
 * race, repeat, and arrive out of order, and exactly one order exists after.
 */


/**
 * Ask Paystack what actually happened to a reference.
 *
 * A transport error is `unknown`, never `failed`: discarding a customer's
 * basket because our own network hiccuped is the one mistake this whole module
 * exists to prevent. Unknown means "ask again later".
 */
export async function verifyWithPaystack(
  reference: string
): Promise<{ status: VerifyOutcome; amountMinor: number; feeMinor: number | null }> {
  try {
    const res = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      {
        headers: { Authorization: `Bearer ${serverEnv.PAYSTACK_SECRET_KEY}` },
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      }
    );

    if (!res.ok) {
      // 404 is Paystack saying it has never seen this reference. That is a real
      // answer for a reference we minted ourselves and never handed over.
      if (res.status === 404) return { status: "failed", amountMinor: 0, feeMinor: null };
      return { status: "unknown", amountMinor: 0, feeMinor: null };
    }

    const body = (await res.json()) as {
      status?: boolean;
      data?: { status?: string; amount?: number; fees?: number };
    };
    const d = body.data ?? {};
    const amountMinor = Number(d.amount ?? 0);
    const feeMinor = typeof d.fees === "number" ? d.fees : null;

    return { status: classifyPaystackStatus(d.status), amountMinor, feeMinor };
  } catch {
    return { status: "unknown", amountMinor: 0, feeMinor: null };
  }
}

/**
 * Verify a reference with Paystack and settle it if the money is real.
 *
 * Returns `settlePayment`'s own result, so a caller can tell "I just created
 * this order" from "this order already existed" without a second read.
 */
export async function verifyAndSettle(args: {
  db: Firestore;
  reference: string;
  nowMs: number;
}): Promise<SettleResult | { outcome: "unknown" }> {
  const { db, reference, nowMs } = args;
  const store = new FirestoreMarketplaceStore(db);

  const v = await verifyWithPaystack(reference);
  if (v.status === "unknown") return { outcome: "unknown" };

  const verification: ProviderVerification = {
    reference,
    status: v.status,
    amountMinor: v.amountMinor,
    feeMinor: v.feeMinor,
  };

  const result = await settlePayment({
    verification, store, nowMs,
    log: (event, fields) =>
      console.log(JSON.stringify({ scope: "marketplace_reconcile", event, ...fields })),
  });

  // Whoever settles first announces. Without this an order recovered by the
  // callback or the sweep — the very case a lost webhook produces — reached the
  // customer in silence. The outbox's own key makes a later webhook a no-op.
  if (result.outcome === "created") await announceOrderCreated(db, result.orderId);

  return result;
}

/**
 * Intents whose TTL has passed and which never became an order.
 *
 * Ordered by expiry so the oldest — the ones a customer has been waiting on
 * longest — are rescued first.
 */
export async function findExpiredIntents(
  db: Firestore, nowMs: number, limit: number
): Promise<string[]> {
  const snap = await db
    .collection(INTENTS)
    .where("expiresAt", "<=", nowMs)
    .orderBy("expiresAt", "asc")
    .limit(limit)
    .get();
  return snap.docs.map((d) => d.id);
}

/**
 * Drop an intent Paystack has told us will never be paid.
 *
 * Only ever called after a definite `failed` verification — an unknown leaves
 * the intent alone for the next sweep.
 */
export async function discardIntent(db: Firestore, reference: string): Promise<void> {
  await db.collection(INTENTS).doc(reference).delete();
}
