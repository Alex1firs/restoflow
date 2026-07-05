import { redirect, notFound } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";
import AdminNav from "../components/AdminNav";
import OperatingProfileClient from "./OperatingProfileClient";

export const revalidate = 0;

type Props = { params: Promise<{ slug: string }> };

export default async function OperatingProfilePage({ params }: Props) {
  const { slug } = await params;
  const user = await getAuthenticatedUser();

  if (user.restaurantSlug !== slug) redirect(`/admin/${user.restaurantSlug}/operating-profile`);
  if (user.role === "staff") redirect(`/admin/${slug}/dashboard`);

  const snap = await getAdminDb().collection("restaurants").doc(slug).get();
  if (!snap.exists) return notFound();

  return (
    <div className="flex min-h-screen bg-gray-100">
      <AdminNav slug={slug} role={user.role as "owner" | "manager" | "staff"} />
      <div className="flex-1 min-w-0 pt-14 pb-16 lg:pt-0 lg:pb-0">
        <OperatingProfileClient />
      </div>
    </div>
  );
}
