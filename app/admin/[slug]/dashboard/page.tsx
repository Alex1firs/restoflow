import { redirect, notFound } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";
import { getSubscriptionInfo } from "@/lib/subscription";
import { computeSetupChecklist } from "@/lib/setup-checklist";
import DashboardClient from "./DashboardClient";
import AdminNav from "../components/AdminNav";
import SubscriptionBanner from "../components/SubscriptionBanner";

export const revalidate = 0;

type Props = {
  params: Promise<{ slug: string }>;
};

export default async function DashboardPage({ params }: Props) {
  const resolvedParams = await params;
  const slug = resolvedParams.slug;

  const user = await getAuthenticatedUser();

  if (user.restaurantSlug !== slug) {
    redirect(`/admin/${user.restaurantSlug}/dashboard`);
  }

  const db = getAdminDb();

  const [restaurantSnap, menuCountSnap] = await Promise.all([
    db.collection("restaurants").doc(slug).get(),
    db.collection("menu_items").where("restaurantId", "==", slug).count().get(),
  ]);

  if (!restaurantSnap.exists) return notFound();

  const data = restaurantSnap.data()!;
  const subscription = await getSubscriptionInfo(data as Record<string, unknown>);
  const setupChecklist = computeSetupChecklist(
    data as Record<string, unknown>,
    menuCountSnap.data().count
  );

  return (
    <div className="flex min-h-screen bg-gray-50">
      <AdminNav slug={slug} role={user.role as "owner" | "manager" | "staff"} />
      <div className="flex-1 min-w-0 pt-14 pb-16 lg:pt-0 lg:pb-0">
        <SubscriptionBanner subscription={subscription} />
        <DashboardClient
          slug={slug}
          status={(data.status as string) || "draft"}
          rejectionReason={data.rejectionReason as string | undefined}
          setupChecklist={setupChecklist}
          assistanceStatus={(data.assistanceStatus as string) || undefined}
          role={user.role}
        />
      </div>
    </div>
  );
}
