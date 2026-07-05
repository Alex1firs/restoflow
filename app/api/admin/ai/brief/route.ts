import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { checkRateLimit } from "@/lib/rate-limit";
import { getBrief, generateBrief, BriefBusyError } from "@/lib/ai/brief";

/**
 * GET  /api/admin/ai/brief  → today's cached brief (no LLM; instant Firestore read).
 * POST /api/admin/ai/brief  → manually (re)generate today's brief (owner/manager).
 *
 * Managerial surface. The GET never invokes the LLM. The POST reuses the same
 * generation pipeline and is de-duplicated against concurrent generation (409).
 */

export async function GET() {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try {
    user = await getAuthenticatedUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (user.role === "staff") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const brief = await getBrief(user.restaurantSlug);
  return NextResponse.json({ brief }, { status: 200 });
}

export async function POST() {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try {
    user = await getAuthenticatedUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (user.role === "staff") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // A refresh is expensive (LLM) — keep it modest per user.
  const { allowed } = await checkRateLimit(`ai-brief-refresh:${user.uid}`, 5, 60_000);
  if (!allowed) return NextResponse.json({ error: "Too many refreshes. Please wait a moment." }, { status: 429 });

  try {
    const brief = await generateBrief(user.restaurantSlug, { force: true });
    return NextResponse.json({ brief }, { status: 200 });
  } catch (err) {
    if (err instanceof BriefBusyError) {
      return NextResponse.json({ error: "A brief is already being generated. Please wait." }, { status: 409 });
    }
    console.error("[ai-brief] refresh error:", err);
    return NextResponse.json({ error: "Failed to generate the brief. Please try again." }, { status: 500 });
  }
}
