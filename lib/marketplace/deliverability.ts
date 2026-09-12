import type { DiscoveryRestaurant } from "@/lib/discovery/types";
import { openStateOf, type OpenState, type OpeningHours } from "@/lib/restaurant-utils";
import { haversineKm } from "./geo";

/**
 * Whether a restaurant will actually deliver to where the customer is standing.
 *
 * ── Why this file exists ─────────────────────────────────────────────────────
 * `deliveryRadiusKm` was configured by restaurants and read by nothing. Staging
 * had 5 km and 15 km set on the two marketplace restaurants and the app offered
 * both to everybody, which means the platform has been promising deliveries no
 * restaurant agreed to make. This turns that setting into a rule.
 *
 * ── The three answers ────────────────────────────────────────────────────────
 * "unknown" is the important one. Without a delivery address there is no
 * distance, and a system that treats "I don't know" as "yes" is the reason the
 * bug above existed. Callers must hide distance-ranked sections on "unknown"
 * rather than rank on a guess.
 */
export type Deliverability = "deliverable" | "out_of_range" | "unknown";

/** Travel speed for the ETA estimate. Dispatcher's real quote replaces it at checkout. */
export const CITY_SPEED_KMH = 25;

export type LatLng = { lat: number; lng: number };

export function distanceKmTo(r: DiscoveryRestaurant, at: LatLng | null): number | null {
  if (!at || !r.location) return null;
  return Math.round(haversineKm(at, { lat: r.location.lat, lng: r.location.lng }) * 10) / 10;
}

export function deliverabilityOf(args: {
  radiusKm: number | null;
  distanceKm: number | null;
}): Deliverability {
  if (args.distanceKm == null) return "unknown";
  // No radius configured is not a promise to deliver anywhere. It is a fact we
  // do not have, so the restaurant stays listed and nothing claims otherwise.
  if (args.radiusKm == null) return "deliverable";
  return args.distanceKm <= args.radiusKm ? "deliverable" : "out_of_range";
}

export function etaMinsFor(r: DiscoveryRestaurant, distanceKm: number | null): number | null {
  const prep = r.prepTimeMins;
  if (distanceKm == null) return prep ? prep.max : null;
  const travel = (distanceKm / CITY_SPEED_KMH) * 60;
  return Math.ceil(travel + (prep ? prep.min : 0));
}

export function openStateFor(r: DiscoveryRestaurant): OpenState {
  return openStateOf((r.openingHours ?? null) as OpeningHours | null);
}

/**
 * The customer-facing card.
 *
 * No price of any kind. Prices come from the marketplace pricing layer at
 * request time; a card carries identity, distance and availability only.
 */
export type MarketplaceCard = {
  slug: string;
  name: string;
  cuisines: string[];
  logoUrl: string | null;
  coverUrl: string | null;
  rating: number | null;
  distanceKm: number | null;
  etaMins: number | null;
  deliveryFeeMinor: number | null;
  feeDynamic: boolean;
  isOpen: boolean;
  /** The honest three-state version. `isOpen` stays for older app builds. */
  openState: OpenState;
  opensAt: string | null;
  promoLabel: string | null;
  minOrderMinor: number | null;
  deliverable: Deliverability;
};

export function toCard(r: DiscoveryRestaurant, at: LatLng | null): MarketplaceCard {
  const distanceKm = distanceKmTo(r, at);
  const openState = openStateFor(r);
  return {
    slug: r.slug,
    name: r.name,
    cuisines: r.cuisines,
    logoUrl: r.logo || null,
    coverUrl: r.coverImage || null,
    // Reserved, deliberately unpopulated: there is no genuine ratings source.
    rating: null,
    distanceKm,
    etaMins: etaMinsFor(r, distanceKm),
    deliveryFeeMinor: null,
    feeDynamic: true,
    isOpen: openState === "open",
    openState,
    // Only claim a reopening time when the hours are actually known.
    opensAt: openState === "closed" ? "Closed" : null,
    promoLabel: r.promoLabel,
    minOrderMinor: r.minOrderMinor,
    deliverable: deliverabilityOf({ radiusKm: r.deliveryRadiusKm, distanceKm }),
  };
}
