import { randomBytes } from "crypto";
import { getAdminDb } from "./firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

export async function createOrderFromPaymentReference(reference: string): Promise<string | null> {
  const db = getAdminDb();
  const pendingRef = db.collection("pending_payments").doc(reference);
  const orderRef = db.collection("orders").doc();
  const trackingToken = randomBytes(16).toString("hex");

  return db.runTransaction(async (tx) => {
    const pending = await tx.get(pendingRef);
    if (!pending.exists) return null;

    const d = pending.data()!;
    tx.set(orderRef, {
      restaurantId: d.restaurantId,
      customerName: d.customerName,
      phone: d.phone,
      address: d.address,
      note: d.note,
      items: d.items,
      itemsTotal: d.itemsTotal ?? null,
      deliveryFee: d.deliveryFee ?? 0,
      total: d.total,
      paymentMethod: "online",
      paymentStatus: "paid",
      paymentReference: reference,
      status: "pending",
      deliveryType: d.deliveryType ?? "delivery",
      trackingToken,
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.delete(pendingRef);

    return orderRef.id;
  });
}

export async function getOrderByReference(reference: string): Promise<string | null> {
  const db = getAdminDb();
  const snap = await db
    .collection("orders")
    .where("paymentReference", "==", reference)
    .limit(1)
    .get();
  return snap.empty ? null : snap.docs[0].id;
}
