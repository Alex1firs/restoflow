import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase-admin";
import { getPlan } from "@/lib/plans";
import { generateUniqueSlug, processOnboarding } from "@/lib/onboarding";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { serverEnv } from "@/lib/env";

export async function POST(req: NextRequest) {
  try {
    const { allowed } = await checkRateLimit(`onboarding:${getClientIp(req)}`, 5, 60_000);
    if (!allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

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
    const slug = await generateUniqueSlug(restaurantName);

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

    // Free trial path — no payment required, activate immediately
    if (plan.setupFee === 0) {
      const result = await processOnboarding(onboardingId, "free_trial");
      return NextResponse.json({
        directActivation: true,
        slug: result.slug,
        email: result.email,
      });
    }

    // Paid setup path — initialize Paystack transaction
    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ??
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
    const callbackUrl = `${appUrl}/get-started/callback`;

    const paystackRes = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serverEnv.PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        amount: plan.setupFee * 100,
        currency: "NGN",
        callback_url: callbackUrl,
        metadata: {
          project: "rest",
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
      console.error("Paystack initialize error");
      return NextResponse.json({ error: "Payment provider error" }, { status: 502 });
    }

    const { data } = await paystackRes.json();

    return NextResponse.json({
      authorizationUrl: data.authorization_url as string,
      reference: data.reference as string,
    });
  } catch {
    console.error("POST /api/onboarding error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
