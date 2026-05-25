import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "./firebase-admin";

export type PaystackPaymentData = {
  reference: string;
  amount: number; // kobo
  status: string;
  metadata?: {
    restaurantId?: string;
    planId?: string;
    paymentType?: string;
    ownerUid?: string;
    planName?: string;
    onboardingId?: string;
    restaurantSlug?: string;
    email?: string;
  };
  customer?: { email?: string };
};

/**
 * Activates or renews a restaurant subscription after a successful Paystack charge.
 * Idempotent: no-ops if a payment with this reference already exists as "success".
 * Returns true if processed, false if already done.
 */
export async function processSuccessfulPayment(
  data: PaystackPaymentData
): Promise<boolean> {
  const { reference, amount, metadata } = data;
  const restaurantId = metadata?.restaurantId;
  const planId = metadata?.planId ?? "pro";
  const paymentType = metadata?.paymentType ?? "subscription";
  const ownerUid = metadata?.ownerUid ?? "";
  const planName = metadata?.planName ?? "";

  if (!restaurantId) {
    throw new Error(`Payment ${reference} missing restaurantId in metadata`);
  }

  const db = getAdminDb();

  // Idempotency check — skip if already recorded as success
  const existing = await db
    .collection("payments")
    .where("reference", "==", reference)
    .where("status", "==", "success")
    .limit(1)
    .get();

  if (!existing.empty) return false;

  const now = new Date();
  const subscriptionEndsAt = new Date(now);
  subscriptionEndsAt.setDate(subscriptionEndsAt.getDate() + 30);

  const paymentRef = db.collection("payments").doc();
  const restaurantRef = db.collection("restaurants").doc(restaurantId);

  // Preserve subscriptionStartedAt if this is a renewal (not the first payment)
  const restaurantSnap = await restaurantRef.get();
  const existingData = restaurantSnap.exists ? restaurantSnap.data()! : {};
  const subscriptionStartedAt = existingData.subscriptionStartedAt ?? now;

  const batch = db.batch();

  batch.set(paymentRef, {
    restaurantId,
    planId,
    planName,
    paymentType,
    ownerUid,
    amount,
    reference,
    status: "success",
    createdAt: FieldValue.serverTimestamp(),
  });

  batch.update(restaurantRef, {
    subscriptionStatus: "active",
    subscriptionStartDate: now,          // backward compat
    subscriptionEndDate: subscriptionEndsAt, // backward compat + used by getSubscriptionInfo
    subscriptionStartedAt,               // first activation date (preserved on renewal)
    subscriptionEndsAt,                  // alias matching new naming convention
    lastPaymentAt: now,
    nextBillingAt: subscriptionEndsAt,
    planId,
    updatedAt: FieldValue.serverTimestamp(),
  });

  await batch.commit();
  return true;
}
