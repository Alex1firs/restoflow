import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { checkRateLimit } from "@/lib/rate-limit";
import { listRecommendations, generateRecommendations } from "@/lib/ai/recommendations";

/**
 * GET  /api/admin/ai/recommendations  → active recommendations (cached read).
 * POST /api/admin/ai/recommendations  → generate/refresh today's set (owner/manager).
 *
 * Recommendations are deterministic (no LLM), grounded in the tool layer. Managerial
 * surface. Writes only to ai_recommendations + ai_usage.
 */

export async function GET() {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try {
    user = await getAuthenticatedUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (user.role === "staff") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const recommendations = await listRecommendations(user.restaurantSlug);
  return NextResponse.json({ recommendations }, { status: 200 });
}

export async function POST(req: Request) {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try {
    user = await getAuthenticatedUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (user.role === "staff") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { allowed } = await checkRateLimit(`ai-recs:${user.uid}`, 10, 60_000);
  if (!allowed) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

  // `force` (re-generate even if today's set exists) is opt-in via body.
  let force = false;
  try {
    const body = (await req.json()) as { force?: unknown };
    force = body?.force === true;
  } catch {
    /* no body → non-forced generate */
  }

  try {
    const recommendations = await generateRecommendations(user.restaurantSlug, { force });
    return NextResponse.json({ recommendations }, { status: 200 });
  } catch (err) {
    console.error("[ai-recommendations] error:", err);
    return NextResponse.json({ error: "Failed to generate recommendations. Please try again." }, { status: 500 });
  }
}
