import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";
import type { LoyaltySettings } from "@/lib/loyalty";
import { DEFAULT_LOYALTY } from "@/lib/loyalty";

export async function GET() {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try { user = await getAuthenticatedUser(); } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const snap = await getAdminDb().collection("restaurants").doc(user.restaurantSlug).get();
  if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const loyalty: LoyaltySettings = { ...DEFAULT_LOYALTY, ...(snap.data()?.loyalty ?? {}) };
  return NextResponse.json(loyalty);
}

export async function POST(req: NextRequest) {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try { user = await getAuthenticatedUser(); } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (user.role === "staff") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null) as Partial<LoyaltySettings> | null;
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const update: Partial<LoyaltySettings> = {};
  if (typeof body.enabled === "boolean") update.enabled = body.enabled;
  if (typeof body.tickGoal === "number" && body.tickGoal >= 1) update.tickGoal = Math.min(body.tickGoal, 50);
  if (typeof body.reward === "string" && body.reward.trim()) update.reward = body.reward.trim();
  if (body.qualificationRule === "every_order" || body.qualificationRule === "min_amount") update.qualificationRule = body.qualificationRule;
  if (typeof body.minimumAmount === "number" && body.minimumAmount >= 0) update.minimumAmount = body.minimumAmount;
  if (typeof body.rolloverAfterReward === "boolean") update.rolloverAfterReward = body.rolloverAfterReward;

  await getAdminDb().collection("restaurants").doc(user.restaurantSlug).update(
    Object.fromEntries(Object.entries(update).map(([k, v]) => [`loyalty.${k}`, v]))
  );

  return NextResponse.json({ success: true });
}
