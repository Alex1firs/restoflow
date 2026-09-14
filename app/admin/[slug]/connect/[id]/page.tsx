import { redirect, notFound } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";
import { readConnectSettings, connectReadiness } from "@/lib/connect/config";
import AdminNav from "../../components/AdminNav";
import ConnectDetailClient from "./ConnectDetailClient";

export const revalidate = 0;

export default async function ConnectDetailPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  const user = await getAuthenticatedUser();
  if (user.restaurantSlug !== slug) redirect(`/admin/${user.restaurantSlug}/connect`);

  const snap = await getAdminDb().collection("restaurants").doc(slug).get();
  if (!snap.exists) return notFound();
  const readiness = connectReadiness(readConnectSettings(snap.data()), {
    isProduction: (process.env.DELIVERY_ENVIRONMENT ?? "development") === "production",
  });
  if (!readiness.ok) return notFound();

  return (
    <div className="flex min-h-screen bg-gray-100">
      <AdminNav slug={slug} role={user.role as "owner" | "manager" | "staff"} />
      <div className="flex-1 min-w-0 pt-14 pb-16 lg:pt-0 lg:pb-0">
        <ConnectDetailClient slug={slug} id={id} />
      </div>
    </div>
  );
}
