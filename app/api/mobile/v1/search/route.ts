import { getAdminDb } from "@/lib/firebase-admin";
import { withPublic, coordsFrom } from "@/lib/marketplace/mobile-api";
import { createFirestoreStore } from "@/lib/discovery/firestore-store";
import { searchMarketplaceRestaurants } from "@/lib/marketplace/discovery-search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Search restaurants, ranked by the discovery engine.
 *
 * Restaurants stay the primary result — that is what a customer picks — with
 * matching dish names attached as supporting metadata so a "jollof" search can
 * show *why* a restaurant appeared.
 *
 * The hand-rolled scan-and-sort this replaced was the second ranking system in
 * the codebase. One engine now answers both browse and search, so a change to
 * how relevance works cannot apply to only half the app.
 */
export const GET = withPublic(async ({ req }) => {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (!q) return { restaurants: [], dishes: [], noCoverage: false };

  const store = createFirestoreStore(getAdminDb());
  const [restaurants, dishes] = await Promise.all([
    store.getMarketplaceRestaurants(),
    store.getMarketplaceDishes(),
  ]);

  return searchMarketplaceRestaurants({
    q, at: coordsFrom(url), nowMs: Date.now(), restaurants, dishes,
  });
});
