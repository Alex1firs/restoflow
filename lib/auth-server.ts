import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAdminAuth, getAdminDb } from "./firebase-admin";

export type AuthenticatedUser = {
  uid: string;
  restaurantSlug: string;
};

/**
 * Verifies the session cookie and returns the authenticated user.
 * Redirects to /admin/login if the session is missing, expired, or
 * not linked to a restaurant. Call this at the top of every admin
 * server component before doing anything else.
 */
export async function getAuthenticatedUser(): Promise<AuthenticatedUser> {
  const cookieStore = await cookies();
  const session = cookieStore.get("__session")?.value;

  if (!session) {
    redirect("/admin/login");
  }

  try {
    // checkRevoked: true rejects tokens even if not yet expired but revoked
    const decoded = await getAdminAuth().verifySessionCookie(session, true);
    const userDoc = await getAdminDb().collection("users").doc(decoded.uid).get();

    if (!userDoc.exists) {
      redirect("/admin/login");
    }

    const restaurantSlug = userDoc.data()!.restaurantSlug as string;
    if (!restaurantSlug) {
      redirect("/admin/login");
    }

    return { uid: decoded.uid, restaurantSlug };
  } catch {
    redirect("/admin/login");
  }
}
