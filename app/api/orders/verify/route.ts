import { NextRequest, NextResponse } from "next/server";
import { createOrderFromPaymentReference, getOrderByReference } from "@/lib/order-payments";

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
      return NextResponse.json(
        { error: `Payment was not completed (status: ${txData.status})` },
        { status: 400 }
      );
    }

    // Create order from pending record — idempotent via Firestore transaction
    let orderId = await createOrderFromPaymentReference(reference.trim());

    if (!orderId) {
      // Webhook already created the order — look it up by reference
      orderId = await getOrderByReference(reference.trim());
    }

    return NextResponse.json({ orderId });
  } catch (error) {
    console.error("Order verify failed:", error);
    return NextResponse.json({ error: "Failed to verify payment" }, { status: 500 });
  }
}
