import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";

export default async function AdminPage() {
  const cookieStore = await cookies();
  const session = cookieStore.get("__session")?.value;

  if (session) {
    try {
      const decoded = await getAdminAuth().verifySessionCookie(session, true);
      const userDoc = await getAdminDb().collection("users").doc(decoded.uid).get();
      
      if (userDoc.exists) {
        const userData = userDoc.data()!;
        if (userData.role === "super_admin") {
          redirect("/super-admin/overview");
        }
        const slug = userData.restaurantSlug as string;
        if (slug) {
          redirect(`/admin/${slug}/orders`);
        }
      }
    } catch {
      // Invalid or expired session
    }
  }

  // Fallback to login
  redirect("/admin/login");
}
