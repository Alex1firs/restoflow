import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";

export async function GET(req: NextRequest) {
  try {
    await getAuthenticatedUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const accountNumber = searchParams.get("accountNumber");
  const bankCode = searchParams.get("bankCode");

  if (!accountNumber || !bankCode) {
    return NextResponse.json({ error: "Missing accountNumber or bankCode" }, { status: 400 });
  }

  const res = await fetch(
    `https://api.paystack.co/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`,
    { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } }
  );

  const json = await res.json();
  if (!res.ok || !json.status) {
    return NextResponse.json(
      { error: json.message ?? "Could not resolve account. Check account number and bank." },
      { status: 422 }
    );
  }

  return NextResponse.json({ accountName: json.data.account_name as string });
}
