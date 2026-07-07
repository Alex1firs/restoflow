// Discovery API handlers (Sprint 2.5b) — pure over the DiscoveryStore port.
//
// READ-ONLY: every handler only reads discovery_dishes / discovery_restaurants
// through the store and returns WHITELISTED DTOs (never the raw stored doc), so
// no internal bookkeeping (popularityRaw, schemaVersion, signalsComputedAt, …)
// and — by construction, since the projection already stripped it — no PII or
// private restaurant field can leak. No firebase import here: the Next route
// supplies the Admin-SDK-backed store and (optionally) an `isOpenNow` clock, so
// this module is fully tsx-testable with a fake store and a deterministic clock.

import { checkIsOpen, type OpeningHours } from "../restaurant-utils";
import { categoryDisplayLabel } from "../menu-utils";
import { CANONICAL_CATEGORIES } from "./taxonomy";
import {
  rankSearchDishes,
  rankCollectionDishes,
  rankRelatedDishes,
  rankRestaurantsBrowse,
  rankNearRestaurants,
  type RankContext,
  type RankedItem,
  type SignalBreakdown,
} from "./ranking";
import type { DiscoveryStore } from "./store";
import type { DiscoveryDish, DiscoveryRestaurant, DiscoveryLocation, StructuredPromo } from "./types";
import type { LatLng } from "./geo";

// ── Whitelisted public DTOs ──────────────────────────────────────────────────
export type PublicPromo = { type: string | null; label: string | null; active: boolean } | null;

export type PublicRestaurantMini = {
  slug: string; name: string; logo: string; coverImage: string;
  fulfillment: { delivery: boolean; pickup: boolean; dineIn: boolean };
  deliveryFee: number | null; feeDynamic: boolean; payments: string[];
  location: DiscoveryLocation; geoStatus: string; openNow: boolean;
};

export type PublicDish = {
  id: string; name: string; description: string; price: number | null; priceHidden: boolean;
  image: string | null; category: string; tags: string[]; available: boolean; promo: PublicPromo;
  restaurant: PublicRestaurantMini;
};

export type PublicRestaurant = {
  slug: string; name: string; description: string; logo: string; coverImage: string;
  fulfillment: { delivery: boolean; pickup: boolean; dineIn: boolean };
  deliveryFee: number | null; feeDynamic: boolean; payments: string[];
  serviceAreas: string[]; location: DiscoveryLocation; geoStatus: string; geoConfirmedAt: number | null;
  openNow: boolean; promo: PublicPromo; tags: string[];
};

type Annotations = { distanceKm: number | null; approximate: boolean; _score?: number; _breakdown?: SignalBreakdown[] };
export type DishResult = PublicDish & Annotations;
export type RestaurantResult = PublicRestaurant & Annotations;

export type ListResponse<T> = { items: T[]; nextCursor: string | null; total: number };
export type SearchResponse = ListResponse<DishResult>;
export type NearResponse = ListResponse<RestaurantResult> & { excludedNoUsableLocation: number };
export type CategoriesResponse = { facets: { tag: string; label: string; count: number }[]; total: number };
export type CollectionsResponse = { collection: string | null; items: DishResult[]; nextCursor: string | null; total: number };
export type RestaurantsResponse = ListResponse<RestaurantResult>;
export type DishDetailResponse = { dish: DishResult; related: ListResponse<DishResult> };

// ── Deps + params ────────────────────────────────────────────────────────────
export type HandlerDeps = {
  store: DiscoveryStore;
  nowMs: number;
  /** Injectable for deterministic tests; defaults to the real Lagos-time open check. */
  isOpenNow?: (openingHours: unknown) => boolean;
};

export type ListParams = {
  q?: string | null;
  tags?: string[] | null;
  tag?: string | null;       // collection key
  origin?: LatLng | null;
  radiusKm?: number;
  limit?: number;
  cursor?: string | null;
  explain?: boolean;
};

const defaultIsOpen = (oh: unknown) => checkIsOpen((oh ?? null) as OpeningHours | null);

// ── Mappers (the whitelist) ──────────────────────────────────────────────────
const toPromo = (p: StructuredPromo | null): PublicPromo => (p ? { type: p.type ?? null, label: p.label ?? null, active: p.active === true } : null);

