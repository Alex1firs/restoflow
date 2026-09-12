// Food Discovery Engine — data model (Sprint 2.1).
//
// Two server-only collections projected (read-only) from the transactional core:
//   discovery_dishes/{dishId}        (dishId = menu_items doc id)   — food-first index
//   discovery_restaurants/{slug}     (slug   = restaurants doc id)  — restaurant snapshot
//
// Nothing here is written back to menu_items / restaurants / orders. Taxonomy
// (2.2), popularity (2.3), and geo/distance (2.4) are intentionally NOT computed
// yet — their fields exist with safe placeholders so the schema is stable:
//   - taxonomyTags: []            (filled in 2.2)
//   - popularityScore: NEUTRAL    (cold-start baseline; real value computed in 2.3)
//   - location: null              (geo backfilled in 2.4)

import type { GeoStatus, GeoConfidence } from "./geo";

export const SCHEMA_VERSION = 1;

// Cold-start baseline (decision #5): new/unscored dishes get a neutral value, not
// zero, so a new restaurant isn't buried the moment it's indexed.
export const NEUTRAL_POPULARITY = 0.5;

// ── Source shapes (already-normalized inputs the pure projector consumes) ──────
// The Firestore adapter resolves raw docs into these (Timestamp → ms, derive
// onlinePaymentEnabled from paystackSubaccountCode, parse serviceAreas, etc.).

export type StructuredPromo = {
  type?: string;
  label?: string;
  active?: boolean;
  startsAt?: number | null;
  endsAt?: number | null;
};

export type SourceRestaurant = {
  slug: string;
  name?: string;
  description?: string;
  logo?: string;
  coverImage?: string;
  address?: string;
  state?: string;                      // structured location (G1) — owner-supplied Nigerian state
  city?: string;                       // structured location (G1) — owner-supplied city/town
  status?: string;                     // "live" | "draft" | "pending" | "rejected" | "suspended" | ...
  subscriptionStatus?: string;         // "active" | "expired" | ...
  subscriptionEndDateMs?: number | null; // resolved from Firestore Timestamp by the adapter
  deliveryEnabled?: boolean;
  pickupEnabled?: boolean;
  dineInEnabled?: boolean;
  deliveryFee?: number;
  deliveryZones?: { id: string; name: string; fee: number }[];
  payOnDeliveryEnabled?: boolean;
  onlinePaymentEnabled?: boolean;      // derived from paystackSubaccountCode by the adapter
  whatsappCheckoutEnabled?: boolean;
  hidePrices?: boolean;
  openingHours?: unknown;              // opaque map, stored verbatim for live open-now recompute
  serviceAreas?: string[];
  promo?: StructuredPromo | null;      // structured promo IF one already exists (display-only in 2.1)
  latitude?: number | null;            // geo fields (2.4) — normally absent until geocoded/confirmed
  longitude?: number | null;
  geohash?: string | null;
  formattedAddress?: string | null;
  geoStatus?: GeoStatus | null;        // "none" | "geocoded" | "confirmed" | "failed"
  geoConfirmedAtMs?: number | null;    // resolved from Firestore Timestamp by the adapter
  geoConfidence?: GeoConfidence | null; // provider precision (audit) — NOT projected to discovery
  geoQuery?: string | null;            // address string that produced the current pin (staleness check)

  // ── Marketplace (the consumer app) ──────────────────────────────────────────
  // A RestoFlow SaaS tenant and a marketplace restaurant are NOT the same thing.
  // These come from the `marketplace` map on the restaurant doc and decide
  // whether a restaurant may appear in the consumer app at all.
  marketplaceEnabled?: boolean;
  marketplaceCuisines?: string[];
  deliveryRadiusKm?: number | null;      // how far it will actually deliver
  prepTimeMins?: { min: number; max: number } | null;
  minOrderMinor?: number | null;
  marketplacePromoLabel?: string | null;
  /** Genuine marketplace publication time. Absent today — see New on RestoFlow. */
  marketplacePublishedAtMs?: number | null;
};

export type SourceMenuItem = {
  id: string;
  restaurantId: string;
  name?: string;
  description?: string;
  price?: number;
  category?: string;
  available?: boolean;
  image?: string;
  /**
   * Which sales channels this dish belongs to: "both" (default), "pos_only" or
   * "hidden". A restaurant uses it to keep staff meals and wholesale lines on
   * its menu without offering them to customers.
   */
  channel?: string;
};

// ── Projected discovery documents ─────────────────────────────────────────────

