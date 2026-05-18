import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";
import { getGoogleConfig } from "@/lib/google-oauth";

export async function GET() {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try {
    user = await getAuthenticatedUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const snap = await getAdminDb()
    .collection("restaurants")
    .doc(user.restaurantSlug)
    .get();

  if (!snap.exists) {
    return NextResponse.json({ error: "Restaurant not found" }, { status: 404 });
  }

  const data = snap.data()!;
  const gb = (data.googleBusiness ?? {}) as Record<string, unknown>;
  const { configured } = getGoogleConfig();

  // Return only non-sensitive fields — tokens are never sent to the frontend
  return NextResponse.json({
    apiConfigured: configured,
    connected: (gb.connected as boolean) ?? false,
    connectedEmail: (gb.connectedEmail as string) ?? null,
    googleUserId: (gb.googleUserId as string) ?? null,
    googleAccountId: (gb.googleAccountId as string) ?? null,
    googleLocationId: (gb.googleLocationId as string) ?? null,
    profileStatus: (gb.profileStatus as string) ?? "not_connected",
    verificationStatus: (gb.verificationStatus as string) ?? null,
    lastSyncedAt: gb.lastSyncedAt ?? null,
    lastSyncError: (gb.lastSyncError as string) ?? null,
    draft: (gb.draft as Record<string, unknown>) ?? null,
  });
}