function dishToPublic(d: DiscoveryDish, openNow: boolean): PublicDish {
  const s = d.restaurantSnapshot;
  return {
    id: d.dishId, name: d.name, description: d.description,
    price: d.priceHidden ? null : d.price, priceHidden: d.priceHidden, image: d.image,
    category: d.categoryKey, tags: d.taxonomyTags, available: d.available, promo: toPromo(d.promo),
    restaurant: {
      slug: s.slug, name: s.name, logo: s.logo, coverImage: s.coverImage,
      fulfillment: s.fulfillment, deliveryFee: s.deliveryFee, feeDynamic: s.feeDynamic,
      payments: s.payments, location: s.location, geoStatus: s.geoStatus, openNow,
    },
  };
}

function restaurantToPublic(r: DiscoveryRestaurant, openNow: boolean): PublicRestaurant {
  return {
    slug: r.slug, name: r.name, description: r.description, logo: r.logo, coverImage: r.coverImage,
    fulfillment: r.fulfillment, deliveryFee: r.deliveryFee, feeDynamic: r.feeDynamic, payments: r.payments,
    serviceAreas: r.serviceAreas, location: r.location, geoStatus: r.geoStatus, geoConfirmedAt: r.geoConfirmedAt,
    openNow, promo: toPromo(r.promo), tags: r.taxonomyTags,
  };
}

function decorateDish(ranked: RankedItem<DiscoveryDish>, openNowBySlug: Record<string, boolean>, explain: boolean): DishResult {
  const openNow = openNowBySlug[ranked.entity.restaurantSlug] ?? true;
  const out: DishResult = { ...dishToPublic(ranked.entity, openNow), distanceKm: ranked.distanceKm, approximate: ranked.approximate };
  if (explain) { out._score = ranked.score; out._breakdown = ranked.breakdown; }
  return out;
}

function decorateRestaurant(ranked: RankedItem<DiscoveryRestaurant>, openNowBySlug: Record<string, boolean>, explain: boolean): RestaurantResult {
  const openNow = openNowBySlug[ranked.entity.slug] ?? true;
  const out: RestaurantResult = { ...restaurantToPublic(ranked.entity, openNow), distanceKm: ranked.distanceKm, approximate: ranked.approximate };
  if (explain) { out._score = ranked.score; out._breakdown = ranked.breakdown; }
  return out;
}

function openMapFrom(restaurants: DiscoveryRestaurant[], deps: HandlerDeps): Record<string, boolean> {
  const isOpen = deps.isOpenNow ?? defaultIsOpen;
  const m: Record<string, boolean> = {};
  for (const r of restaurants) m[r.slug] = isOpen(r.openingHours);
  return m;
}

function labelForTag(tag: string): string {
  const canon = CANONICAL_CATEGORIES.find((c) => c.key === tag);
  return canon ? canon.label : categoryDisplayLabel(tag.replace(/-/g, " "));
}

function baseCtx(deps: HandlerDeps, p: ListParams, openNowBySlug: Record<string, boolean>): RankContext {
  return { nowMs: deps.nowMs, origin: p.origin ?? null, openNowBySlug, limit: p.limit, cursor: p.cursor ?? null, explain: !!p.explain };
}

// ── Handlers ─────────────────────────────────────────────────────────────────

/** /api/discovery/search — food-first ranked dishes. */
export async function searchDishesHandler(deps: HandlerDeps, p: ListParams): Promise<SearchResponse> {
  const [dishes, restaurants] = await Promise.all([deps.store.getVisibleDiscoveryDishes(), deps.store.getVisibleDiscoveryRestaurants()]);
  const openNowBySlug = openMapFrom(restaurants, deps);
  const page = rankSearchDishes(dishes, { ...baseCtx(deps, p, openNowBySlug), query: p.q ?? null, tags: p.tags ?? null });
  return { items: page.items.map((i) => decorateDish(i, openNowBySlug, !!p.explain)), nextCursor: page.nextCursor, total: page.total };
}

/** /api/discovery/near — distance-ranked restaurants (usable geo only). */
export async function nearRestaurantsHandler(deps: HandlerDeps, p: ListParams): Promise<NearResponse> {
  const restaurants = await deps.store.getVisibleDiscoveryRestaurants();
  const openNowBySlug = openMapFrom(restaurants, deps);
  const page = rankNearRestaurants(restaurants, { ...baseCtx(deps, p, openNowBySlug), radiusKm: p.radiusKm });
  return {
    items: page.items.map((i) => decorateRestaurant(i, openNowBySlug, !!p.explain)),
    nextCursor: page.nextCursor,
    total: page.total,
    excludedNoUsableLocation: page.excludedNoUsableLocation ?? 0,
  };
}

