import { getSuperAdminUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";
import { readFlags } from "@/lib/marketplace/config";
import { notFound } from "next/navigation";
import MarketplaceOpsClient from "./MarketplaceOpsClient";

export const dynamic = "force-dynamic";

/**
 * Marketplace operations.
 *
 * Server wrapper: gate, check the flag, preload the restaurant filter. The rows
 * themselves come from the super-admin-gated API so the board can refresh
 * without a navigation.
 */
export default async function MarketplaceOpsPage() {
  await getSuperAdminUser();

  // With the marketplace off the section does not exist, rather than rendering
  // an empty board that implies it is merely quiet.
  if (!readFlags().enabled) notFound();

  const snap = await getAdminDb().collection("restaurants").select("name").get();
  const restaurants = snap.docs
    .map((d) => ({ slug: d.id, name: ((d.data() as Record<string, unknown>).name as string | undefined) ?? d.id }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return <MarketplaceOpsClient restaurants={restaurants} />;
}
