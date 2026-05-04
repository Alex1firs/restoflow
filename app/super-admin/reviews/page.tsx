import { getAdminDb } from "@/lib/firebase-admin";
import { computeSetupChecklist } from "@/lib/setup-checklist";
import ReviewsClient from "./ReviewsClient";

export const revalidate = 0;

export default async function ReviewsPage() {
  const db = getAdminDb();

  const snap = await db
    .collection("restaurants")
    .where("status", "==", "pending_review")
    .get();

  const restaurants = await Promise.all(
    snap.docs.map(async (doc) => {
      const d = doc.data();
      const slug = doc.id;

      const menuCountSnap = await db
        .collection("menu_items")
        .where("restaurantId", "==", slug)
        .count()
        .get();
      const menuItemCount = menuCountSnap.data().count;

      const checklist = computeSetupChecklist(d as Record<string, unknown>, menuItemCount);

      const updatedAt = d.updatedAt
        ? (d.updatedAt.toDate ? d.updatedAt.toDate() : new Date((d.updatedAt.seconds ?? 0) * 1000))
        : d.createdAt
        ? (d.createdAt.toDate ? d.createdAt.toDate() : new Date((d.createdAt.seconds ?? 0) * 1000))
        : null;

      return {
        slug,
        name: (d.name as string) ?? slug,
        email: (d.email as string) ?? "",
        phone: (d.phone as string) ?? "",
        address: (d.address as string) ?? "",
        menuItemCount,
        paymentConfigured: !!(d.paystackSubaccountCode as string),
        customDomain: (d.customDomain as string) || null,
        subscriptionStatus: (d.subscriptionStatus as string) ?? "trialing",
        setupScore: (d.setupScore as number) ?? checklist.score,
        checklist,
        createdAt: updatedAt ? updatedAt.toISOString() : null,
        status: (d.status as string) ?? "pending_review",
      };
    })
  );

  restaurants.sort((a, b) => {
    if (!a.createdAt) return 1;
    if (!b.createdAt) return -1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return <ReviewsClient restaurants={restaurants} />;
}
