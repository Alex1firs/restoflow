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
  const planId = metadata?.planId ?? "starter";
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
  const endDate = new Date(now);
  endDate.setDate(endDate.getDate() + 30);

  const paymentRef = db.collection("payments").doc();
  const restaurantRef = db.collection("restaurants").doc(restaurantId);

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
    subscriptionStartDate: now,
    subscriptionEndDate: endDate,
    planId,
    updatedAt: FieldValue.serverTimestamp(),
  });

  await batch.commit();
  return true;
}
