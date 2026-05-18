import { redirect, notFound } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";
import { getSubscriptionInfo } from "@/lib/subscription";
import { getGoogleConfig } from "@/lib/google-oauth";
import AdminNav from "../../components/AdminNav";
import SubscriptionBanner from "../../components/SubscriptionBanner";
import GoogleBusinessClient from "./GoogleBusinessClient";
import type { OpeningHours } from "@/lib/restaurant-utils";

export const revalidate = 0;

type Props = { params: Promise<{ slug: string }> };

export default async function GoogleBusinessPage({ params }: Props) {
  const { slug } = await params;
  const user = await getAuthenticatedUser();

  if (user.restaurantSlug !== slug) {
    redirect(`/admin/${user.restaurantSlug}/seo/google-business`);
  }
  if (user.role === "staff") redirect(`/admin/${slug}/dashboard`);

  const snap = await getAdminDb().collection("restaurants").doc(slug).get();
  if (!snap.exists) return notFound();

  const data = snap.data()!;
  const subscription = await getSubscriptionInfo(data as Record<string, unknown>);
  const { configured: apiConfigured } = getGoogleConfig();

  const restaurant = {
    slug,
    name: (data.name as string) ?? "",
    description: (data.description as string) ?? "",
    phone: (data.phone as string) ?? "",
    address: (data.address as string) ?? "",
    openingHours: (data.openingHours as OpeningHours) ?? null,
  };

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const customDomain = (data.customDomain as string) ?? "";
  const publicUrl = customDomain ? `https://${customDomain}` : `${appUrl}/r/${slug}`;

  return (
    <div className="bg-gray-100 min-h-screen">
      <AdminNav slug={slug} role={user.role as "owner" | "manager" | "staff"} />
      <SubscriptionBanner subscription={subscription} />
      <GoogleBusinessClient
        slug={slug}
        restaurant={restaurant}
        publicUrl={publicUrl}
        apiConfigured={apiConfigured}
        subscriptionStatus={subscription.status}
        userRole={user.role}
      />
    </div>
  );
}
