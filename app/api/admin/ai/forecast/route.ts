import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { checkRateLimit } from "@/lib/rate-limit";
import { getForecast, generateForecast } from "@/lib/ai/forecasting";

/**
 * GET  /api/admin/ai/forecast  → today's cached forecast (no computation).
 * POST /api/admin/ai/forecast  → generate/refresh today's forecast (owner/manager).
 *
 * Forecasts are deterministic (no LLM), grounded in the Restaurant Context +
 * Decision Engine + Recommendation Engine. Managerial surface. Writes only to
 * ai_forecasts + ai_usage.
 */

export async function GET() {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try {
    user = await getAuthenticatedUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (user.role === "staff") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const forecast = await getForecast(user.restaurantSlug);
  return NextResponse.json({ forecast }, { status: 200 });
}

export async function POST(req: Request) {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try {
    user = await getAuthenticatedUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (user.role === "staff") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { allowed } = await checkRateLimit(`ai-forecast:${user.uid}`, 10, 60_000);
  if (!allowed) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

  // `force` (re-generate even if today's forecast exists) is opt-in via body.
  let force = false;
  try {
    const body = (await req.json()) as { force?: unknown };
    force = body?.force === true;
  } catch {
    /* no body → non-forced generate */
  }

  try {
    const forecast = await generateForecast(user.restaurantSlug, { force });
    return NextResponse.json({ forecast }, { status: 200 });
  } catch (err) {
    console.error("[ai-forecast] error:", err);
    return NextResponse.json({ error: "Failed to generate forecast. Please try again." }, { status: 500 });
  }
}
