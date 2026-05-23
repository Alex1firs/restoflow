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
  if (user.role !== "owner") redirect(`/admin/${slug}/dashboard`);

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
    whatsappPhone: (data.whatsappPhone as string) ?? "",
    notificationPhone: (data.notificationPhone as string) ?? "",
    deliveryFee: (data.deliveryFee as number) ?? 0,
    minimumOrder: (data.minimumOrder as number) ?? 0,
    deliveryEnabled: (data.deliveryEnabled as boolean) ?? true,
    pickupEnabled: (data.pickupEnabled as boolean) ?? true,
    openingHours: (data.openingHours as OpeningHours) ?? null,
    whatsappEnabled: (data.whatsappEnabled as boolean) ?? false,
    alertPreference: ((data.alertPreference as string) ?? "sms") as "whatsapp" | "sms" | "both",
    paymentConfigured: !!(data.paystackSubaccountCode as string | undefined),
    paymentAccountName: (data.paystackAccountName as string) ?? "",
    paymentBankName: (data.paystackBankName as string) ?? "",
    primaryColor: (data.primaryColor as string) ?? "",
    accentColor: (data.accentColor as string) ?? "",
    promoBanner: (data.promoBanner as string) ?? "",
    rating: (data.rating as number) ?? null,
    ordersToday: (data.ordersToday as number) ?? null,
    deliveryTime: (data.deliveryTime as string) ?? "",
    hidePrices: (data.hidePrices as boolean) ?? false,
  };

  return (
    <div className="bg-gray-100 min-h-screen">
      <AdminNav slug={slug} role="owner" />
      <SubscriptionBanner subscription={subscription} />
      <SettingsClient restaurant={restaurant} />
    </div>
  );
}
