import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import { processSuccessfulPayment, type PaystackPaymentData } from "@/lib/payments";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  const signature = req.headers.get("x-paystack-signature");
  const secret = process.env.PAYSTACK_SECRET_KEY!;
  const expected = createHmac("sha512", secret).update(rawBody).digest("hex");

  if (signature !== expected) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: { event: string; data: PaystackPaymentData };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (event.event === "charge.success") {
    try {
      await processSuccessfulPayment(event.data);
    } catch (err) {
      console.error("Webhook processSuccessfulPayment error:", err);
      return NextResponse.json({ error: "Processing failed" }, { status: 500 });
    }
  }

  // Always return 200 to acknowledge receipt — Paystack retries on non-2xx
  return NextResponse.json({ received: true });
}
