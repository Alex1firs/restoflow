import "server-only";
import { getAdminDb } from "./firebase-admin";
import { GRACE_DAYS } from "./constants";

export type SubscriptionStatus = "trialing" | "active" | "grace_period" | "expired";

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
  endDate: Date | null;               // when trial/subscription ends
  graceEndsAt: Date | null;           // endDate + 3 days
  daysRemaining: number | null;       // days until endDate (null if in grace or expired)
  graceDaysRemaining: number | null;  // days until grace ends (only when status === "grace_period")
  isOperational: boolean;             // false only when expired — blocks operational APIs
  isOrdering: boolean;                // same as isOperational (kept for backward compat)
};

/**
 * Derives the effective subscription state for a restaurant document.
 * Always computes from end dates so stale stored statuses don't mislead.
 * Grace period: 3 days after trial/subscription expiry — still operational but strongly warned.
 */
export async function getSubscriptionInfo(
  data: Record<string, unknown>
): Promise<SubscriptionInfo> {
  const planId = "pro"; // Force "pro" as requested: only one plan/price exists now
  const stored = (data.subscriptionStatus as string) ?? "active";

  let endDate: Date | null = null;

  if (data.subscriptionEndDate) {
    const raw = data.subscriptionEndDate as { toDate?: () => Date; seconds?: number };
    endDate = raw.toDate ? raw.toDate() : new Date((raw.seconds ?? 0) * 1000);
  }

  const now = new Date();
  const graceEndsAt = endDate ? new Date(endDate.getTime() + GRACE_DAYS * 86_400_000) : null;

  let status: SubscriptionStatus;
  let daysRemaining: number | null = null;
  let graceDaysRemaining: number | null = null;

  if (!endDate) {
    // No end date — trust stored status
    status = (stored === "expired" ? "expired" : stored) as SubscriptionStatus;
  } else if (endDate > now) {
    // Within active window
    status = (stored === "trialing" ? "trialing" : "active") as SubscriptionStatus;
    daysRemaining = Math.ceil((endDate.getTime() - now.getTime()) / 86_400_000);
  } else if (graceEndsAt && graceEndsAt > now) {
    // Past end date but within 3-day grace window
    status = "grace_period";
    graceDaysRemaining = Math.ceil((graceEndsAt.getTime() - now.getTime()) / 86_400_000);
  } else {
    // Past grace window
    status = "expired";
  }

  const isOperational = status !== "expired";

  // Fetch plan name and price
  const planName = "Restaflow Pro";
  const monthlyPrice = 19999;

  return {
    planId,
    planName,
    monthlyPrice,
    status,
    endDate,
    graceEndsAt,
    daysRemaining,
    graceDaysRemaining,
    isOperational,
    isOrdering: isOperational,
  };
}