/** /api/discovery/categories — taxonomy facets + counts from visible dishes. */
export async function categoriesHandler(deps: HandlerDeps): Promise<CategoriesResponse> {
  const dishes = await deps.store.getVisibleDiscoveryDishes();
  const counts = new Map<string, number>();
  for (const d of dishes) for (const t of d.taxonomyTags) counts.set(t, (counts.get(t) ?? 0) + 1);
  const facets = [...counts.entries()]
    .map(([tag, count]) => ({ tag, label: labelForTag(tag), count }))
    .sort((a, b) => b.count - a.count || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  return { facets, total: dishes.length };
}

/** /api/discovery/collections — dishes for one taxonomy tag/collection key. */
export async function collectionsHandler(deps: HandlerDeps, p: ListParams): Promise<CollectionsResponse> {
  const tag = (p.tag ?? "").trim();
  if (!tag) return { collection: null, items: [], nextCursor: null, total: 0 };
  const [dishes, restaurants] = await Promise.all([deps.store.getVisibleDiscoveryDishes(), deps.store.getVisibleDiscoveryRestaurants()]);
  const openNowBySlug = openMapFrom(restaurants, deps);
  const page = rankCollectionDishes(dishes, { ...baseCtx(deps, p, openNowBySlug), tags: [tag] });
  return { collection: tag, items: page.items.map((i) => decorateDish(i, openNowBySlug, !!p.explain)), nextCursor: page.nextCursor, total: page.total };
}

/** /api/discovery/restaurants — restaurant-first browse. */
export async function restaurantsHandler(deps: HandlerDeps, p: ListParams): Promise<RestaurantsResponse> {
  const restaurants = await deps.store.getVisibleDiscoveryRestaurants();
  const openNowBySlug = openMapFrom(restaurants, deps);
  const page = rankRestaurantsBrowse(restaurants, { ...baseCtx(deps, p, openNowBySlug), query: p.q ?? null, tags: p.tags ?? null });
  return { items: page.items.map((i) => decorateRestaurant(i, openNowBySlug, !!p.explain)), nextCursor: page.nextCursor, total: page.total };
}

/** /api/discovery/dish/[id] — one dish + related ranked dishes. Returns null when absent/hidden (route → 404). */
export async function dishDetailHandler(deps: HandlerDeps, id: string, p: ListParams): Promise<DishDetailResponse | null> {
  const dish = await deps.store.getDiscoveryDishById(id);
  if (!dish || !dish.visible) return null;
  const [dishes, restaurants] = await Promise.all([deps.store.getVisibleDiscoveryDishes(), deps.store.getVisibleDiscoveryRestaurants()]);
  const openNowBySlug = openMapFrom(restaurants, deps);
  const openNow = openNowBySlug[dish.restaurantSlug] ?? true;
  const detail: DishResult = { ...dishToPublic(dish, openNow), distanceKm: null, approximate: false };
  const related = rankRelatedDishes(dishes, { ...baseCtx(deps, p, openNowBySlug), seedDishId: id, seedTags: dish.taxonomyTags });
  return { dish: detail, related: { items: related.items.map((i) => decorateDish(i, openNowBySlug, !!p.explain)), nextCursor: related.nextCursor, total: related.total } };
}

// ── Request param parsing (pure; shared by the thin route files) ──────────────
export function parseListParams(sp: URLSearchParams): ListParams & { id?: string } {
  const num = (v: string | null): number | undefined => {
    if (v == null || v.trim() === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const lat = num(sp.get("lat"));
  const lng = num(sp.get("lng"));
  const origin = typeof lat === "number" && typeof lng === "number" ? { lat, lng } : null;
  const limitRaw = num(sp.get("limit"));
  const limit = typeof limitRaw === "number" ? Math.max(1, Math.min(50, Math.floor(limitRaw))) : undefined;
  const tagsRaw = sp.get("tags");
  const tags = tagsRaw ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean) : null;
  const explainRaw = sp.get("explain");
  const explain = explainRaw === "1" || explainRaw === "true";
  return {
    q: sp.get("q"),
    tags,
    tag: sp.get("tag") ?? sp.get("key"),
    origin,
    radiusKm: num(sp.get("radiusKm")),
    limit,
    cursor: sp.get("cursor"),
    explain,
  };
}
