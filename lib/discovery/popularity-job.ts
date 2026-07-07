// Popularity recompute job — pure orchestration over the DiscoveryStore port.
//
// Reads recent orders (read-only), computes dish + restaurant popularity, and
// writes ONLY the popularity fields back onto existing discovery docs. Every
// discovery doc is updated (scored ones get their value; the rest are reset to
// the neutral baseline) so demand that leaves the 30-day window decays away.
// Intended to run nightly (Vercel Cron / scheduler) — never per-order.

import {
  buildDishUpdates,
  buildRestaurantUpdates,
  computePopularity,
  POPULARITY_WINDOW_DAYS,
} from "./popularity";
import type { DiscoveryStore } from "./store";

const DAY_MS = 86_400_000;

export type PopularitySummary = {
  orders: number;
  scoredDishes: number;
  scoredRestaurants: number;
  dishDocs: number;
  restaurantDocs: number;
  computedAtMs: number;
};

export async function recomputePopularity(store: DiscoveryStore, nowMs: number): Promise<PopularitySummary> {
  const sinceMs = nowMs - POPULARITY_WINDOW_DAYS * DAY_MS;
  const orders = await store.getRecentOrders(sinceMs);
  const result = computePopularity(orders, nowMs);

  const [dishIds, slugs] = await Promise.all([
    store.listDiscoveryDishIds(),
    store.listDiscoveryRestaurantSlugs(),
  ]);

  await store.applyDishPopularity(buildDishUpdates(result, dishIds));
  await store.applyRestaurantPopularity(buildRestaurantUpdates(result, slugs));

  return {
    orders: orders.length,
    scoredDishes: result.dish.size,
    scoredRestaurants: result.restaurant.size,
    dishDocs: dishIds.length,
    restaurantDocs: slugs.length,
    computedAtMs: nowMs,
  };
}
