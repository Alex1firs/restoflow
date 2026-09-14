import { redirect, notFound } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";
import { getSubscriptionInfo } from "@/lib/subscription";
import { readConnectSettings, connectReadiness } from "@/lib/connect/config";
import AdminNav from "../components/AdminNav";
import SubscriptionBanner from "../components/SubscriptionBanner";
import ConnectClient from "./ConnectClient";

export const revalidate = 0;

export default async function ConnectPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getAuthenticatedUser();
  if (user.restaurantSlug !== slug) redirect(`/admin/${user.restaurantSlug}/connect`);

  const snap = await getAdminDb().collection("restaurants").doc(slug).get();
  if (!snap.exists) return notFound();
  const data = snap.data()!;

  // A restaurant without Connect gets Not Found, not a locked door — the same
  // answer the API gives, so the page cannot be used to discover the feature.
  const readiness = connectReadiness(readConnectSettings(data), {
    isProduction: (process.env.DELIVERY_ENVIRONMENT ?? "development") === "production",
  });
  if (!readiness.ok) return notFound();

  const subscription = await getSubscriptionInfo(data as Record<string, unknown>);

  return (
    <div className="flex min-h-screen bg-gray-100">
      <AdminNav slug={slug} role={user.role as "owner" | "manager" | "staff"} />
      <div className="flex-1 min-w-0 pt-14 pb-16 lg:pt-0 lg:pb-0">
        <SubscriptionBanner subscription={subscription} />
        <ConnectClient
          slug={slug}
          pickup={{
            name: String(data.name ?? slug),
            address: String(data.address ?? ""),
          }}
        />
      </div>
    </div>
  );
}
