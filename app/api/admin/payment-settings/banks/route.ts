import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";

export async function GET() {
  try {
    await getAuthenticatedUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const res = await fetch(
    "https://api.paystack.co/bank?currency=NGN&use_cursor=false&perPage=200",
    {
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
      next: { revalidate: 3600 },
    }
  );

  if (!res.ok) {
    return NextResponse.json({ error: "Failed to fetch bank list" }, { status: 502 });
  }

  const { data } = await res.json();
  const banks = (data as { name: string; code: string }[])
    .map((b) => ({ name: b.name, code: b.code }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return NextResponse.json({ banks });
}
