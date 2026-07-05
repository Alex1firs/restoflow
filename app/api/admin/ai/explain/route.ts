import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { checkRateLimit } from "@/lib/rate-limit";
import { explainWidget, isWidgetType } from "@/lib/ai/explain";
import type { RangeLabel } from "@/lib/ai/types";

/**
 * POST /api/admin/ai/explain
 * Body: { widget: WidgetType, range?: RangeLabel, clientData?: unknown }
 *
 * Explains a dashboard widget in plain business language. The widget's numbers are
 * re-fetched authoritatively via the tool layer — `clientData` is only a display
 * snapshot we reconcile against, never the source of truth. Managerial surface,
 * rate-limited. Always 200 (AI or deterministic).
 */
export async function POST(req: NextRequest) {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try {
    user = await getAuthenticatedUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (user.role === "staff") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { allowed } = await checkRateLimit(`ai-explain:${user.uid}`, 30, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });
  }

  let body: { widget?: unknown; range?: unknown; clientData?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const widget = typeof body.widget === "string" ? body.widget : "";
  if (!isWidgetType(widget)) {
    return NextResponse.json({ error: `Unknown widget "${widget}"` }, { status: 400 });
  }

  const rangeLabel = typeof body.range === "string" ? (body.range as RangeLabel) : undefined;

  try {
    const result = await explainWidget(user.restaurantSlug, widget, {
      role: user.role,
      range: rangeLabel ? { range: rangeLabel } : undefined,
      clientData: body.clientData,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    console.error("[ai-explain] error:", err);
    return NextResponse.json({ error: "Failed to explain. Please try again." }, { status: 500 });
  }
}
