import { getAdminDb } from "@/lib/firebase-admin";
import { withPublic, coordsFrom } from "@/lib/marketplace/mobile-api";
import { listMarketplaceRestaurants } from "@/lib/marketplace/discovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Search across listed restaurants and cuisines.
 *
 * Matching happens in memory over the (small, listed-only) set rather than in
 * Firestore: Firestore has no substring index, and a prefix-only search would
 * miss "jollof" in "Party Jollof". At marketplace scale this is a scan of tens
 * of documents; when it stops being, it moves to the discovery index.
 */
export const GET = withPublic(async ({ req }) => {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  if (!q) return { restaurants: [], dishes: [] };

  const all = await listMarketplaceRestaurants(getAdminDb(), { at: coordsFrom(url), nowMs: Date.now() });

  const restaurants = all.filter(
    (r) => r.name.toLowerCase().includes(q) || r.cuisines.some((c) => c.toLowerCase().includes(q))
  );

  return { restaurants, dishes: [] };
});
