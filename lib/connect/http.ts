import "server-only";
import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";
import { readConnectSettings, connectReadiness } from "./config";

/**
 * Authorise a Connect request.
 *
 * ── The slug comes from the session, never the request ───────────────────────
 * Every Connect route acts on exactly one restaurant: the caller's own. Taking
 * the slug from a body or a query parameter would make cross-tenant access a
 * typo away, and this is a surface that spends real money on couriers.
 */
export type ConnectCaller = { restaurantId: string; uid: string };

export async function authoriseConnect(): Promise<
  { ok: true; caller: ConnectCaller } | { ok: false; response: NextResponse }
> {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try {
    user = await getAuthenticatedUser();
  } catch {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const snap = await getAdminDb().collection("restaurants").doc(user.restaurantSlug).get();
  const settings = readConnectSettings(snap.data());
  const readiness = connectReadiness(settings, {
    isProduction: (process.env.DELIVERY_ENVIRONMENT ?? "development") === "production",
  });

  if (!readiness.ok) {
    // 404, not 403. A restaurant without Connect should not be able to tell
    // that the capability exists, let alone probe why it was refused.
    return { ok: false, response: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }

  return { ok: true, caller: { restaurantId: user.restaurantSlug, uid: user.uid } };
}
