import "server-only";
import { NextResponse } from "next/server";
import { getAdminDb } from "./firebase-admin";
import { GRACE_DAYS } from "./constants";

/**
 * Checks whether a restaurant's subscription allows operational access.
 * Returns null if access is granted (trialing, active, or within grace period).
 * Returns a 402 NextResponse if the subscription is fully expired.
 */
export async function checkSubscriptionAccess(
  restaurantSlug: string
): Promise<NextResponse | null> {
  const db = getAdminDb();
  const snap = await db.collection("restaurants").doc(restaurantSlug).get();

  if (!snap.exists) {
    return NextResponse.json({ error: "Restaurant not found" }, { status: 404 });
  }

  const data = snap.data()!;
  const stored = (data.subscriptionStatus as string) ?? "active";

  if (data.subscriptionEndDate) {
    const raw = data.subscriptionEndDate as { toDate?: () => Date; seconds?: number };
    const endDate = raw.toDate ? raw.toDate() : new Date((raw.seconds ?? 0) * 1000);
    const graceEndsAt = new Date(endDate.getTime() + GRACE_DAYS * 86_400_000);
    const now = new Date();

    if (endDate > now || graceEndsAt > now) {
      return null; // trialing, active, or in grace period — allowed
    }

    return NextResponse.json(
      {
        error:
          "Your Restaflow Pro subscription has expired. Please renew to continue using this feature.",
        subscriptionStatus: "expired",
      },
      { status: 402 }
    );
  }

  // No end date — fall back to stored status
  if (stored === "expired") {
    return NextResponse.json(
      {
        error:
          "Your Restaflow Pro subscription has expired. Please renew to continue using this feature.",
        subscriptionStatus: "expired",
      },
      { status: 402 }
    );
  }

  return null; // allowed
}
