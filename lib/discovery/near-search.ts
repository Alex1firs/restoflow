// Pure /near and /search orchestration over projected discovery restaurants
// (Sprint 2.4). No I/O — the caller supplies the visible discovery docs (the
// Firestore adapter reads them via Admin SDK; discovery collections stay
// deny-all to clients). Ranking (2.5) is intentionally NOT done here: /search
// preserves its incoming order and only annotates distance; /near sorts purely
// by distance as a readiness surface.

import { haversineKm, isApproximateLocation, isUsableForDistance, type LatLng } from "./geo";
import type { DiscoveryRestaurant } from "./types";

export type NearResult = {
  slug: string;
  name: string;
  distanceKm: number;
  approximate: boolean; // geocoded-but-not-owner-confirmed → show "approx"
  restaurant: DiscoveryRestaurant;
};

export type NearResponse = {
  origin: LatLng;
  radiusKm: number;
  results: NearResult[];
  /** Honest exclusion accounting (PO guardrail: /near must document exclusions). */
  excludedNoUsableLocation: number;
  totalConsidered: number;
};

const DEFAULT_RADIUS_KM = 10;
const DEFAULT_LIMIT = 50;

/**
 * /near — includes ONLY restaurants with a usable location (confirmed OR
 * high-confidence geocoded), within radius, sorted nearest-first. Every
 * restaurant without a usable location is excluded and counted, never hidden
 * silently. Geocoded-not-confirmed results carry `approximate: true`.
 */
export function selectNearby(
  restaurants: DiscoveryRestaurant[],
  origin: LatLng,
  opts: { radiusKm?: number; limit?: number } = {},
): NearResponse {
  const radiusKm = opts.radiusKm ?? DEFAULT_RADIUS_KM;
  const limit = opts.limit ?? DEFAULT_LIMIT;

  let excluded = 0;
  const scored: NearResult[] = [];
  for (const r of restaurants) {
    const loc = r.location;
    if (!loc || !isUsableForDistance(r.geoStatus)) {
      excluded++;
      continue;
    }
    const distanceKm = haversineKm(origin, { lat: loc.lat, lng: loc.lng });
    if (distanceKm > radiusKm) continue; // out of radius ≠ "no location"; not counted as excluded
    scored.push({ slug: r.slug, name: r.name, distanceKm, approximate: isApproximateLocation(r.geoStatus), restaurant: r });
  }

  scored.sort((a, b) => a.distanceKm - b.distanceKm);

  return {
    origin,
    radiusKm,
    results: scored.slice(0, limit),
    excludedNoUsableLocation: excluded,
    totalConsidered: restaurants.length,
  };
}

export type SearchResult = {
  slug: string;
  name: string;
  /** Present only when the caller passed an origin AND the pin is usable; else null. */
  distanceKm: number | null;
  approximate: boolean;
  restaurant: DiscoveryRestaurant;
};

/**
 * /search — coordinate-independent. EVERY visible restaurant is included whether
 * or not it has coordinates (PO guardrail). Incoming order is preserved (real
 * relevance ranking is Phase 2.5). Distance is attached only as secondary info
 * when an origin is supplied and the pin is usable; it never filters or reorders.
 */
export function searchDiscovery(
  restaurants: DiscoveryRestaurant[],
  origin?: LatLng | null,
): SearchResult[] {
  return restaurants.map((r) => {
    const loc = r.location;
    const usable = !!loc && isUsableForDistance(r.geoStatus);
    const distanceKm = origin && usable && loc ? haversineKm(origin, { lat: loc.lat, lng: loc.lng }) : null;
    return {
      slug: r.slug,
      name: r.name,
      distanceKm,
      approximate: usable ? isApproximateLocation(r.geoStatus) : false,
      restaurant: r,
    };
  });
}
