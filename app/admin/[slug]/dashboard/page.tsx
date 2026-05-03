import { redirect, notFound } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";
import { getSubscriptionInfo } from "@/lib/subscription";
import DashboardClient from "./DashboardClient";
import AdminNav from "../components/AdminNav";
import SubscriptionBanner from "../components/SubscriptionBanner";

export const revalidate = 0;

type Props = {
  params: Promise<{ slug: string }>;
};

export default async function DashboardPage({ params }: Props) {
  const resolvedParams = await params;
  const slug = resolvedParams.slug;

  const user = await getAuthenticatedUser();

  if (user.restaurantSlug !== slug) {
    redirect(`/admin/${user.restaurantSlug}/dashboard`);
  }

  const restaurantSnap = await getAdminDb().collection("restaurants").doc(slug).get();
  if (!restaurantSnap.exists) return notFound();

  const data = restaurantSnap.data()!;
  const subscription = await getSubscriptionInfo(data as Record<string, unknown>);

  return (
    <div className="bg-gray-50 min-h-screen">
      <AdminNav slug={slug} role={user.role as "owner" | "manager" | "staff"} />
      <SubscriptionBanner subscription={subscription} />
      <DashboardClient slug={slug} />
    </div>
  );
}
