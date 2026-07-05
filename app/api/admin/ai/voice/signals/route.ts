import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { detectProactiveSignals } from "@/lib/ai/signals";

/**
 * GET /api/admin/ai/voice/signals
 * Active proactive signals (sales vs forecast, kitchen queue, peak approaching,
 * inventory low, unreviewed recommendations). Deterministic, read-only, safe to poll.
 * Owner/manager only.
 */
export async function GET() {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try {
    user = await getAuthenticatedUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (user.role === "staff") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const signals = await detectProactiveSignals(user.restaurantSlug);
  return NextResponse.json({ signals }, { status: 200 });
}
