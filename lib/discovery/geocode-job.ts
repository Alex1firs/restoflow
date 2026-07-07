// Geocode reconciliation job — pure orchestration over the DiscoveryStore port
// and a GeocodeProvider (Sprint 2.4).
//
// Reads restaurants (read-only), geocodes those that need it (missing / failed /
// address changed since last query), classifies the result, and produces
// additive geo updates for the `restaurants` doc. Writes go ONLY through
// store.applyRestaurantGeo — which the script turns into a logged no-op under
// --dry-run. Owner-confirmed pins are never overwritten (unless their address
// changed). Nothing here touches orders / payments / POS / auth / storefront.

import { classifyGeocode, encodeGeohash, needsGeocode, type GeoConfidence, type GeoReason, type GeoStatus } from "./geo";
import type { GeocodeProvider } from "./geocode-provider";
import type { DiscoveryStore } from "./store";

/** Read-only geo view of a restaurant the job reasons about. */
export type GeoCandidate = {
  slug: string;
  address: string | null;
  geoStatus: GeoStatus | null;
  geoQuery: string | null;
};

/** Additive geo fields merged onto a `restaurants` doc. Never includes non-geo fields. */
export type GeoUpdate = {
  slug: string;
  latitude: number | null;
  longitude: number | null;
  geohash: string | null;
  formattedAddress: string | null;
  geoStatus: GeoStatus;
  geoConfidence: GeoConfidence;
  geoQuery: string;
  geocodedAtMs: number;
};

/** Per-restaurant diagnostic line (not persisted) — explains each outcome. */
export type GeoReportItem = { slug: string; status: GeoStatus; confidence: GeoConfidence; reason: GeoReason };

export type GeocodeSummary = {
  scanned: number;
  needing: number;
  geocoded: number; // resolved to a trusted ROOFTOP pin
  failed: number;   // unresolvable / low-confidence / partial
  skipped: number;  // already resolved for the current address (incl. confirmed)
  updates: GeoUpdate[];
  report: GeoReportItem[];
};

export async function geocodeRestaurants(
  store: DiscoveryStore,
  provider: GeocodeProvider,
  nowMs: number,
  opts: { limit?: number } = {},
): Promise<GeocodeSummary> {
  const candidates = await store.getRestaurantsForGeocode();
  const pending = candidates.filter((c) => needsGeocode(c));
  const work = typeof opts.limit === "number" ? pending.slice(0, opts.limit) : pending;

  const updates: GeoUpdate[] = [];
  const report: GeoReportItem[] = [];
  let geocoded = 0;
  let failed = 0;

  for (const c of work) {
    const query = (c.address ?? "").trim();
    let update: GeoUpdate;
    try {
      const raw = await provider.geocode(query);
      const { status, confidence, reason } = classifyGeocode(raw);
      if (status === "geocoded" && raw) {
        update = {
          slug: c.slug,
          latitude: raw.lat,
          longitude: raw.lng,
          geohash: encodeGeohash(raw.lat, raw.lng),
          formattedAddress: raw.formattedAddress || query,
          geoStatus: "geocoded",
          geoConfidence: confidence,
          geoQuery: query,
          geocodedAtMs: nowMs,
        };
        geocoded++;
      } else {
        update = failedUpdate(c.slug, query, confidence, nowMs);
        failed++;
      }
      report.push({ slug: c.slug, status: update.geoStatus, confidence, reason });
    } catch {
      // A provider error for one address must not abort the batch.
      update = failedUpdate(c.slug, query, "NONE", nowMs);
      failed++;
      report.push({ slug: c.slug, status: "failed", confidence: "NONE", reason: "no_result" });
    }
    updates.push(update);
  }

  await store.applyRestaurantGeo(updates);

  return {
    scanned: candidates.length,
    needing: pending.length,
    geocoded,
    failed,
    skipped: candidates.length - pending.length,
    updates,
    report,
  };
}

function failedUpdate(slug: string, query: string, confidence: GeoConfidence, nowMs: number): GeoUpdate {
  return {
    slug,
    latitude: null,
    longitude: null,
    geohash: null,
    formattedAddress: null,
    geoStatus: "failed",
    geoConfidence: confidence,
    geoQuery: query,
    geocodedAtMs: nowMs,
  };
}
