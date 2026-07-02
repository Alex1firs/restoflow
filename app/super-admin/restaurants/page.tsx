import { getAdminDb } from "@/lib/firebase-admin";
import { getPlanSafe } from "@/lib/plans";
import RestaurantsClient from "./RestaurantsClient";

export const revalidate = 0;

export default async function SuperAdminRestaurantsPage() {
  const db = getAdminDb();
  const snap = await db.collection("restaurants").orderBy("createdAt", "desc").get();
  const now = new Date();

  const restaurants = snap.docs.map((doc) => {
    const d = doc.data();
    const endDate = d.subscriptionEndDate
      ? (d.subscriptionEndDate.toDate ? d.subscriptionEndDate.toDate() : new Date((d.subscriptionEndDate.seconds ?? 0) * 1000))
      : null;

    let status: string = (d.subscriptionStatus as string) ?? "trialing";
    if (status !== "suspended" && endDate && endDate < now) status = "expired";

    const plan = getPlanSafe(d.planId as string);
    const createdAt = d.createdAt
      ? (d.createdAt.toDate ? d.createdAt.toDate() : new Date((d.createdAt.seconds ?? 0) * 1000))
      : null;

    return {
      slug: doc.id,
      name: (d.name as string) ?? doc.id,
      email: (d.email as string) ?? "",
      phone: (d.phone as string) ?? "",
      planId: (d.planId as string) ?? "",
      planName: plan?.name ?? (d.planId as string) ?? "—",
      status,
      endDate: endDate ? endDate.toISOString() : null,
      createdAt: createdAt ? createdAt.toISOString() : null,
      ownerUid: (d.ownerUid as string) ?? "",
      whatsappCheckoutEnabled: !!d.whatsappCheckoutEnabled,
      whatsappAdminPin: (d.whatsappAdminPin as string) ?? "",
    };
  });

  return <RestaurantsClient restaurants={restaurants} />;
}
