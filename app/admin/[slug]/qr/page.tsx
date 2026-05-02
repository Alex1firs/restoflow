import { redirect, notFound } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";
import { getSubscriptionInfo } from "@/lib/subscription";
import AdminNav from "../components/AdminNav";
import SubscriptionBanner from "../components/SubscriptionBanner";
import QRClient from "./QRClient";

type Props = { params: Promise<{ slug: string }> };

export const revalidate = 0;

export default async function QRPage({ params }: Props) {
  const { slug } = await params;
  const user = await getAuthenticatedUser();

  if (user.restaurantSlug !== slug) {
    redirect(`/admin/${user.restaurantSlug}/qr`);
  }

  const snap = await getAdminDb().collection("restaurants").doc(slug).get();
  if (!snap.exists) return notFound();

  const data = snap.data()!;
  const subscription = await getSubscriptionInfo(data as Record<string, unknown>);

  return (
    <div className="bg-gray-100 min-h-screen">
      <AdminNav slug={slug} />
      <SubscriptionBanner subscription={subscription} />
      <QRClient
        slug={slug}
        restaurantName={data.name as string}
        appUrl={process.env.NEXT_PUBLIC_APP_URL ?? ""}
      />
    </div>
  );
}
