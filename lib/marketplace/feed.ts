import type { DiscoveryRestaurant } from "@/lib/discovery/types";
import { toCard, type LatLng, type MarketplaceCard } from "./deliverability";

/**
 * The customer home feed, assembled from the discovery index.
 *
 * ── Sections are earned, not filled ──────────────────────────────────────────
 * Every section here either has real data behind it or is absent. Two are
 * deliberately empty and will stay that way until something genuine can power
 * them, because a section invented to look complete is worse than a missing
 * one: it teaches the customer that the ordering means nothing.
 *
 *   Local Favourites — needs long-term local repeat ordering, which is a
 *     different signal from Popular Around You. Duplicating one into the other
 *     would put the same restaurants under two headings and call it discovery.
 *   New on RestoFlow — needs a genuine marketplace publication timestamp. No
 *     restaurant has one, and `createdAt` is not that date.
 *
 * ── Location is required for location claims ─────────────────────────────────
 * Near You, Fast Delivery and Popular Around You all rank on distance. Without
 * a delivery address there is no distance, so they return empty rather than an
 * arbitrary order dressed up as proximity.
 */

export type HomeFeed = {
  orderAgain: MarketplaceCard[];
  featured: MarketplaceCard[];
  nearYou: MarketplaceCard[];
  fastDelivery: MarketplaceCard[];
  popularAroundYou: MarketplaceCard[];
  localFavourites: MarketplaceCard[];
  newOnRestoflow: MarketplaceCard[];
  offers: MarketplaceCard[];
  cuisines: Array<{ key: string; label: string; imageUrl: string | null }>;
  popularDishes: never[];
  /** True when a delivery address is set and nothing will deliver to it. */
  noCoverage: boolean;
  /** False when the customer has not chosen a delivery address yet. */
  hasLocation: boolean;
};

const SECTION_LIMIT = 20;
const CAROUSEL_LIMIT = 8;

/** Genuine popularity only — a cold-start neutral score is not evidence of anything. */
function hasRealPopularity(r: DiscoveryRestaurant): boolean {
  return r.popularityOrders > 0;
}

export function buildHomeFeed(args: {
  restaurants: DiscoveryRestaurant[];
  at: LatLng | null;
  /** Slugs from the customer's own order history, most recent first. */
  orderAgainSlugs?: string[];
}): HomeFeed {
  const hasLocation = args.at !== null;
  const cards = args.restaurants.map((r) => toCard(r, args.at));

  // Out-of-range restaurants are dropped from every section. They are not
  // "results the customer can't have" — offering them is the defect.
  const deliverable = cards.filter((c) => c.deliverable === "deliverable");
  const notClosed = deliverable.filter((c) => c.openState !== "closed");

  const byDistance = [...deliverable].sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
  const byEta = [...notClosed].sort((a, b) => (a.etaMins ?? Infinity) - (b.etaMins ?? Infinity));

  const bySlug = new Map(cards.map((c) => [c.slug, c]));
  const popularityBySlug = new Map(args.restaurants.map((r) => [r.slug, r]));
  const popular = deliverable
    .filter((c) => hasRealPopularity(popularityBySlug.get(c.slug)!))
    .sort((a, b) =>
      popularityBySlug.get(b.slug)!.popularityScore - popularityBySlug.get(a.slug)!.popularityScore);

  const orderAgain = (args.orderAgainSlugs ?? [])
    .map((s) => bySlug.get(s))
    .filter((c): c is MarketplaceCard => !!c && c.deliverable === "deliverable")
    .slice(0, CAROUSEL_LIMIT);

  const cuisines = [...new Set(deliverable.flatMap((c) => c.cuisines))]
    .filter(Boolean)
    .slice(0, 12)
    .map((label) => ({ key: label.toLowerCase().replace(/[^a-z0-9]+/g, "-"), label, imageUrl: null }));

  return {
    orderAgain,
    featured: notClosed.slice(0, CAROUSEL_LIMIT),
    nearYou: hasLocation ? byDistance.slice(0, SECTION_LIMIT) : [],
    fastDelivery: hasLocation ? byEta.slice(0, CAROUSEL_LIMIT) : [],
    popularAroundYou: hasLocation ? popular.slice(0, CAROUSEL_LIMIT) : [],
    localFavourites: [],
    newOnRestoflow: [],
    offers: deliverable.filter((c) => c.promoLabel),
    cuisines,
    popularDishes: [],
    noCoverage: hasLocation && deliverable.length === 0,
    hasLocation,
  };
}
