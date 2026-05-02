import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { processSuccessfulPayment, type PaystackPaymentData } from "@/lib/payments";

export async function POST(req: NextRequest) {
  try {
    await getAuthenticatedUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body?.reference) {
    return NextResponse.json({ error: "Missing reference" }, { status: 400 });
  }

  const { reference } = body as { reference: string };

  const paystackRes = await fetch(
    `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
    {
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
    }
  );

  if (!paystackRes.ok) {
    return NextResponse.json({ error: "Payment provider error" }, { status: 502 });
  }

  const { data } = await paystackRes.json();

  if (data.status !== "success") {
    return NextResponse.json(
      { error: `Payment not successful: ${data.status}` },
      { status: 400 }
    );
  }

  const paymentData: PaystackPaymentData = {
    reference: data.reference,
    amount: data.amount,
    status: data.status,
    metadata: data.metadata,
    customer: data.customer,
  };

  const processed = await processSuccessfulPayment(paymentData);

  return NextResponse.json({
    success: true,
    alreadyProcessed: !processed,
    restaurantId: data.metadata?.restaurantId,
  });
}
