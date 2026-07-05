import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";
import { buildVoiceGreeting } from "@/lib/ai/voice";

/**
 * GET /api/admin/ai/voice/greeting
 * The voice-first greeting spoken when the owner opens the app. Read-only: reuses the
 * cached Daily Brief + Recommendation Engine. Owner/manager only.
 */
export async function GET() {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try {
    user = await getAuthenticatedUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (user.role === "staff") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Personalise with the owner's first name when available (a single cheap doc read).
  let userName: string | undefined;
  try {
    const doc = await getAdminDb().collection("users").doc(user.uid).get();
    const display = (doc.data()?.displayName as string | undefined) ?? (doc.data()?.name as string | undefined);
    if (display) userName = display.trim().split(/\s+/)[0];
  } catch {
    /* name is optional */
  }

  const greeting = await buildVoiceGreeting(user.restaurantSlug, { userName });
  return NextResponse.json({ greeting }, { status: 200 });
}
