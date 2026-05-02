import { redirect, notFound } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";
import { getSubscriptionInfo } from "@/lib/subscription";
import AdminNav from "../components/AdminNav";
import SubscriptionBanner from "../components/SubscriptionBanner";
import SettingsClient from "./SettingsClient";
import type { OpeningHours } from "@/lib/restaurant-utils";

type Props = { params: Promise<{ slug: string }> };

export const revalidate = 0;

export default async function SettingsPage({ params }: Props) {
  const { slug } = await params;
  const user = await getAuthenticatedUser();

  if (user.restaurantSlug !== slug) {
    redirect(`/admin/${user.restaurantSlug}/settings`);
  }

  const snap = await getAdminDb().collection("restaurants").doc(slug).get();
  if (!snap.exists) return notFound();

  const data = snap.data()!;
  const subscription = await getSubscriptionInfo(data as Record<string, unknown>);

  const restaurant = {
    slug,
    name: (data.name as string) ?? "",
    description: (data.description as string) ?? "",
    logo: (data.logo as string) ?? "",
    coverImage: (data.coverImage as string) ?? "",
    phone: (data.phone as string) ?? "",
    address: (data.address as string) ?? "",
    notificationPhone: (data.notificationPhone as string) ?? "",
    deliveryFee: (data.deliveryFee as number) ?? 0,
    minimumOrder: (data.minimumOrder as number) ?? 0,
    openingHours: (data.openingHours as OpeningHours) ?? null,
    whatsappPhone: (data.whatsappPhone as string) ?? "",
    whatsappEnabled: (data.whatsappEnabled as boolean) ?? false,
    alertPreference: ((data.alertPreference as string) ?? "sms") as "whatsapp" | "sms" | "both",
  };

  return (
    <div className="bg-gray-100 min-h-screen">
      <AdminNav slug={slug} />
      <SubscriptionBanner subscription={subscription} />
      <SettingsClient restaurant={restaurant} />
    </div>
  );
}
