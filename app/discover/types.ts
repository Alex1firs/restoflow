// Lightweight client-side mirrors of the /api/discovery/* response DTOs.
// Kept local to the frontend so the discovery ranking engine is NOT bundled
// into the client. Source of truth: lib/discovery/api-handlers.ts.

export type PublicPromo = { type: string | null; label: string | null; active: boolean } | null;

export type PublicLocation = { lat: number; lng: number; geohash: string; formattedAddress: string } | null;

export type Fulfillment = { delivery: boolean; pickup: boolean; dineIn: boolean };

export type DishCardData = {
  id: string;
  name: string;
  description: string;
  price: number | null;
  priceHidden: boolean;
  image: string | null;
  category: string;
  tags: string[];
  available: boolean;
  promo: PublicPromo;
  restaurant: {
    slug: string;
    name: string;
    logo: string;
    coverImage: string;
    fulfillment: Fulfillment;
    deliveryFee: number | null;
    feeDynamic: boolean;
    payments: string[];
    location: PublicLocation;
    geoStatus: string;
    state: string | null;
    city: string | null;
    openNow: boolean;
  };
  distanceKm: number | null;
  approximate: boolean;
};

export type RestaurantCardData = {
  slug: string;
  name: string;
  description: string;
  logo: string;
  coverImage: string;
  fulfillment: Fulfillment;
  deliveryFee: number | null;
  feeDynamic: boolean;
  payments: string[];
  serviceAreas: string[];
  location: PublicLocation;
  geoStatus: string;
  geoConfirmedAt: number | null;
  state: string | null;
  city: string | null;
  openNow: boolean;
  promo: PublicPromo;
  tags: string[];
  distanceKm: number | null;
  approximate: boolean;
};

export type Facet = { tag: string; label: string; count: number };

export type ListResponse<T> = { items: T[]; nextCursor: string | null; total: number };
export type SearchResponse = ListResponse<DishCardData>;
export type CollectionsResponse = { collection: string | null; items: DishCardData[]; nextCursor: string | null; total: number };
export type CategoriesResponse = { facets: Facet[]; total: number };
export type NearResponse = ListResponse<RestaurantCardData> & { excludedNoUsableLocation: number };
export type RestaurantsResponse = ListResponse<RestaurantCardData>;

export type Origin = { lat: number; lng: number };
