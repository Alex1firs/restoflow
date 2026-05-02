import { NextRequest, NextResponse } from "next/server";
import { processOnboarding } from "@/lib/onboarding";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.reference) {
    return NextResponse.json({ error: "Missing reference" }, { status: 400 });
  }

  const { reference } = body as { reference: string };

  // Verify with Paystack
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
      { error: `Payment not completed: ${data.status}` },
      { status: 400 }
    );
  }

  const { metadata } = data;

  if (metadata?.paymentType !== "onboarding" || !metadata?.onboardingId) {
    return NextResponse.json({ error: "Invalid payment type" }, { status: 400 });
  }

  const result = await processOnboarding(metadata.onboardingId, reference);

  return NextResponse.json(result);
}
