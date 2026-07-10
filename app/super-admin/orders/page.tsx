import { getSuperAdminUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";
import OrdersClient from "./OrdersClient";

export const dynamic = "force-dynamic";

// Server wrapper: gate + preload the restaurant list for the filter dropdown.
// Read-only. The order rows themselves are fetched client-side from the
// super-admin-gated /api/super-admin/orders endpoint.
export default async function LiveOrdersPage() {
  await getSuperAdminUser(); // layout also gates; explicit for safety

  const snap = await getAdminDb().collection("restaurants").select("name").get();
  const restaurants = snap.docs
    .map((d) => ({ slug: d.id, name: ((d.data() as Record<string, unknown>).name as string | undefined) ?? d.id }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return <OrdersClient restaurants={restaurants} />;
}
