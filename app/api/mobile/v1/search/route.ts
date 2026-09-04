import { getAdminDb } from "@/lib/firebase-admin";
import { withPublic, coordsFrom } from "@/lib/marketplace/mobile-api";
import { searchMarketplace } from "@/lib/marketplace/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Search restaurants AND dishes.
 *
 * Restaurants stay the primary result — that is what a customer picks — with
 * matching dish names attached as supporting metadata so a "jollof" search can
 * show *why* a restaurant appeared.
 */
export const GET = withPublic(async ({ req }) => {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (!q) return { restaurants: [], dishes: [] };
  return searchMarketplace(getAdminDb(), { q, at: coordsFrom(url), nowMs: Date.now() });
});
