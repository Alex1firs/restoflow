// Pure, framework-free helpers for the /discover page — unit-testable with tsx.
// No React, no fetch, no DOM: URL building, formatting, and client-side filters.

import type { DishCardData, Origin, RestaurantCardData } from "./types";

/** Build a query string from defined params only (skips null/undefined/empty). */
export function buildQuery(params: Record<string, string | number | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (s === "") continue;
    sp.set(k, s);
  }
  const q = sp.toString();
  return q ? `?${q}` : "";
}

/**
 * Resolve which discovery endpoint + params drive the dish list for the current
 * UI state. Query beats category; category beats the default trending view.
 */
export function dishRequest(state: { query: string; tag: string | null; origin: Origin | null; limit?: number }): string {
  const { query, tag, origin, limit = 24 } = state;
  const geo = origin ? { lat: origin.lat, lng: origin.lng } : {};
  const q = (query ?? "").trim();
  if (q) return `/api/discovery/search${buildQuery({ q, limit, ...geo })}`;
  if (tag) return `/api/discovery/collections${buildQuery({ tag, limit, ...geo })}`;
  return `/api/discovery/search${buildQuery({ limit, ...geo })}`; // trending (popularity-led)
}

/** Restaurant list endpoint: near-me when we have a location, else browse. */
export function restaurantRequest(state: { query: string; tag: string | null; origin: Origin | null; radiusKm?: number; limit?: number }): string {
  const { query, tag, origin, radiusKm = 15, limit = 12 } = state;
  if (origin) return `/api/discovery/near${buildQuery({ lat: origin.lat, lng: origin.lng, radiusKm, limit })}`;
  const q = (query ?? "").trim();
  return `/api/discovery/restaurants${buildQuery({ q: q || undefined, tag: tag || undefined, limit })}`;
}

/** Naira price, or a graceful placeholder when the price is hidden/unset. */
export function formatPrice(price: number | null, priceHidden: boolean): string {
  if (priceHidden || price === null || price === undefined) return "See menu";
  return `₦${Math.round(price).toLocaleString("en-NG")}`;
}

/** Short distance label, e.g. "300 m" / "2.4 km", with an approx marker. */
export function formatDistance(distanceKm: number | null, approximate: boolean): string | null {
  if (distanceKm === null || distanceKm === undefined || !Number.isFinite(distanceKm)) return null;
  const label = distanceKm < 1 ? `${Math.round(distanceKm * 1000)} m` : `${distanceKm.toFixed(1)} km`;
  return approximate ? `~${label}` : label;
}

/** Delivery summary honoring the honest fee model (never invent "free"). */
export function fulfillmentLabel(r: { fulfillment: { delivery: boolean; pickup: boolean; dineIn: boolean }; deliveryFee: number | null; feeDynamic: boolean }): string {
  const parts: string[] = [];
  if (r.fulfillment.delivery) {
    if (typeof r.deliveryFee === "number" && r.deliveryFee > 0) parts.push(`Delivery ₦${r.deliveryFee.toLocaleString("en-NG")}`);
    else if (r.feeDynamic) parts.push("Delivery");
    else parts.push("Delivery");
  }
  if (r.fulfillment.pickup) parts.push("Pickup");
  if (r.fulfillment.dineIn) parts.push("Dine-in");
  return parts.join(" · ") || "See restaurant";
}

/** Open / preorder / closed presentation state for a restaurant/dish card. */
export function statusLabel(openNow: boolean): { text: string; open: boolean } {
  return openNow ? { text: "Open now", open: true } : { text: "Closed · preorder", open: false };
}

/** Client-side "Open now" filter (the API returns openNow but does not gate on it). */
export function filterOpenNowDishes(dishes: DishCardData[], openOnly: boolean): DishCardData[] {
  return openOnly ? dishes.filter((d) => d.restaurant.openNow) : dishes;
}
export function filterOpenNowRestaurants(restaurants: RestaurantCardData[], openOnly: boolean): RestaurantCardData[] {
  return openOnly ? restaurants.filter((r) => r.openNow) : restaurants;
}

/** Deep-link a dish into the existing storefront menu section (anchor already exists). */
export function dishHref(d: { restaurant: { slug: string } }): string {
  return `/r/${d.restaurant.slug}#menu`;
}
export function restaurantHref(slug: string): string {
  return `/r/${slug}`;
}
