import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";
import { readConnectSettings, connectReadiness } from "@/lib/connect/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Whether to show Connect in the navigation.
 *
 * The nav is a client component, so it asks — the same way it already asks
 * about the custom domain. Returns a bare boolean and nothing else: a
 * restaurant without Connect learns only that it does not have it.
 */
export async function GET() {
  try {
    const user = await getAuthenticatedUser();
    const snap = await getAdminDb().collection("restaurants").doc(user.restaurantSlug).get();
    const readiness = connectReadiness(readConnectSettings(snap.data()), {
      isProduction: (process.env.DELIVERY_ENVIRONMENT ?? "development") === "production",
    });
    return NextResponse.json({ enabled: readiness.ok });
  } catch {
    return NextResponse.json({ enabled: false });
  }
}
