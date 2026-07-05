import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { checkRateLimit } from "@/lib/rate-limit";
import { handleVoiceTurn } from "@/lib/ai/voice";
import type { ActorRef, ConversationTurn, VoicePendingAction } from "@/lib/ai/types";

/**
 * POST /api/admin/ai/voice
 * A single voice turn. The client does STT/TTS (via its SpeechProvider); this endpoint
 * receives a transcript and returns text to speak plus any pending confirmation.
 *
 * Voice is a client on top of the AI stack — it reuses the Assistant / Brief /
 * Recommendation / Purchasing / Automation engines and writes only what they write.
 * Owner/manager only. Approval-first: actions require a spoken confirmation.
 */
export async function POST(req: Request) {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try {
    user = await getAuthenticatedUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (user.role === "staff") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { allowed } = await checkRateLimit(`ai-voice:${user.uid}`, 20, 60_000);
  if (!allowed) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

  let body: { transcript?: unknown; history?: ConversationTurn[]; pending?: VoicePendingAction | null };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const transcript = typeof body.transcript === "string" ? body.transcript : "";
  if (!transcript.trim()) return NextResponse.json({ error: "Empty transcript." }, { status: 400 });

  const actor: ActorRef = { type: user.role === "manager" ? "manager" : "owner", id: user.uid };

  try {
    const result = await handleVoiceTurn(user.restaurantSlug, transcript, {
      history: Array.isArray(body.history) ? body.history : undefined,
      pending: body.pending ?? null,
      actor,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    console.error("[ai-voice] error:", err);
    return NextResponse.json({ error: "Voice request failed. Please try again." }, { status: 500 });
  }
}
