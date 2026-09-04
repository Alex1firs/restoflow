/**
 * Distance, for discovery only.
 *
 * Deliberately separate from Dispatcher's quote: this answers "how far is that
 * restaurant?" for a card, and is never the basis for a delivery fee. The
 * authoritative distance, ETA and price all come from Dispatcher.
 *
 * Pure — no firebase, no provider, no key. Which is also why staging needs no
 * paid Maps API to exercise discovery.
 */

const EARTH_RADIUS_KM = 6371;

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Straight-line under-reports real roads; the multiplier is configurable. */
export const DEFAULT_ROAD_FACTOR = 1.3;

export function roadDistanceKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
  factor = DEFAULT_ROAD_FACTOR
): number {
  return haversineKm(a, b) * factor;
}

/**
 * Coordinates, validated.
 *
 * Null-island is an unset default far more often than it is a place, so it is
 * rejected rather than quoted for.
 */
export function isValidLatLng(v: unknown): v is { lat: number; lng: number } {
  if (!v || typeof v !== "object") return false;
  const p = v as { lat: unknown; lng: unknown };
  if (typeof p.lat !== "number" || typeof p.lng !== "number") return false;
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return false;
  if (Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180) return false;
  return !(p.lat === 0 && p.lng === 0);
}
