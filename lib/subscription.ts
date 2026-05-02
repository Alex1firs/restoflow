import "server-only";
import { getAdminDb } from "./firebase-admin";

export type SubscriptionStatus = "trialing" | "active" | "expired";

export type Plan = {
  id: string;
  name: string;
  monthlyPrice: number;
  setupFee: number;
  features: string[];
  isActive: boolean;
};

export type SubscriptionInfo = {
  planId: string;
  planName: string;
  monthlyPrice: number;
  status: SubscriptionStatus;
  endDate: Date | null;
  daysRemaining: number | null;
  isOrdering: boolean; // false when expired — blocks customer ordering
};

/**
 * Derives the effective subscription state for a restaurant document.
 * Always computes from the end date so stale stored statuses don't mislead.
 */
export async function getSubscriptionInfo(
  data: Record<string, unknown>
): Promise<SubscriptionInfo> {
  const planId = (data.planId as string) ?? "starter";
  const stored = (data.subscriptionStatus as SubscriptionStatus) ?? "active";

  // Compute effective status from end date — source of truth
  let status: SubscriptionStatus = stored;
  let endDate: Date | null = null;

  if (data.subscriptionEndDate) {
    const raw = data.subscriptionEndDate as { toDate?: () => Date; seconds?: number };
    endDate = raw.toDate ? raw.toDate() : new Date((raw.seconds ?? 0) * 1000);
    if (endDate < new Date()) status = "expired";
  }

  let daysRemaining: number | null = null;
  if (endDate && status !== "expired") {
    daysRemaining = Math.ceil((endDate.getTime() - Date.now()) / 86_400_000);
  }

  // Fetch plan name and price
  let planName = "Starter";
  let monthlyPrice = 0;
  try {
    const planDoc = await getAdminDb().collection("plans").doc(planId).get();
    if (planDoc.exists) {
      planName = planDoc.data()!.name as string;
      monthlyPrice = planDoc.data()!.monthlyPrice as number;
    }
  } catch {
    // Non-fatal — display falls back to defaults
  }

  return {
    planId,
    planName,
    monthlyPrice,
    status,
    endDate,
    daysRemaining,
    isOrdering: status !== "expired",
  };
}
