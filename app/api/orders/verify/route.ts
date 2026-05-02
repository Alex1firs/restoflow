import { NextRequest, NextResponse } from "next/server";
import { createOrderFromPaymentReference, getOrderByReference } from "@/lib/order-payments";
import { sendNewOrderSMS } from "@/lib/notifications";
import { getAdminDb } from "@/lib/firebase-admin";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { reference } = body as { reference?: string };
  if (!reference?.trim()) {
    return NextResponse.json({ error: "Missing payment reference" }, { status: 400 });
  }

  try {
    const verifyRes = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference.trim())}`,
      { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } }
    );

    if (!verifyRes.ok) {
      return NextResponse.json({ error: "Payment verification failed" }, { status: 400 });
    }

    const { data: txData } = await verifyRes.json();
    if (txData.status !== "success") {
      return NextResponse.json({ error: `Payment was not completed (status: ${txData.status})` }, { status: 400 });
    }

    let orderId = await createOrderFromPaymentReference(reference.trim());
    let isNew = !!orderId;

    if (!orderId) {
      orderId = await getOrderByReference(reference.trim());
    }

    // Send SMS if this was a newly created order
    if (isNew && orderId) {
      const orderSnap = await getAdminDb().collection("orders").doc(orderId).get();
      if (orderSnap.exists) {
        const d = orderSnap.data()!;
        sendNewOrderSMS(d.restaurantId as string, d.total as number, "online").catch(() => {});
      }
    }

    return NextResponse.json({ orderId });
  } catch (error) {
    console.error("Order verify failed:", error);
    return NextResponse.json({ error: "Failed to verify payment" }, { status: 500 });
  }
}
