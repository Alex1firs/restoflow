import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase-admin";
import { getPlan } from "@/lib/plans";
import { generateUniqueSlug } from "@/lib/onboarding";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { restaurantName, email, phone, address, planId } = body as {
    restaurantName?: string;
    email?: string;
    phone?: string;
    address?: string;
    planId?: string;
  };

  if (!restaurantName || !email || !phone || !address || !planId) {
    return NextResponse.json({ error: "All fields are required" }, { status: 400 });
  }

  const plan = getPlan(planId);
  if (!plan) {
    return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
  }

  const db = getAdminDb();

  // Generate unique slug
  const slug = await generateUniqueSlug(restaurantName);

  // Create onboarding record
  const onboardingRef = db.collection("onboardings").doc();
  await onboardingRef.set({
    restaurantName,
    slug,
    email,
    phone,
    address,
    planId,
    status: "pending",
    createdAt: FieldValue.serverTimestamp(),
  });

  const onboardingId = onboardingRef.id;
  const callbackUrl = `${process.env.NEXT_PUBLIC_APP_URL}/get-started/callback`;

  // Initialize Paystack payment for setup fee
  const paystackRes = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email,
      amount: plan.setupFee * 100, // kobo
      currency: "NGN",
      callback_url: callbackUrl,
      metadata: {
        paymentType: "onboarding",
        onboardingId,
        restaurantSlug: slug,
        planId,
        planName: plan.name,
        email,
      },
    }),
  });

  if (!paystackRes.ok) {
    const err = await paystackRes.text();
    console.error("Paystack initialize error:", err);
    return NextResponse.json({ error: "Payment provider error" }, { status: 502 });
  }

  const { data } = await paystackRes.json();

  return NextResponse.json({
    authorizationUrl: data.authorization_url as string,
    reference: data.reference as string,
  });
}
