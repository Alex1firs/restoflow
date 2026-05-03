import { getAdminDb } from "@/lib/firebase-admin";
import { getPlan } from "@/lib/plans";
import SubscriptionsClient from "./SubscriptionsClient";

export const revalidate = 0;

export default async function SuperAdminSubscriptionsPage() {
  const db = getAdminDb();
  const snap = await db.collection("restaurants").get();
  const now = new Date();

  const subscriptions = snap.docs.map((doc) => {
    const d = doc.data();
    const endDate = d.subscriptionEndDate
      ? (d.subscriptionEndDate.toDate ? d.subscriptionEndDate.toDate() : new Date((d.subscriptionEndDate.seconds ?? 0) * 1000))
      : null;
    const startDate = d.subscriptionStartDate
      ? (d.subscriptionStartDate.toDate ? d.subscriptionStartDate.toDate() : new Date((d.subscriptionStartDate.seconds ?? 0) * 1000))
      : null;

    let status: string = (d.subscriptionStatus as string) ?? "trialing";
    if (status !== "suspended" && endDate && endDate < now) status = "expired";

    const daysRemaining = endDate && endDate > now ? Math.ceil((endDate.getTime() - now.getTime()) / 86400000) : null;
    const plan = getPlan(d.planId as string);

    return {
      slug: doc.id,
      name: (d.name as string) ?? doc.id,
      planId: (d.planId as string) ?? "",
      planName: plan?.name ?? (d.planId as string) ?? "—",
      monthlyPrice: plan?.monthlyPrice ?? 0,
      status,
      startDate: startDate ? startDate.toISOString() : null,
      endDate: endDate ? endDate.toISOString() : null,
      daysRemaining,
    };
  });

  subscriptions.sort((a, b) => {
    const order = { expired: 0, suspended: 1, trialing: 2, active: 3 };
    return (order[a.status as keyof typeof order] ?? 4) - (order[b.status as keyof typeof order] ?? 4);
  });

  return <SubscriptionsClient subscriptions={subscriptions} />;
}