export type DiscoveryLocation = { lat: number; lng: number; geohash: string; formattedAddress: string } | null;

// The subset of restaurant info denormalized onto every dish so a dish card is a
// single read. PII-free by construction (see project.ts allowlist).
export type RestaurantSnapshot = {
  slug: string;
  name: string;
  description: string;
  logo: string;
  coverImage: string;
  fulfillment: { delivery: boolean; pickup: boolean; dineIn: boolean };
  deliveryFee: number | null;   // flat fee when known; null when dynamic/unset
  feeDynamic: boolean;          // true → "calculated at checkout"
  payments: string[];           // only methods actually enabled
  pickupAddress: string | null; // only when pickup enabled + address present
  location: DiscoveryLocation;  // null until a usable (confirmed/high-confidence) geo exists (2.4)
  geoStatus: GeoStatus;         // trust state so a dish card knows if its distance is reliable (2.4)
  state: string | null;         // structured location (G1) — owner-supplied, nullable
  city: string | null;          // structured location (G1) — owner-supplied, nullable

  // ── Marketplace facts, denormalized so a card is one read ───────────────────
  // NOTE: no price of any kind lives here. The marketplace customer price is
  // computed by `priceLine` at request time and is never indexed, because an
  // indexed price is a price that goes stale the moment markup config changes.
  marketplaceEnabled: boolean;
  deliveryRadiusKm: number | null;   // null = no radius configured, not "unlimited proven"
  prepTimeMins: { min: number; max: number } | null;
  minOrderMinor: number | null;
  cuisines: string[];
  promoLabel: string | null;
};

export type DiscoveryRestaurant = RestaurantSnapshot & {
  serviceAreas: string[];
  openingHours: unknown;        // stored so APIs recompute open-now live
  geoConfirmedAt: number | null; // ms; set only when a super-admin confirms the pin (2.4)
  promo: StructuredPromo | null;
  taxonomyTags: string[];       // union of dish tags (2.2)
  /**
   * Union over MARKETPLACE-VISIBLE dishes only.
   *
   * `taxonomyTags` includes tags contributed by pos_only and hidden dishes, so
   * a staff meal shapes what the restaurant matches. Harmless on the storefront,
   * which shows the whole menu; not harmless in the consumer app, where it lets
   * a dish the customer may not see decide that a restaurant answers a search.
   */
  marketplaceTaxonomyTags: string[];
  taxonomyVersion: number;      // which taxonomy version tagged this doc
  popularityScore: number;      // NEUTRAL_POPULARITY until computed (2.3)
  popularityRaw: number;        // debug: weighted order count (0 until computed)
  popularityOrders: number;     // debug: # qualifying orders (0 until computed)
  visible: boolean;             // status==live && subscription not expired (computed)
  /**
   * `visible` AND opted into the marketplace.
   *
   * Kept separate rather than folded into `visible`, because two different
   * products read this index: the storefront discovery page wants every live
   * tenant, and the consumer marketplace must see only restaurants a customer
   * can actually order from. Collapsing them would either hide half the web
   * page or leak internal restaurants into the app.
   */
  marketplaceVisible: boolean;
  /** Genuine publication timestamp, or null. Never inferred from createdAt. */
  marketplacePublishedAt: number | null;
  updatedAt: number;
  signalsComputedAt: number | null; // null until popularity computed (2.3)
  schemaVersion: number;
};

export type DiscoveryDish = {
  dishId: string;
  restaurantSlug: string;
  name: string;
  description: string;
  price: number | null;         // null when priceHidden
  priceHidden: boolean;
  image: string | null;
  available: boolean;
  rawCategory: string;          // preserved, un-normalized
  categoryKey: string;          // Sprint-1 normalizeCategoryKey
  taxonomyTags: string[];       // canonical tags + provisional fallback (2.2)
  taxonomyVersion: number;      // which taxonomy version tagged this doc
  popularityScore: number;      // NEUTRAL_POPULARITY until computed (2.3)
  popularityRaw: number;        // debug: weighted order count (0 until computed)
  popularityOrders: number;     // debug: # qualifying orders (0 until computed)
  promo: StructuredPromo | null;
  restaurantSnapshot: RestaurantSnapshot;
  visible: boolean;             // mirrors restaurant visibility (availability is `available`)
  /** Restaurant is visible AND marketplace-enabled. The consumer app filters on this. */
  marketplaceVisible: boolean;
  updatedAt: number;
  signalsComputedAt: number | null;
  schemaVersion: number;
};
