// Popularity signal (Sprint 2.3) — pure, order-derived, no firebase.
//
// Authentic signals ONLY: computed from real `orders` (paid + non-rejected),
// quantity-weighted, recency-decayed. Never uses owner-typed vanity fields
// (rating / ordersToday / deliveryTime). Read-only over orders — nothing is
// written back to the transactional core; only discovery docs' popularityScore /
// popularityRaw / popularityOrders / signalsComputedAt are updated by the job.
//
// Rulings (2.3): 30-day window · 14-day half-life · quantity-weighted lines ·
// within-restaurant + cross-restaurant blend for dishes · confidence-weighted
// blend toward the neutral 0.5 baseline (no hard min-order threshold).

import { NEUTRAL_POPULARITY } from "./types";

export const POPULARITY_WINDOW_DAYS = 30;
export const POPULARITY_HALF_LIFE_DAYS = 14;
const W_WITHIN = 0.6; // weight of "popular for this restaurant"
const W_CROSS = 0.4;  // weight of "popular across the marketplace"
const CONFIDENCE_FULL_ORDERS = 5; // qualifying orders for full confidence
const DAY_MS = 86_400_000;

export type OrderLine = { dishId: string; quantity: number };
export type PopularityOrder = {
  restaurantSlug: string;
  createdAtMs: number;
  paymentStatus?: string;
  status?: string;
  lines: OrderLine[];
};

export type Scored = { score: number; raw: number; orders: number };
export type PopularityResult = {
  dish: Map<string, Scored>;
  restaurant: Map<string, Scored>;
  computedAtMs: number;
};

function qualifies(o: PopularityOrder, nowMs: number): boolean {
  if (o.paymentStatus !== "paid") return false; // money-truth: only paid orders count
  if (o.status === "rejected") return false;
  const ageDays = (nowMs - o.createdAtMs) / DAY_MS;
  return ageDays <= POPULARITY_WINDOW_DAYS; // within the rolling window (future skew = fresh)
}

function decay(ageDays: number): number {
  return Math.pow(0.5, Math.max(0, ageDays) / POPULARITY_HALF_LIFE_DAYS);
}

function safeDiv(a: number, b: number): number {
  return b > 0 ? a / b : 0;
}

// Pull a low-evidence score toward neutral so a dish with 2 orders isn't ranked
// like one with 200 (cold-start decision #5 — blend, not a hard threshold).
function confidenceBlend(rawScore: number, orderCount: number): number {
  const confidence = Math.min(1, orderCount / CONFIDENCE_FULL_ORDERS);
  return confidence * rawScore + (1 - confidence) * NEUTRAL_POPULARITY;
}

/** Compute dish + restaurant popularity from qualifying orders. */
export function computePopularity(orders: PopularityOrder[], nowMs: number): PopularityResult {
  const dishRaw = new Map<string, number>();
  const dishOrders = new Map<string, number>();
  const dishRestaurant = new Map<string, string>();
  const restRaw = new Map<string, number>();
  const restOrders = new Map<string, number>();

  for (const o of orders) {
    if (!qualifies(o, nowMs)) continue;
    const w = decay((nowMs - o.createdAtMs) / DAY_MS);
    const dishesInOrder = new Set<string>();
    let restaurantHadLine = false;

    for (const line of o.lines ?? []) {
      const dishId = line?.dishId;
      const qty = line && Number.isFinite(line.quantity) && line.quantity > 0 ? line.quantity : 0;
      if (!dishId || qty <= 0) continue;
      const weighted = qty * w; // quantity-weighted, recency-decayed
      dishRaw.set(dishId, (dishRaw.get(dishId) ?? 0) + weighted);
      dishRestaurant.set(dishId, o.restaurantSlug);
      dishesInOrder.add(dishId);
      restRaw.set(o.restaurantSlug, (restRaw.get(o.restaurantSlug) ?? 0) + weighted);
      restaurantHadLine = true;
    }
    for (const dishId of dishesInOrder) dishOrders.set(dishId, (dishOrders.get(dishId) ?? 0) + 1);
    if (restaurantHadLine) restOrders.set(o.restaurantSlug, (restOrders.get(o.restaurantSlug) ?? 0) + 1);
  }

  // Within-restaurant max (for the "popular for this restaurant" component).
  const restMaxDishRaw = new Map<string, number>();
  for (const [dishId, raw] of dishRaw) {
    const slug = dishRestaurant.get(dishId)!;
    restMaxDishRaw.set(slug, Math.max(restMaxDishRaw.get(slug) ?? 0, raw));
  }
  const globalMaxDishRaw = Math.max(0, ...dishRaw.values());
  const globalMaxRestRaw = Math.max(0, ...restRaw.values());

  const dish = new Map<string, Scored>();
  for (const [dishId, raw] of dishRaw) {
    const slug = dishRestaurant.get(dishId)!;
    const within = safeDiv(raw, restMaxDishRaw.get(slug) ?? 0);
    const cross = safeDiv(raw, globalMaxDishRaw);
    const blended = W_WITHIN * within + W_CROSS * cross;
    const orders = dishOrders.get(dishId) ?? 0;
    dish.set(dishId, { score: confidenceBlend(blended, orders), raw, orders });
  }

  const restaurant = new Map<string, Scored>();
  for (const [slug, raw] of restRaw) {
    const cross = safeDiv(raw, globalMaxRestRaw);
    const orders = restOrders.get(slug) ?? 0;
    restaurant.set(slug, { score: confidenceBlend(cross, orders), raw, orders });
  }

  return { dish, restaurant, computedAtMs: nowMs };
}

// ── Update builders — every discovery doc gets a value, so demand that leaves the
// window decays back to neutral (a doc absent from the result is reset to 0.5). ──

export type PopularityUpdate = {
  id: string;
  popularityScore: number;
  popularityRaw: number;
  popularityOrders: number;
  signalsComputedAt: number;
};

function buildUpdates(scores: Map<string, Scored>, ids: string[], computedAtMs: number): PopularityUpdate[] {
  return ids.map((id) => {
    const p = scores.get(id);
    return {
      id,
      popularityScore: p ? p.score : NEUTRAL_POPULARITY,
      popularityRaw: p ? p.raw : 0,
      popularityOrders: p ? p.orders : 0,
      signalsComputedAt: computedAtMs,
    };
  });
}

export function buildDishUpdates(result: PopularityResult, allDishIds: string[]): PopularityUpdate[] {
  return buildUpdates(result.dish, allDishIds, result.computedAtMs);
}

export function buildRestaurantUpdates(result: PopularityResult, allSlugs: string[]): PopularityUpdate[] {
  return buildUpdates(result.restaurant, allSlugs, result.computedAtMs);
}
