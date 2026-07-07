// Geocoding provider adapter (Sprint 2.4).
//
// A tiny port so the geocode job stays provider-agnostic and unit-testable. The
// Google adapter takes an injectable `fetchImpl` so tests exercise the mapping
// without network. No `server-only`, no firebase — the API key is passed in by
// the caller (script/route reads it from env), never hard-coded.

import type { GeoConfidence, RawGeocode } from "./geo";

export interface GeocodeProvider {
  /** Resolve a free-text address to coordinates + precision, or null when unresolvable. */
  geocode(address: string): Promise<RawGeocode>;
}

type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

const GOOGLE_ENDPOINT = "https://maps.googleapis.com/maps/api/geocode/json";
const VALID_LOCATION_TYPES = new Set<GeoConfidence>([
  "ROOFTOP",
  "RANGE_INTERPOLATED",
  "GEOMETRIC_CENTER",
  "APPROXIMATE",
]);

function toConfidence(locationType: unknown): GeoConfidence {
  return typeof locationType === "string" && VALID_LOCATION_TYPES.has(locationType as GeoConfidence)
    ? (locationType as GeoConfidence)
    : "APPROXIMATE"; // unknown → lowest trust (classifyGeocode will reject it)
}

/**
 * Google Geocoding API adapter. `region: "ng"` biases results toward Nigeria.
 * Returns the raw shape; trust classification happens in geo.ts::classifyGeocode.
 */
export function createGoogleGeocoder(apiKey: string, fetchImpl: FetchLike = fetch as unknown as FetchLike): GeocodeProvider {
  return {
    async geocode(address: string): Promise<RawGeocode> {
      const q = (address ?? "").trim();
      if (!q) return null;
      const url = `${GOOGLE_ENDPOINT}?address=${encodeURIComponent(q)}&region=ng&key=${encodeURIComponent(apiKey)}`;
      const res = await fetchImpl(url);
      if (!res.ok) throw new Error(`geocoder HTTP ${res.status}`);
      const body = (await res.json()) as {
        status?: string;
        results?: Array<{
          geometry?: { location?: { lat?: number; lng?: number }; location_type?: string };
          formatted_address?: string;
          partial_match?: boolean;
        }>;
      };

      if (body.status === "ZERO_RESULTS") return null;
      if (body.status !== "OK") throw new Error(`geocoder status ${body.status ?? "UNKNOWN"}`);
      const top = body.results?.[0];
      const loc = top?.geometry?.location;
      if (!top || typeof loc?.lat !== "number" || typeof loc?.lng !== "number") return null;

      return {
        lat: loc.lat,
        lng: loc.lng,
        formattedAddress: top.formatted_address ?? q,
        confidence: toConfidence(top.geometry?.location_type),
        partialMatch: top.partial_match === true,
      };
    },
  };
}
