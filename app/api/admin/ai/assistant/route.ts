import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { checkRateLimit } from "@/lib/rate-limit";
import { askAssistant } from "@/lib/ai/assistant";
import type { ConversationTurn } from "@/lib/ai/types";

/**
 * POST /api/admin/ai/assistant
 * Body: { question: string }
 *
 * The Restaurant Intelligence Assistant. Answers a question strictly from the
 * tenant's own data via the tool layer + context builder. Managerial surface
 * (owner/manager only). Rate-limited to bound cost.
 *
 * Always returns 200 with an answer — when no LLM is configured it degrades to a
 * deterministic summary (`degraded: true`) rather than failing, so the feature
 * still works. 401/403 for auth, 400 for a bad question, 429 when rate-limited.
 */
export async function POST(req: NextRequest) {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try {
    user = await getAuthenticatedUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Intelligence is a managerial surface — not exposed to line staff.
  if (user.role === "staff") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Bound cost/abuse: 15 questions per minute per user.
  const { allowed } = await checkRateLimit(`ai-assistant:${user.uid}`, 15, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });
  }

  let body: { question?: unknown; history?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) {
    return NextResponse.json({ error: "A question is required." }, { status: 400 });
  }
  if (question.length > 500) {
    return NextResponse.json({ error: "Question is too long (max 500 characters)." }, { status: 400 });
  }

  // Conversation memory is client-supplied (server stays stateless). Validate shape.
  const history: ConversationTurn[] = Array.isArray(body.history)
    ? (body.history as unknown[])
        .filter(
          (t): t is ConversationTurn =>
            !!t && typeof (t as ConversationTurn).question === "string" && typeof (t as ConversationTurn).answer === "string"
        )
        .slice(-6)
    : [];

  try {
    const result = await askAssistant(user.restaurantSlug, question, { role: user.role, history });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    console.error("[ai-assistant] error:", err);
    return NextResponse.json({ error: "Failed to answer. Please try again." }, { status: 500 });
  }
}
