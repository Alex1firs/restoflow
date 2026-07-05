import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  getOperatingProfile,
  updateOperatingProfile,
  resetLearnedPreferences,
  listProfileAudit,
  type ProfileUpdatePatch,
} from "@/lib/ai/profile";
import type { ActorRef } from "@/lib/ai/types";

/**
 * GET   /api/admin/ai/profile  → the Restaurant Operating Profile + audit history.
 * PATCH /api/admin/ai/profile  → owner edit (merges a section, bumps version, audits).
 * POST  /api/admin/ai/profile  → { op: "reset_learned" } clears learned preferences.
 *
 * Restaurant-scoped, owner/manager only. Writes only ai_operating_profiles +
 * ai_operating_profile_audit. Never touches business data.
 */

function actorFor(user: { role: string; uid: string }): ActorRef {
  return { type: user.role === "manager" ? "manager" : "owner", id: user.uid };
}

export async function GET() {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try {
    user = await getAuthenticatedUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (user.role === "staff") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const [profile, audit] = await Promise.all([getOperatingProfile(user.restaurantSlug), listProfileAudit(user.restaurantSlug)]);
  return NextResponse.json({ profile, audit }, { status: 200 });
}

export async function PATCH(req: Request) {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try {
    user = await getAuthenticatedUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (user.role === "staff") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { allowed } = await checkRateLimit(`ai-profile:${user.uid}`, 30, 60_000);
  if (!allowed) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

  let patch: ProfileUpdatePatch;
  try {
    patch = (await req.json()) as ProfileUpdatePatch;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!patch || (!patch.business && !patch.owner && !patch.ai && !patch.learned)) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const profile = await updateOperatingProfile(user.restaurantSlug, patch, actorFor(user));
  return NextResponse.json({ profile }, { status: 200 });
}

export async function POST(req: Request) {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try {
    user = await getAuthenticatedUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (user.role === "staff") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let op = "";
  try {
    op = String(((await req.json()) as { op?: unknown })?.op ?? "");
  } catch {
    /* no body */
  }
  if (op !== "reset_learned") return NextResponse.json({ error: `Unknown operation "${op}".` }, { status: 400 });

  const profile = await resetLearnedPreferences(user.restaurantSlug, actorFor(user));
  return NextResponse.json({ profile }, { status: 200 });
}
