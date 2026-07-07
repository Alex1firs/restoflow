import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { analyticsEnabled } from "@/lib/analytics/rollup";
import { getRestaurantAnalytics } from "@/lib/analytics/query";

// Restaurant-scoped storefront analytics. The restaurant slug is ALWAYS derived
// from the authenticated session — it is never read from a query param — so a
// restaurant can only ever see its own data. Same auth posture as /reports.

export async function GET(req: NextRequest) {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try {
    user = await getAuthenticatedUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (user.role === "staff") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const range = searchParams.get("range") ?? "today";
  const from = searchParams.get("from") ?? undefined;
  const to = searchParams.get("to") ?? undefined;

  // Feature flag OFF → clean empty state (no reads).
  if (!analyticsEnabled()) {
    return NextResponse.json({ enabled: false, hasData: false });
  }

  try {
    const data = await getRestaurantAnalytics(user.restaurantSlug, range, from, to);
    return NextResponse.json({ enabled: true, ...data });
  } catch {
    return NextResponse.json({ error: "Could not load analytics" }, { status: 400 });
  }
}
