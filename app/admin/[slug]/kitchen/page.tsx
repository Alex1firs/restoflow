import { redirect, notFound } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";
import AdminNav from "../components/AdminNav";
import KitchenClient from "./KitchenClient";

export const revalidate = 0;

type Props = {
  params: Promise<{ slug: string }>;
};

export default async function KitchenPage({ params }: Props) {
  const { slug } = await params;

  const user = await getAuthenticatedUser();

  if (user.restaurantSlug !== slug) {
    redirect(`/admin/${user.restaurantSlug}/kitchen`);
  }

  const db = getAdminDb();
  const restaurantSnap = await db.collection("restaurants").doc(slug).get();
  if (!restaurantSnap.exists) return notFound();

  const data = restaurantSnap.data()!;
  const restaurant = {
    slug: data.slug as string,
    name: data.name as string,
  };

  return (
    <div className="flex flex-col" style={{ height: "100dvh" }}>
      <AdminNav slug={slug} role={user.role as "owner" | "manager" | "staff"} />
      <KitchenClient restaurant={restaurant} role={user.role} />
    </div>
  );
}
