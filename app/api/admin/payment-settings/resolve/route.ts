import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { checkRateLimit } from "@/lib/rate-limit";
import { serverEnv } from "@/lib/env";

export async function GET(req: NextRequest) {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try {
    user = await getAuthenticatedUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { allowed } = await checkRateLimit(`bank_resolve:${user.uid}`, 20, 60_000);
  if (!allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const { searchParams } = new URL(req.url);
  const accountNumber = searchParams.get("accountNumber");
  const bankCode = searchParams.get("bankCode");

  if (!accountNumber || !bankCode) {
    return NextResponse.json({ error: "Missing accountNumber or bankCode" }, { status: 400 });
  }

  const res = await fetch(
    `https://api.paystack.co/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`,
    { headers: { Authorization: `Bearer ${serverEnv.PAYSTACK_SECRET_KEY}` } }
  );

  const json = await res.json();
  if (!res.ok || !json.status) {
    return NextResponse.json(
      { error: "Could not resolve account. Check account number and bank." },
      { status: 422 }
    );
  }

  return NextResponse.json({ accountName: json.data.account_name as string });
}
