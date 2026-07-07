// Pure geo helpers for discovery near-me / distance readiness (Sprint 2.4).
//
// No I/O, no firebase — unit-testable in isolation. Everything distance-related
// lives here so the projection, the geocode job, and the /near·/search
// orchestration all share one honest source of truth about what a "usable"
// location is.
//
// Trust model (PO rulings, 2026-07-07):
//   - Only ROOFTOP geocodes are trusted; anything lower-confidence or a partial
//     match is treated as FAILED and never used for distance.
//   - /near includes owner-CONFIRMED pins plus high-confidence GEOCODED pins,
//     but geocoded-not-confirmed is flagged "approximate".

export type GeoStatus = "none" | "geocoded" | "confirmed" | "failed";

// Provider location precision (Google `location_type`), preserved for audit/debug.
export type GeoConfidence = "ROOFTOP" | "RANGE_INTERPOLATED" | "GEOMETRIC_CENTER" | "APPROXIMATE" | "NONE";

export type LatLng = { lat: number; lng: number };

// ── Coordinate validation ─────────────────────────────────────────────────────

/** Finite and within valid WGS84 ranges. */
export function isValidCoord(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  );
}

/** Valid AND not the null-island (0,0), which is almost always an unset default. */
export function isPlausibleCoord(lat: unknown, lng: unknown): boolean {
  return isValidCoord(lat, lng) && !(lat === 0 && lng === 0);
}

// ── Geohash (base32, standard) ────────────────────────────────────────────────

const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";
export const GEOHASH_PRECISION = 9; // ~4.8m cell; ample for storefront proximity

/** Encode a coordinate to a base32 geohash. Throws on invalid input (callers gate first). */
export function encodeGeohash(lat: number, lng: number, precision: number = GEOHASH_PRECISION): string {
  if (!isValidCoord(lat, lng)) throw new Error(`encodeGeohash: invalid coordinate ${lat},${lng}`);
  let idx = 0;
  let bit = 0;
  let evenBit = true;
  let hash = "";
  let latMin = -90;
  let latMax = 90;
  let lngMin = -180;
  let lngMax = 180;

  while (hash.length < precision) {
    if (evenBit) {
      const mid = (lngMin + lngMax) / 2;
      if (lng >= mid) { idx = idx * 2 + 1; lngMin = mid; } else { idx = idx * 2; lngMax = mid; }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) { idx = idx * 2 + 1; latMin = mid; } else { idx = idx * 2; latMax = mid; }
    }
    evenBit = !evenBit;
    if (++bit === 5) {
      hash += BASE32[idx];
      bit = 0;
      idx = 0;
    }
  }
  return hash;
}

/** Shared prefix of two geohashes — a cheap coarse proximity gate (future range-query use). */
export function geohashPrefixLength(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

// ── Distance ──────────────────────────────────────────────────────────────────

const EARTH_RADIUS_KM = 6371;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in km between two coordinates. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

// ── Geocode result classification ─────────────────────────────────────────────

export type RawGeocode = {
  lat: number;
  lng: number;
  formattedAddress: string;
  confidence: GeoConfidence;
  partialMatch: boolean;
} | null;

/** Why a geocode was accepted or rejected — surfaced in dry-run reports for honesty. */
export type GeoReason = "resolved" | "no_result" | "partial_match" | "invalid_coord" | "low_confidence";

/**
 * Map a raw provider result to a trust state. ROOFTOP + coordinate-valid + not a
 * partial match is the ONLY path to "geocoded"; everything else is "failed" so
 * low-confidence / interpolated / partial results never feed distance. `reason`
 * explains the outcome (e.g. a ROOFTOP result rejected because it was a partial
 * match, which would otherwise look self-contradictory in logs).
 */
export function classifyGeocode(result: RawGeocode): { status: GeoStatus; confidence: GeoConfidence; reason: GeoReason } {
  if (!result) return { status: "failed", confidence: "NONE", reason: "no_result" };
  if (result.partialMatch) return { status: "failed", confidence: result.confidence, reason: "partial_match" };
  if (!isPlausibleCoord(result.lat, result.lng)) return { status: "failed", confidence: result.confidence, reason: "invalid_coord" };
  if (result.confidence === "ROOFTOP") return { status: "geocoded", confidence: "ROOFTOP", reason: "resolved" };
  return { status: "failed", confidence: result.confidence, reason: "low_confidence" };
}

// ── Usability for distance surfaces ───────────────────────────────────────────

/** /near may include this location. Confirmed pins + high-confidence geocoded pins. */
export function isUsableForDistance(status: GeoStatus | null | undefined): boolean {
  return status === "confirmed" || status === "geocoded";
}

/** True when a usable location is geocoded-only (not owner-confirmed) → label "approximate". */
export function isApproximateLocation(status: GeoStatus | null | undefined): boolean {
  return status === "geocoded";
}

// ── geoStatus transitions ─────────────────────────────────────────────────────

/** Does this restaurant need (re)geocoding? False only when already resolved for the CURRENT address. */
export function needsGeocode(input: { address?: string | null; geoStatus?: GeoStatus | null; geoQuery?: string | null }): boolean {
  const addr = (input.address ?? "").trim();
  if (!addr) return false; // nothing to geocode
  const sameQuery = (input.geoQuery ?? "").trim() === addr;
  // Confirmed or already-geocoded for THIS exact address → leave alone.
  if ((input.geoStatus === "confirmed" || input.geoStatus === "geocoded") && sameQuery) return false;
  return true; // none / failed, or the address changed (stale) → (re)geocode
}

/**
 * Owner/admin confirmation (super-admin only for launch). Promotes a resolved pin
 * to "confirmed" and stamps the time. Pure — the write path lives in 2.4c.
 */
export function confirmGeo(coord: LatLng, nowMs: number): {
  geoStatus: GeoStatus;
  latitude: number;
  longitude: number;
  geohash: string;
  geoConfirmedAtMs: number;
} {
  return {
    geoStatus: "confirmed",
    latitude: coord.lat,
    longitude: coord.lng,
    geohash: encodeGeohash(coord.lat, coord.lng),
    geoConfirmedAtMs: nowMs,
  };
}

/**
 * Ruling #4 — when the free-text address changes and no longer matches the query
 * that produced the current pin, downgrade trust until reconfirmed/regeocoded.
 * Pure; the live edit-flow wiring is deferred to 2.4c. Coordinates are left in
 * place for reference but the status ("none") makes them untrusted for distance.
 */
export function reconcileOnAddressChange(
  prev: { geoStatus?: GeoStatus | null; geoQuery?: string | null },
  newAddress: string,
): { changed: boolean; geoStatus: GeoStatus; geoConfirmedAtMs: number | null } {
  const addr = (newAddress ?? "").trim();
  const sameQuery = (prev.geoQuery ?? "").trim() === addr;
  const trusted = prev.geoStatus === "confirmed" || prev.geoStatus === "geocoded";
  if (trusted && !sameQuery) {
    return { changed: true, geoStatus: "none", geoConfirmedAtMs: null };
  }
  return { changed: false, geoStatus: (prev.geoStatus ?? "none") as GeoStatus, geoConfirmedAtMs: null };
}
