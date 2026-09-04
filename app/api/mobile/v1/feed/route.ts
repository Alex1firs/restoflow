import { getAdminDb } from "@/lib/firebase-admin";
import { withPublic, coordsFrom } from "@/lib/marketplace/mobile-api";
import { listMarketplaceRestaurants } from "@/lib/marketplace/discovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The home feed — one call, six sections.
 *
 * Public: browsing needs no account, and requiring one before a customer can
 * see what is on offer measurably costs first-session conversion. Nothing here
 * is customer-specific, so there is nothing to leak.
 */
export const GET = withPublic(async ({ req }) => {
  const url = new URL(req.url);
  const at = coordsFrom(url);
  const nowMs = Date.now();

  const all = await listMarketplaceRestaurants(getAdminDb(), { at, nowMs });

  const byDistance = [...all].sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9));
  const byEta = [...all].sort((a, b) => (a.etaMins ?? 1e9) - (b.etaMins ?? 1e9));

  const cuisines = [...new Set(all.flatMap((r) => r.cuisines))]
    .filter(Boolean)
    .slice(0, 12)
    .map((label) => ({ key: label.toLowerCase().replace(/[^a-z0-9]+/g, "-"), label, imageUrl: null }));

  return {
    // Open restaurants first: a "featured" row of closed kitchens is not a
    // feature.
    featured: all.filter((r) => r.isOpen).slice(0, 8),
    nearYou: byDistance.slice(0, 20),
    fastDelivery: byEta.filter((r) => r.isOpen).slice(0, 8),
    offers: all.filter((r) => r.promoLabel),
    cuisines,
    // Populated once the discovery index carries marketplace prices; an empty
    // array renders as a hidden section rather than an error.
    popularDishes: [],
  };
});
