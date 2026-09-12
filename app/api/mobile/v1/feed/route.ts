import { getAdminDb } from "@/lib/firebase-admin";
import { withPublic, coordsFrom } from "@/lib/marketplace/mobile-api";
import { authenticateCustomer } from "@/lib/marketplace/customer";
import { createFirestoreStore } from "@/lib/discovery/firestore-store";
import { buildHomeFeed } from "@/lib/marketplace/feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The home feed — one call, served from the discovery index.
 *
 * ── What changed ─────────────────────────────────────────────────────────────
 * This used to scan `restaurants` on every request and sort the result in
 * memory, which is a second discovery implementation living next to the real
 * one. It now reads `discovery_restaurants`, filtered on `marketplaceVisible`
 * so a live RestoFlow tenant that never opted into the marketplace cannot
 * appear here merely by existing.
 *
 * ── Public, with an optional name ────────────────────────────────────────────
 * Browsing needs no account. But Order Again needs to know who is asking, so a
 * token is read when one is offered and ignored when it is not — an anonymous
 * customer gets the same feed minus that one section, never an error.
 */
export const GET = withPublic(async ({ req }) => {
  const url = new URL(req.url);
  const at = coordsFrom(url);
  const db = getAdminDb();

  const restaurants = await createFirestoreStore(db).getMarketplaceRestaurants();
  const orderAgainSlugs = await recentRestaurantSlugs(req);

  return buildHomeFeed({ restaurants, at, orderAgainSlugs });
});

/**
 * The restaurants this customer has actually ordered from, most recent first.
 *
 * Genuine history only. An unauthenticated caller, an expired token or a
 * customer with no orders all produce an empty list, and the section disappears
 * rather than being filled with something plausible.
 */
async function recentRestaurantSlugs(req: Request): Promise<string[]> {
  try {
    const auth = await authenticateCustomer(req);
    if (!auth.ok) return [];

    const snap = await getAdminDb()
      .collection("orders")
      .where("orderSource", "==", "marketplace")
      .where("customerId", "==", auth.customer.id)
      // createdAtMs, matching the existing composite index the orders list uses.
      .orderBy("createdAtMs", "desc")
      .limit(30)
      .get();

    const seen: string[] = [];
    for (const d of snap.docs) {
      const slug = String((d.data() ?? {}).restaurantId ?? "");
      if (slug && !seen.includes(slug)) seen.push(slug);
    }
    return seen;
  } catch {
    // Order Again is a convenience. It never fails the page.
    return [];
  }
}
