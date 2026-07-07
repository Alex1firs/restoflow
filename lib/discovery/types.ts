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
  latitude?: number | null;            // geo fields — normally absent until 2.4
  longitude?: number | null;
  geohash?: string | null;
  formattedAddress?: string | null;
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
  location: DiscoveryLocation;  // null until geo backfill (2.4)
};

export type DiscoveryRestaurant = RestaurantSnapshot & {
  serviceAreas: string[];
  openingHours: unknown;        // stored so APIs recompute open-now live
  promo: StructuredPromo | null;
  taxonomyTags: string[];       // [] in 2.1
  popularityScore: number;      // NEUTRAL_POPULARITY in 2.1
  visible: boolean;             // status==live && subscription not expired (computed)
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
  taxonomyTags: string[];       // [] in 2.1
  popularityScore: number;      // NEUTRAL_POPULARITY in 2.1
  promo: StructuredPromo | null;
  restaurantSnapshot: RestaurantSnapshot;
  visible: boolean;             // mirrors restaurant visibility (availability is `available`)
  updatedAt: number;
  signalsComputedAt: number | null;
  schemaVersion: number;
};
