import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";
import { serverEnv } from "@/lib/env";

export async function GET() {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try {
    user = await getAuthenticatedUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const snap = await getAdminDb().collection("restaurants").doc(user.restaurantSlug).get();
  if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const d = snap.data()!;
  return NextResponse.json({
    bankName: (d.paymentBankName as string) ?? "",
    bankCode: (d.paymentBankCode as string) ?? "",
    accountNumber: "",
    accountName: (d.paymentAccountName as string) ?? "",
    subaccountCode: (d.paystackSubaccountCode as string) ?? "",
  });
}

export async function POST(req: NextRequest) {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try {
    user = await getAuthenticatedUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const { bankName, bankCode, accountNumber, accountName } = body as {
    bankName?: string;
    bankCode?: string;
    accountNumber?: string;
    accountName?: string;
  };

  if (!bankName?.trim() || !bankCode?.trim() || !accountNumber?.trim() || !accountName?.trim()) {
    return NextResponse.json({ error: "All payment fields are required" }, { status: 400 });
  }

  const db = getAdminDb();
  const restaurantSnap = await db.collection("restaurants").doc(user.restaurantSlug).get();
  if (!restaurantSnap.exists) {
    return NextResponse.json({ error: "Restaurant not found" }, { status: 404 });
  }

  const restaurantName = (restaurantSnap.data()!.name as string) || user.restaurantSlug;

  const paystackRes = await fetch("https://api.paystack.co/subaccount", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serverEnv.PAYSTACK_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      business_name: restaurantName,
      settlement_bank: bankCode.trim(),
      account_number: accountNumber.trim(),
      percentage_charge: 0,
    }),
  });

  if (!paystackRes.ok) {
    return NextResponse.json(
      { error: "Failed to create payment account. Check your bank details and try again." },
      { status: 422 }
    );
  }

  const { data: subData } = await paystackRes.json();
  const subaccountCode = subData.subaccount_code as string;

  await db.collection("restaurants").doc(user.restaurantSlug).update({
    paystackSubaccountCode: subaccountCode,
    paymentBankName: bankName.trim(),
    paymentBankCode: bankCode.trim(),
    paymentAccountName: accountName.trim(),
  });

  return NextResponse.json({ subaccountCode });
}
