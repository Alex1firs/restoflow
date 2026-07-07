// Pure projection: source restaurant/menu-item → discovery documents.
//
// No I/O, no firebase — unit-testable in isolation. The projected objects are
// built field-by-field from a FIXED ALLOWLIST (never by spreading source data),
// which is the structural guarantee that no PII/secret (owner phone/email,
// paystackSubaccountCode, billing, staff, order data) can leak into the public
// discovery index.

import { normalizeCategoryKey } from "../menu-utils";
import { deriveTaxonomyTags, TAXONOMY_VERSION } from "./taxonomy";
import { encodeGeohash, isUsableForDistance, isValidCoord, type GeoStatus } from "./geo";
import {
  NEUTRAL_POPULARITY,
  SCHEMA_VERSION,
  type DiscoveryDish,
  type DiscoveryLocation,
  type DiscoveryRestaurant,
  type RestaurantSnapshot,
  type SourceMenuItem,
  type SourceRestaurant,
} from "./types";

// Grace window after a subscription lapses, mirrored from the storefront gate
// (app/r/[slug]/page.tsx → GRACE_DAYS). Kept as a local constant so this pure
// module has no server imports.
const GRACE_DAYS = 3;
const DAY_MS = 86_400_000;

/** Whether a restaurant should be publicly discoverable right now. */
export function computeVisibility(r: SourceRestaurant, nowMs: number): boolean {
  if (r.status !== "live") return false; // draft / pending / rejected / suspended → hidden
  return !isExpired(r, nowMs);
}

function isExpired(r: SourceRestaurant, nowMs: number): boolean {
  if (typeof r.subscriptionEndDateMs === "number") {
    return r.subscriptionEndDateMs + GRACE_DAYS * DAY_MS < nowMs;
  }
  return r.subscriptionStatus === "expired";
}

function str(x: unknown): string {
  return typeof x === "string" ? x : "";
}

function enabledPayments(r: SourceRestaurant): string[] {
  const cashOffered =
    !!r.pickupEnabled ||
    !!r.dineInEnabled ||
    (!!r.deliveryEnabled && r.payOnDeliveryEnabled !== false);
  if (r.hidePrices) return cashOffered ? ["Cash"] : []; // catalog mode → pay in person only
  const out: string[] = [];
  if (r.onlinePaymentEnabled) out.push("Pay online");
  if (cashOffered) out.push("Cash");
  if (r.whatsappCheckoutEnabled) out.push("WhatsApp order");
  return out;
}

// Flat fee when knowable; otherwise dynamic (per-zone or unset → resolved at checkout).
function deliveryFeeShape(r: SourceRestaurant): { deliveryFee: number | null; feeDynamic: boolean } {
  if (!r.deliveryEnabled) return { deliveryFee: null, feeDynamic: false };
  const zones = Array.isArray(r.deliveryZones) ? r.deliveryZones : [];
  if (zones.length > 0) return { deliveryFee: null, feeDynamic: true };
  if (typeof r.deliveryFee === "number" && r.deliveryFee > 0) return { deliveryFee: r.deliveryFee, feeDynamic: false };
  return { deliveryFee: null, feeDynamic: true }; // 0 / unset → never claim "free"
}

function geoStatusOf(r: SourceRestaurant): GeoStatus {
  const s = r.geoStatus;
  return s === "geocoded" || s === "confirmed" || s === "failed" ? s : "none";
}

/**
 * A location is projected into discovery ONLY when the trust state is usable
 * (confirmed or high-confidence geocoded) AND the coordinates are valid. A pin
 * that is missing, "failed", or low-confidence yields `null` — so distance
 * surfaces never see an untrusted coordinate. Geohash is (re)derived here to
 * guarantee it agrees with the stored lat/lng.
 */
function locationOf(r: SourceRestaurant): DiscoveryLocation {
  if (!isUsableForDistance(geoStatusOf(r))) return null;
  if (!isValidCoord(r.latitude, r.longitude)) return null;
  const lat = r.latitude as number;
  const lng = r.longitude as number;
  return {
    lat,
    lng,
    geohash: str(r.geohash) || encodeGeohash(lat, lng),
    formattedAddress: str(r.formattedAddress) || str(r.address),
  };
}

