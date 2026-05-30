import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";
import { DEFAULT_LOYALTY, type LoyaltySettings } from "@/lib/loyalty";

export async function GET() {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try { user = await getAuthenticatedUser(); } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getAdminDb();
  const customersCol = db.collection("restaurants").doc(user.restaurantSlug).collection("loyalty_customers");

  const [customersSnap, restaurantSnap, countSnap] = await Promise.all([
    customersCol.orderBy("totalTicks", "desc").limit(100).get(),
    db.collection("restaurants").doc(user.restaurantSlug).get(),
    customersCol.count().get(),
  ]);

  const settings: LoyaltySettings = { ...DEFAULT_LOYALTY, ...(restaurantSnap.data()?.loyalty ?? {}) };

  const customers = customersSnap.docs.map((doc) => {
    const d = doc.data();
    return {
      phone: doc.id,
      name: d.name ?? "",
      currentTicks: d.currentTicks ?? 0,
      totalTicks: d.totalTicks ?? 0,
      rewardsEarned: d.rewardsEarned ?? 0,
      rewardsRedeemed: d.rewardsRedeemed ?? 0,
      unredeemedRewards: d.unredeemedRewards ?? 0,
      lastEarnedAt: d.lastEarnedAt?._seconds ? new Date(d.lastEarnedAt._seconds * 1000).toISOString() : null,
    };
  });

  const tickGoal = settings.tickGoal;
  const analytics = {
    totalCustomers: countSnap.data().count,
    nearReward: customers.filter((c) => c.currentTicks >= tickGoal - 2 && c.currentTicks < tickGoal).length,
    totalRewardsEarned: customers.reduce((s, c) => s + c.rewardsEarned, 0),
    totalRewardsRedeemed: customers.reduce((s, c) => s + c.rewardsRedeemed, 0),
    pendingRedemptions: customers.filter((c) => c.unredeemedRewards > 0).length,
  };

  return NextResponse.json({ customers, analytics, settings });
}
