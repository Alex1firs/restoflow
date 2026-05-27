import { redirect, notFound } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";
import { getSubscriptionInfo } from "@/lib/subscription";
import AdminOrdersClient from "./AdminOrdersClient";
import AdminNav from "../components/AdminNav";
import SubscriptionBanner from "../components/SubscriptionBanner";
import BillingSection from "../components/BillingSection";

export const revalidate = 0;

type Props = {
  params: Promise<{ slug: string }>;
};

export default async function AdminOrdersPage({ params }: Props) {
  const resolvedParams = await params;
  const slug = resolvedParams.slug;

  // 1. Verify session — redirects to login if invalid
  const user = await getAuthenticatedUser();

  // 2. Enforce ownership — silently redirect to their own restaurant
  if (user.restaurantSlug !== slug) {
    redirect(`/admin/${user.restaurantSlug}/orders`);
  }

  // 3. Load restaurant data
  const restaurantSnap = await getAdminDb().collection("restaurants").doc(slug).get();
  if (!restaurantSnap.exists) return notFound();

  const data = restaurantSnap.data()!;

  const restaurant = {
    id: restaurantSnap.id,
    name: data.name as string,
    slug: data.slug as string,
  };

  // 4. Derive subscription state (fetches plan name from plans collection)
  const subscription = await getSubscriptionInfo(data as Record<string, unknown>);

  return (
    <div className="flex min-h-screen bg-gray-100">
      <AdminNav slug={slug} role={user.role as "owner" | "manager" | "staff"} />
      <div className="flex-1 min-w-0 pt-14 pb-16 lg:pt-0 lg:pb-0">
        <SubscriptionBanner subscription={subscription} />
        <div className="relative">
          <AdminOrdersClient restaurant={restaurant} />
          {/* Billing card pinned to top-right of content area */}
          <div className="hidden xl:block absolute top-8 right-4 w-72">
            <BillingSection
              restaurantSlug={slug}
              planId={subscription.planId}
              planName={subscription.planName}
              monthlyPrice={subscription.monthlyPrice}
              subscriptionStatus={subscription.status}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