function serviceAreasOf(r: SourceRestaurant): string[] {
  const fromZones = (Array.isArray(r.deliveryZones) ? r.deliveryZones : [])
    .map((z) => (z && typeof z.name === "string" ? z.name.trim() : ""))
    .filter((n) => n.length > 0);
  const fromSeo = (Array.isArray(r.serviceAreas) ? r.serviceAreas : [])
    .map((a) => (typeof a === "string" ? a.trim() : ""))
    .filter((a) => a.length > 0);
  return [...new Set([...fromZones, ...fromSeo])];
}

/** Project the denormalized restaurant snapshot embedded on every dish. */
export function restaurantSnapshotOf(r: SourceRestaurant): RestaurantSnapshot {
  const fee = deliveryFeeShape(r);
  const loc = str(r.address);
  return {
    slug: r.slug,
    name: str(r.name),
    description: str(r.description),
    logo: str(r.logo),
    coverImage: str(r.coverImage),
    fulfillment: {
      delivery: !!r.deliveryEnabled,
      pickup: !!r.pickupEnabled,
      dineIn: !!r.dineInEnabled,
    },
    deliveryFee: fee.deliveryFee,
    feeDynamic: fee.feeDynamic,
    payments: enabledPayments(r),
    pickupAddress: r.pickupEnabled && loc ? loc : null,
    location: locationOf(r),
    geoStatus: geoStatusOf(r),
  };
}

/**
 * Full discovery_restaurants document. `taxonomyTags` is the union of its dishes'
 * tags — supplied by the indexer, which has projected the dishes (defaults to []).
 */
export function projectRestaurant(r: SourceRestaurant, nowMs: number, taxonomyTags: string[] = []): DiscoveryRestaurant {
  const snap = restaurantSnapshotOf(r);
  return {
    ...snap,
    serviceAreas: serviceAreasOf(r),
    openingHours: r.openingHours ?? null,
    geoConfirmedAt: geoStatusOf(r) === "confirmed" && typeof r.geoConfirmedAtMs === "number" ? r.geoConfirmedAtMs : null,
    promo: r.promo ?? null,
    taxonomyTags,
    taxonomyVersion: TAXONOMY_VERSION,
    popularityScore: NEUTRAL_POPULARITY,
    popularityRaw: 0,
    popularityOrders: 0,
    visible: computeVisibility(r, nowMs),
    updatedAt: nowMs,
    signalsComputedAt: null,
    schemaVersion: SCHEMA_VERSION,
  };
}

/** Full discovery_dishes document. `restaurantVisible` mirrors restaurant visibility. */
export function projectDish(
  item: SourceMenuItem,
  snapshot: RestaurantSnapshot,
  restaurantVisible: boolean,
  nowMs: number,
  priceHidden: boolean,
  promo: DiscoveryRestaurant["promo"],
): DiscoveryDish {
  const rawCategory = str(item.category);
  return {
    dishId: item.id,
    restaurantSlug: snapshot.slug,
    name: str(item.name),
    description: str(item.description),
    price: priceHidden ? null : typeof item.price === "number" ? item.price : null,
    priceHidden,
    image: str(item.image) || snapshot.coverImage || snapshot.logo || null,
    available: item.available !== false,
    rawCategory,
    categoryKey: normalizeCategoryKey(rawCategory),
    taxonomyTags: deriveTaxonomyTags(rawCategory, str(item.name)),
    taxonomyVersion: TAXONOMY_VERSION,
    popularityScore: NEUTRAL_POPULARITY,
    popularityRaw: 0,
    popularityOrders: 0,
    promo: promo ?? null,
    restaurantSnapshot: snapshot,
    visible: restaurantVisible,
    updatedAt: nowMs,
    signalsComputedAt: null,
    schemaVersion: SCHEMA_VERSION,
  };
}
