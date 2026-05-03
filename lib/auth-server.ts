import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAdminAuth, getAdminDb } from "./firebase-admin";

export type UserRole = "owner" | "manager" | "staff" | "super_admin";

export type AuthenticatedUser = {
  uid: string;
  restaurantSlug: string;
  role: UserRole;
};

export type SuperAdminUser = {
  uid: string;
  role: "super_admin";
};

async function resolveSession() {
  const cookieStore = await cookies();
  const session = cookieStore.get("__session")?.value;
  if (!session) redirect("/admin/login");
  try {
    const decoded = await getAdminAuth().verifySessionCookie(session, true);
    const userDoc = await getAdminDb().collection("users").doc(decoded.uid).get();
    if (!userDoc.exists) redirect("/admin/login");
    return { uid: decoded.uid, data: userDoc.data()! };
  } catch {
    redirect("/admin/login");
  }
}

export async function getAuthenticatedUser(): Promise<AuthenticatedUser> {
  const { uid, data } = await resolveSession();
  const restaurantSlug = data.restaurantSlug as string | undefined;
  const role = (data.role as UserRole | undefined) ?? "owner";
  const disabled = (data.disabled as boolean | undefined) ?? false;

  if (!restaurantSlug || disabled) redirect("/admin/login");

  return { uid, restaurantSlug, role };
}

export async function getSuperAdminUser(): Promise<SuperAdminUser> {
  const { uid, data } = await resolveSession();
  const role = data.role as UserRole | undefined;
  if (role !== "super_admin") redirect("/admin/login");
  return { uid, role: "super_admin" };
}
