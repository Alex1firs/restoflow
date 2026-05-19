import { NextRequest, NextResponse } from "next/server";
import { getLoyaltyProfile } from "@/lib/loyalty";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const slug = searchParams.get("slug");
  const phone = searchParams.get("phone");

  if (!slug || !phone) {
    return NextResponse.json({ error: "slug and phone are required" }, { status: 400 });
  }

  try {
    const result = await getLoyaltyProfile(slug, phone);

    if (!result.settings.enabled) {
      return NextResponse.json({ enabled: false });
    }

    return NextResponse.json({
      enabled: true,
      found: result.found,
      settings: {
        tickGoal: result.settings.tickGoal,
        reward: result.settings.reward,
      },
      profile: result.profile ? {
        currentTicks: result.profile.currentTicks ?? 0,
        totalTicks: result.profile.totalTicks ?? 0,
        rewardsEarned: result.profile.rewardsEarned ?? 0,
        unredeemedRewards: result.profile.unredeemedRewards ?? 0,
      } : null,
    });
  } catch {
    return NextResponse.json({ error: "Failed to load loyalty data" }, { status: 500 });
  }
}
