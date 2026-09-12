import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { reindexNow } from "@/lib/discovery/reindex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Refresh the discovery index for the caller's own restaurant.
 *
 * Called by the admin after a menu change, so a new dish is discoverable in
 * seconds rather than after the nightly reconcile.
 *
 * The slug is taken from the session, never from the request body: a reindex
 * reads a restaurant's whole menu, and accepting a caller-supplied slug would
 * turn this into a way to ask the server to go and read someone else's.
 */
export async function POST() {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try {
    user = await getAuthenticatedUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await reindexNow(getAdminDb(), user.restaurantSlug);
  return NextResponse.json({ ok: true });
}
