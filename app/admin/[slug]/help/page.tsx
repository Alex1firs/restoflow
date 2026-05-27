import { redirect, notFound } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";
import AdminNav from "../components/AdminNav";
import HelpClient from "./HelpClient";

export const revalidate = 0;

type Props = {
  params: Promise<{ slug: string }>;
};

export default async function HelpPage({ params }: Props) {
  const { slug } = await params;

  const user = await getAuthenticatedUser();
  if (user.restaurantSlug !== slug) {
    redirect(`/admin/${user.restaurantSlug}/help`);
  }

  const db = getAdminDb();
  const snap = await db.collection("restaurants").doc(slug).get();
  if (!snap.exists) return notFound();

  return (
    <div className="flex min-h-screen bg-gray-50">
      <AdminNav slug={slug} role={user.role as "owner" | "manager" | "staff"} />
      <div className="flex-1 min-w-0 pt-14 pb-16 lg:pt-0 lg:pb-0">
        <HelpClient slug={slug} />
      </div>
    </div>
  );
}
