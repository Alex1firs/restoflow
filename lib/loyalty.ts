import "server-only";
import { getAdminDb } from "./firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

export interface LoyaltySettings {
  enabled: boolean;
  tickGoal: number;
  reward: string;
  qualificationRule: "every_order" | "min_amount";
  minimumAmount: number;
  rolloverAfterReward: boolean;
}

export const DEFAULT_LOYALTY: LoyaltySettings = {
  enabled: false,
  tickGoal: 10,
  reward: "Free meal",
  qualificationRule: "every_order",
  minimumAmount: 0,
  rolloverAfterReward: false,
};

export interface LoyaltyAwardResult {
  awarded: boolean;
  skippedReason?: string;
  newCurrentTicks: number;
  tickGoal: number;
  rewardUnlocked: boolean;
  unredeemedRewards: number;
  reward: string;
  phone: string;
}

/**
 * Awards a loyalty tick for a paid order.
 * Fully idempotent — safe to call multiple times for the same orderId.
 * Returns null if loyalty is disabled or phone is missing.
 */
export async function awardLoyaltyTick({
  orderId,
  restaurantSlug,
  phone,
  customerName,
  orderTotal,
}: {
  orderId: string;
  restaurantSlug: string;
  phone: string;
  customerName?: string;
  orderTotal?: number;
}): Promise<LoyaltyAwardResult | null> {
  const normalizedPhone = phone?.trim().replace(/\s+/g, "");
  if (!normalizedPhone) return null;

  const db = getAdminDb();

  // 1. Fast-path idempotency check before transaction
  const tickRef = db.collection("loyalty_ticks").doc(orderId);
  const existingTick = await tickRef.get();
  if (existingTick.exists) return null;

  // 2. Fetch loyalty settings
  const restaurantSnap = await db.collection("restaurants").doc(restaurantSlug).get();
  if (!restaurantSnap.exists) return null;

  const rData = restaurantSnap.data()!;
  const rawSettings = (rData.loyalty ?? {}) as Partial<LoyaltySettings>;
  const settings: LoyaltySettings = { ...DEFAULT_LOYALTY, ...rawSettings };

  if (!settings.enabled) return null;

  // 3. Qualification check
  if (settings.qualificationRule === "min_amount" && orderTotal != null) {
    if (orderTotal < settings.minimumAmount) {
      return {
        awarded: false,
        skippedReason: `Order ₦${orderTotal} below minimum ₦${settings.minimumAmount}`,
        newCurrentTicks: 0,
        tickGoal: settings.tickGoal,
        rewardUnlocked: false,
        unredeemedRewards: 0,
        reward: settings.reward,
        phone: normalizedPhone,
      };
    }
  }

  // 4. Transactional update
  const customerRef = db
    .collection("restaurants")
    .doc(restaurantSlug)
    .collection("loyalty_customers")
    .doc(normalizedPhone);

  let finalCurrentTicks = 0;
  let finalUnredeemedRewards = 0;
  let rewardUnlocked = false;

  await db.runTransaction(async (tx) => {
    const [tickSnap, customerSnap] = await Promise.all([
      tx.get(tickRef),
      tx.get(customerRef),
    ]);

    // Transaction-level idempotency check
    if (tickSnap.exists) return;

    const prev = customerSnap.exists ? (customerSnap.data() as Record<string, number>) : null;
    const prevCurrentTicks = prev?.currentTicks ?? 0;
    const prevTotalTicks = prev?.totalTicks ?? 0;
    const prevRewardsEarned = prev?.rewardsEarned ?? 0;
    const prevUnredeemedRewards = prev?.unredeemedRewards ?? 0;

    let newCurrentTicks = prevCurrentTicks + 1;
    let newRewardsEarned = prevRewardsEarned;
    let newUnredeemedRewards = prevUnredeemedRewards;

    if (newCurrentTicks >= settings.tickGoal) {
      rewardUnlocked = true;
      newRewardsEarned += 1;
      newUnredeemedRewards += 1;
      newCurrentTicks = settings.rolloverAfterReward
        ? newCurrentTicks - settings.tickGoal
        : 0;
    }

    finalCurrentTicks = newCurrentTicks;
    finalUnredeemedRewards = newUnredeemedRewards;

    tx.set(
      customerRef,
      {
        phone: normalizedPhone,
        name: customerName?.trim() || (prev as Record<string, unknown> | null)?.name || "",
        currentTicks: newCurrentTicks,
        totalTicks: prevTotalTicks + 1,
        rewardsEarned: newRewardsEarned,
        rewardsRedeemed: (prev as Record<string, unknown> | null)?.rewardsRedeemed ?? 0,
        unredeemedRewards: newUnredeemedRewards,
        lastEarnedAt: FieldValue.serverTimestamp(),
        createdAt: customerSnap.exists
          ? ((prev as Record<string, unknown> | null)?.createdAt ?? FieldValue.serverTimestamp())
          : FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    tx.set(tickRef, {
      restaurantSlug,
      phone: normalizedPhone,
      awardedAt: FieldValue.serverTimestamp(),
    });
  });

  return {
    awarded: true,
    newCurrentTicks: finalCurrentTicks,
    tickGoal: settings.tickGoal,
    rewardUnlocked,
    unredeemedRewards: finalUnredeemedRewards,
    reward: settings.reward,
    phone: normalizedPhone,
  };
}

export async function redeemLoyaltyReward({
  restaurantSlug,
  phone,
  staffId,
  staffName,
}: {
  restaurantSlug: string;
  phone: string;
  staffId: string;
  staffName: string;
}): Promise<{ success: boolean; error?: string }> {
  const normalizedPhone = phone.trim().replace(/\s+/g, "");
  const db = getAdminDb();

  const customerRef = db
    .collection("restaurants")
    .doc(restaurantSlug)
    .collection("loyalty_customers")
    .doc(normalizedPhone);

  const snap = await customerRef.get();
  if (!snap.exists) return { success: false, error: "Customer not found in loyalty program" };

  const data = snap.data() as Record<string, unknown>;
  const unredeemedRewards = (data.unredeemedRewards as number) ?? 0;
  if (unredeemedRewards <= 0) {
    return { success: false, error: "No rewards available to redeem" };
  }

  await customerRef.update({
    unredeemedRewards: FieldValue.increment(-1),
    rewardsRedeemed: FieldValue.increment(1),
    lastRedeemedAt: FieldValue.serverTimestamp(),
    lastRedeemedByStaffId: staffId,
    lastRedeemedByStaffName: staffName,
  });

  return { success: true };
}

export async function getLoyaltyProfile(restaurantSlug: string, phone: string) {
  const normalizedPhone = phone.trim().replace(/\s+/g, "");
  const db = getAdminDb();

  const [customerSnap, restaurantSnap] = await Promise.all([
    db
      .collection("restaurants")
      .doc(restaurantSlug)
      .collection("loyalty_customers")
      .doc(normalizedPhone)
      .get(),
    db.collection("restaurants").doc(restaurantSlug).get(),
  ]);

  const rawSettings = ((restaurantSnap.data()?.loyalty) ?? {}) as Partial<LoyaltySettings>;
  const settings: LoyaltySettings = { ...DEFAULT_LOYALTY, ...rawSettings };

  if (!customerSnap.exists) {
    return { found: false, settings, profile: null };
  }

  return {
    found: true,
    settings,
    profile: customerSnap.data() as Record<string, unknown>,
  };
}
