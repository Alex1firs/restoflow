import { redirect, notFound } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";
import { getSubscriptionInfo } from "@/lib/subscription";
import AdminNav from "../components/AdminNav";
import SubscriptionBanner from "../components/SubscriptionBanner";
import DomainClient from "./DomainClient";

type Props = { params: Promise<{ slug: string }> };

export const revalidate = 0;

export default async function DomainPage({ params }: Props) {
  const { slug } = await params;
  const user = await getAuthenticatedUser();

  if (user.restaurantSlug !== slug) {
    redirect(`/admin/${user.restaurantSlug}/domain`);
  }

  if (user.role !== "owner") {
    redirect(`/admin/${slug}/dashboard`);
  }

  const snap = await getAdminDb().collection("restaurants").doc(slug).get();
  if (!snap.exists) return notFound();

  const data = snap.data()!;
  const subscription = await getSubscriptionInfo(data as Record<string, unknown>);

  return (
    <div className="bg-gray-100 min-h-screen">
      <AdminNav slug={slug} role="owner" />
      <SubscriptionBanner subscription={subscription} />
      <DomainClient slug={slug} />
    </div>
  );
}
