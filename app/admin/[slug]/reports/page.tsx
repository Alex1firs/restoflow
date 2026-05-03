import { redirect, notFound } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";
import { getSubscriptionInfo } from "@/lib/subscription";
import AdminNav from "../components/AdminNav";
import SubscriptionBanner from "../components/SubscriptionBanner";
import ReportsClient from "./ReportsClient";

export const revalidate = 0;

type Props = { params: Promise<{ slug: string }> };

export default async function ReportsPage({ params }: Props) {
  const { slug } = await params;
  const user = await getAuthenticatedUser();

  if (user.restaurantSlug !== slug) redirect(`/admin/${user.restaurantSlug}/reports`);
  if (user.role === "staff") redirect(`/admin/${slug}/dashboard`);

  const snap = await getAdminDb().collection("restaurants").doc(slug).get();
  if (!snap.exists) return notFound();

  const subscription = await getSubscriptionInfo(snap.data()! as Record<string, unknown>);

  return (
    <div className="bg-gray-100 min-h-screen">
      <AdminNav slug={slug} role={user.role as "owner" | "manager" | "staff"} />
      <SubscriptionBanner subscription={subscription} />
      <ReportsClient slug={slug} />
    </div>
  );
}
