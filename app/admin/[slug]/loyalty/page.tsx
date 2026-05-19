import { redirect, notFound } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";
import { getSubscriptionInfo } from "@/lib/subscription";
import AdminNav from "../components/AdminNav";
import SubscriptionBanner from "../components/SubscriptionBanner";
import LoyaltyClient from "./LoyaltyClient";
import { DEFAULT_LOYALTY, type LoyaltySettings } from "@/lib/loyalty";

export const revalidate = 0;

type Props = { params: Promise<{ slug: string }> };

export default async function LoyaltyPage({ params }: Props) {
  const { slug } = await params;
  const user = await getAuthenticatedUser();

  if (user.restaurantSlug !== slug) redirect(`/admin/${user.restaurantSlug}/loyalty`);
  if (user.role === "staff") redirect(`/admin/${slug}/dashboard`);

  const snap = await getAdminDb().collection("restaurants").doc(slug).get();
  if (!snap.exists) return notFound();

  const data = snap.data()!;
  const subscription = await getSubscriptionInfo(data as Record<string, unknown>);

  const settings: LoyaltySettings = {
    ...DEFAULT_LOYALTY,
    ...((data.loyalty as Partial<LoyaltySettings>) ?? {}),
  };

  return (
    <div className="bg-gray-100 min-h-screen">
      <AdminNav slug={slug} role={user.role as "owner" | "manager" | "staff"} />
      <SubscriptionBanner subscription={subscription} />
      <LoyaltyClient
        slug={slug}
        initialSettings={settings}
        restaurantName={(data.name as string) ?? ""}
        userRole={user.role}
      />
    </div>
  );
}
