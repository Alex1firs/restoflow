import { redirect, notFound } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";
import { getSubscriptionInfo } from "@/lib/subscription";
import AdminNav from "../components/AdminNav";
import SubscriptionBanner from "../components/SubscriptionBanner";
import POSClient from "./POSClient";

export const revalidate = 0;

type Props = {
  params: Promise<{ slug: string }>;
};

export default async function POSPage({ params }: Props) {
  const { slug } = await params;

  const user = await getAuthenticatedUser();

  if (user.restaurantSlug !== slug) {
    redirect(`/admin/${user.restaurantSlug}/pos`);
  }

  const db = getAdminDb();
  const restaurantSnap = await db.collection("restaurants").doc(slug).get();
  if (!restaurantSnap.exists) return notFound();

  const data = restaurantSnap.data()!;

  const menuSnap = await db
    .collection("prepared_items")
    .where("restaurantId", "==", slug)
    .get();

  const menuItems = menuSnap.docs.map((doc) => {
    const d = doc.data();
    return {
      id: doc.id,
      name: (d.name as string) ?? "",
      description: (d.description as string) ?? "",
      price: (d.price as number) ?? 0,
      indoorPrice: (d.indoorPrice as number | undefined) ?? null,
      category: (d.category as string) ?? "Other",
      available: (d.available as boolean) ?? true,
      image: (d.image as string) ?? "",
      itemType: (d.itemType as "item" | "combo") ?? "item",
      basePrice: (d.basePrice as number) ?? (d.price as number) ?? 0,
      sizes: (d.sizes as any[] | undefined) ?? null,
      modifierGroups: (d.modifierGroups as any[] | undefined) ?? null,
      kitchenStation: (d.kitchenStation as string) ?? "kitchen",
      allowCustomPrice: (d.allowCustomPrice as boolean) ?? false,
      comboItems: (d.comboItems as any[] | undefined) ?? null,
    };
  });

  const restaurant = {
    slug: data.slug as string,
    name: data.name as string,
    cancellationManagerPinEnabled: data.cancellationManagerPinEnabled !== false,
    cancellationOwnerApprovalEnabled: data.cancellationOwnerApprovalEnabled !== false,
  };

  const userDoc = await db.collection("users").doc(user.uid).get();
  const userData = userDoc.data();
  const staffName =
    (userData?.displayName as string | undefined) ||
    (userData?.name as string | undefined) ||
    (userData?.email as string | undefined) ||
    "Staff";

  const subscription = await getSubscriptionInfo(data as Record<string, unknown>);

  return (
    <div className="flex min-h-screen bg-gray-100">
      <AdminNav slug={slug} role={user.role as "owner" | "manager" | "staff"} />
      <div className="flex-1 min-w-0 flex flex-col pt-14 lg:pt-0">
        <SubscriptionBanner subscription={subscription} />
        <div className="flex-1 flex flex-col overflow-hidden">
          <POSClient
            restaurant={restaurant}
            menuItems={menuItems}
            staffName={staffName}
            staffId={user.uid}
            role={user.role as "owner" | "manager" | "staff"}
          />
        </div>
      </div>
    </div>
  );
}
