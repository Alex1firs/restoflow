import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { updateRecommendationStatus } from "@/lib/ai/recommendations";
import type { RecommendationStatus } from "@/lib/ai/types";

/**
 * PATCH /api/admin/ai/recommendations/[id]
 * Body: { status: "accepted" | "dismissed" | "snoozed" | "new" }
 *
 * Update an owner's decision on a recommendation. Writes ai_recommendations only;
 * the tenant is derived from the session and the rec's ownership is re-verified.
 */

const ALLOWED: RecommendationStatus[] = ["accepted", "dismissed", "snoozed", "new"];

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try {
    user = await getAuthenticatedUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (user.role === "staff") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;

  let status: unknown;
  try {
    status = (await req.json())?.status;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof status !== "string" || !ALLOWED.includes(status as RecommendationStatus)) {
    return NextResponse.json({ error: `status must be one of ${ALLOWED.join(", ")}` }, { status: 400 });
  }

  try {
    const rec = await updateRecommendationStatus(user.restaurantSlug, id, status as RecommendationStatus);
    if (!rec) return NextResponse.json({ error: "Recommendation not found" }, { status: 404 });
    return NextResponse.json({ recommendation: rec }, { status: 200 });
  } catch (err) {
    console.error("[ai-recommendations] update error:", err);
    return NextResponse.json({ error: "Failed to update recommendation." }, { status: 500 });
  }
}
