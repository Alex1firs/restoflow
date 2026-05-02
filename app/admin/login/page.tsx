import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
import LoginClient from "./LoginClient";

export default async function LoginPage() {
  // If the user already has a valid session, send them straight to their dashboard
  const cookieStore = await cookies();
  const session = cookieStore.get("__session")?.value;

  if (session) {
    try {
      const decoded = await getAdminAuth().verifySessionCookie(session, true);
      const userDoc = await getAdminDb().collection("users").doc(decoded.uid).get();
      if (userDoc.exists) {
        const slug = userDoc.data()!.restaurantSlug as string;
        redirect(`/admin/${slug}/orders`);
      }
    } catch {
      // Invalid or expired session — fall through and show the login form
    }
  }

  return <LoginClient />;
}
