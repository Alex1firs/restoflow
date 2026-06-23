import { redirect, notFound } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";
import { getSubscriptionInfo } from "@/lib/subscription";
import AdminNav from "../components/AdminNav";
import SubscriptionBanner from "../components/SubscriptionBanner";
import SettingsClient from "./SettingsClient";
import type { OpeningHours } from "@/lib/restaurant-utils";
import { DEFAULT_HERO_SETTINGS, type HeroSettings } from "@/lib/hero-settings";

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
    coverVideo: (data.coverVideo as string) ?? "",
    phone: (data.phone as string) ?? "",
    address: (data.address as string) ?? "",
    telegramChatId: (data.telegramChatId as string) ?? "",
    notificationPhone: (data.notificationPhone as string) ?? "",
    deliveryFee: (data.deliveryFee as number) ?? 0,
    minimumOrder: (data.minimumOrder as number) ?? 0,
    deliveryEnabled: (data.deliveryEnabled as boolean) ?? true,
    pickupEnabled: (data.pickupEnabled as boolean) ?? true,
    openingHours: (data.openingHours as OpeningHours) ?? null,
    telegramEnabled: (data.telegramEnabled as boolean) ?? false,
    alertPreference: ((data.alertPreference as string) ?? "sms") as "telegram" | "sms" | "both",
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
    dineInEnabled: (data.dineInEnabled as boolean) ?? false,
    heroSettings: ((data.heroSettings as HeroSettings) ?? DEFAULT_HERO_SETTINGS),
  };

  const menuSnap = await getAdminDb().collection("menu_items").where("restaurantId", "==", slug).get();
  const menuItems = menuSnap.docs.map((d) => ({
    id: d.id,
    name: (d.data().name as string) ?? "",
    price: (d.data().price as number) ?? 0,
    available: (d.data().available as boolean) ?? true,
    image: (d.data().image as string) ?? "",
    description: (d.data().description as string) ?? "",
    category: (d.data().category as string) ?? "",
  }));

  return (
    <div className="flex min-h-screen bg-gray-100 admin-layout">
      <AdminNav slug={slug} role="owner" />
      <div className="flex-1 min-w-0 pt-14 pb-16 lg:pt-0 lg:pb-0">
        <SubscriptionBanner subscription={subscription} />
        <SettingsClient
          restaurant={restaurant}
          menuItems={menuItems}
          aiEnabled={!!process.env.GEMINI_API_KEY}
        />
      </div>
    </div>
  );
}
