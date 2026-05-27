import { redirect, notFound } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";
import { getSubscriptionInfo } from "@/lib/subscription";
import AdminMenuClient from "./AdminMenuClient";
import AdminNav from "../components/AdminNav";
import SubscriptionBanner from "../components/SubscriptionBanner";

export const revalidate = 0;

type Props = {
  params: Promise<{ slug: string }>;
};

export default async function AdminMenuPage({ params }: Props) {
  const resolvedParams = await params;
  const slug = resolvedParams.slug;

  // 1. Verify session — redirects to login if invalid
  const user = await getAuthenticatedUser();

  // 2. Enforce ownership — silently redirect to their own restaurant
  if (user.restaurantSlug !== slug) {
    redirect(`/admin/${user.restaurantSlug}/menu`);
  }
  if (user.role === "staff") redirect(`/admin/${slug}/dashboard`);

  // 3. Load restaurant data
  const restaurantSnap = await getAdminDb().collection("restaurants").doc(slug).get();
  if (!restaurantSnap.exists) return notFound();

  const data = restaurantSnap.data()!;

  const restaurant = {
    id: restaurantSnap.id,
    name: data.name as string,
    slug: data.slug as string,
  };

  // 4. Derive subscription state
  const subscription = await getSubscriptionInfo(data as Record<string, unknown>);

  return (
    <div className="flex min-h-screen bg-gray-100">
      <AdminNav slug={slug} role={user.role as "owner" | "manager" | "staff"} />
      <div className="flex-1 min-w-0 pt-14 pb-16 lg:pt-0 lg:pb-0">
        <SubscriptionBanner subscription={subscription} />
        <AdminMenuClient restaurant={restaurant} aiEnabled={!!process.env.GEMINI_API_KEY} />
      </div>
    </div>
  );
}
