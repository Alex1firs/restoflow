import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";

export async function POST(req: NextRequest) {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try {
    user = await getAuthenticatedUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { restaurantId, planId, paymentType } = body as {
    restaurantId?: string;
    planId?: string;
    paymentType?: string;
  };

  if (!restaurantId || !planId || !paymentType) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  if (restaurantId !== user.restaurantSlug) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!["setup", "subscription"].includes(paymentType)) {
    return NextResponse.json({ error: "Invalid paymentType" }, { status: 400 });
  }

  const db = getAdminDb();

  const [planDoc, restaurantDoc] = await Promise.all([
    db.collection("plans").doc(planId).get(),
    db.collection("restaurants").doc(restaurantId).get(),
  ]);

  if (!planDoc.exists) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }
  if (!restaurantDoc.exists) {
    return NextResponse.json({ error: "Restaurant not found" }, { status: 404 });
  }

  const plan = planDoc.data()!;
  const restaurant = restaurantDoc.data()!;

  const amountNgn =
    paymentType === "setup" ? (plan.setupFee as number) : (plan.monthlyPrice as number);
  const amountKobo = amountNgn * 100;

  const callbackUrl = `${process.env.NEXT_PUBLIC_APP_URL}/admin/${restaurantId}/billing/callback`;

  const paystackRes = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: restaurant.ownerEmail ?? `${restaurantId}@noreply.grills.ng`,
      amount: amountKobo,
      currency: "NGN",
      callback_url: callbackUrl,
      metadata: {
        project: "rest",
        restaurantId,
        planId,
        paymentType,
        ownerUid: user.uid,
        planName: plan.name as string,
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
