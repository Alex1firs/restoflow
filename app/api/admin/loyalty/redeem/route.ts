import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { redeemLoyaltyReward } from "@/lib/loyalty";

export async function POST(req: NextRequest) {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try { user = await getAuthenticatedUser(); } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null) as { phone?: string } | null;
  if (!body?.phone?.trim()) return NextResponse.json({ error: "Phone is required" }, { status: 400 });

  const result = await redeemLoyaltyReward({
    restaurantSlug: user.restaurantSlug,
    phone: body.phone,
    staffId: user.uid,
    staffName: "",
  });

  if (!result.success) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ success: true });
}
