import type { DiscoveryDish, DiscoveryRestaurant } from "@/lib/discovery/types";
import { rankRestaurantsBrowse } from "@/lib/discovery/ranking";
import { toCard, type LatLng, type MarketplaceCard } from "./deliverability";
import { openStateFor } from "./deliverability";

/**
 * Marketplace search over the discovery index.
 *
 * Pure over its inputs so the ranking and the exclusion rules are testable
 * without Firestore. Two rules matter more than the ordering:
 *
 *   1. Out-of-range restaurants are excluded, not demoted. A result a customer
 *      cannot order from is not a worse result, it is a wrong one.
 *   2. No price is returned. Dish names come back as the reason a restaurant
 *      matched; the money is computed by the pricing layer when the customer
 *      opens the restaurant.
 */
export type MarketplaceSearchResult = {
  restaurants: Array<MarketplaceCard & { matchedDishes: string[] }>;
  dishes: never[];
  /** A delivery address is set and nothing in range matched. */
  noCoverage: boolean;
};

function tokens(q: string): string[] {
  return q.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1);
}

function matches(haystack: string, ts: string[]): boolean {
  const h = haystack.toLowerCase();
  return ts.some((t) => h.includes(t));
}

export function searchMarketplaceRestaurants(args: {
  q: string;
  at: LatLng | null;
  nowMs: number;
  restaurants: DiscoveryRestaurant[];
  dishes: DiscoveryDish[];
}): MarketplaceSearchResult {
  const ts = tokens(args.q);
  if (ts.length === 0) return { restaurants: [], dishes: [], noCoverage: false };

  const dishesBySlug = new Map<string, string[]>();
  for (const d of args.dishes) {
    if (!d.available || !matches(`${d.name} ${d.description} ${d.rawCategory}`, ts)) continue;
    if (!dishesBySlug.has(d.restaurantSlug)) dishesBySlug.set(d.restaurantSlug, []);
    const list = dishesBySlug.get(d.restaurantSlug)!;
    if (list.length < 3) list.push(d.name);
  }

  const hits = args.restaurants.filter(
    (r) =>
      dishesBySlug.has(r.slug) ||
      matches(`${r.name} ${r.cuisines.join(" ")} ${r.marketplaceTaxonomyTags.join(" ")}`, ts)
  );

  const openNowBySlug = Object.fromEntries(
    args.restaurants.map((r) => [r.slug, openStateFor(r) === "open"])
  );

  // Matching has already happened above, and it is strictly richer than what
  // the ranking's own relevance signal can do: the restaurant surface scores
  // against a restaurant's own text and has no way to know that "jollof"
  // matched one of its dishes. Passing the query here would make the engine
  // re-filter on that narrower test and throw those matches away — so ranking
  // is asked to ORDER the matches, not to decide what matched.
  const ranked = rankRestaurantsBrowse(hits, {
    nowMs: args.nowMs,
    origin: args.at,
    openNowBySlug,
    query: null,
    limit: 30,
    cursor: null,
    explain: false,
  });

  const cards = ranked.items
    .map((i) => ({
      ...toCard(i.entity, args.at),
      matchedDishes: dishesBySlug.get(i.entity.slug) ?? [],
    }))
    .filter((c) => c.deliverable === "deliverable");

  return {
    restaurants: cards,
    dishes: [],
    noCoverage: args.at !== null && cards.length === 0 && hits.length > 0,
  };
}
