// Deterministic discovery ranking engine (Sprint 2.5a).
//
// Pure — no I/O, no firebase, no Date.now(). Every request-time fact (nowMs,
// origin, open-now state) is passed IN so the engine is fully reproducible and
// tsx-testable, mirroring 2.1–2.4. It is READ-ONLY over projected discovery docs
// and reads NOTHING outside them — owner-typed rating / ordersToday /
// deliveryTime do not exist on these types and are therefore unreachable.
//
// Model: score = Σ weight[signal] × normalized[signal]. Weights are fixed
// constants per surface; an inapplicable signal contributes 0 for every
// candidate (no renormalization, so ordering is unaffected — PO decision #6).

import { haversineKm, isApproximateLocation, isUsableForDistance, type LatLng } from "./geo";
import { selectNearby } from "./near-search";
import type { DiscoveryDish, DiscoveryLocation, DiscoveryRestaurant, StructuredPromo } from "./types";

// ── Tunables (PO-approved defaults) ───────────────────────────────────────────
export const DISTANCE_SCALE_KM = 3;      // exp decay scale (decision #5)
export const PREORDER_OPEN_CREDIT = 0.3; // closed-but-preorder partial open-now credit (#3)
export const DEFAULT_LIMIT = 20;
export const MAX_PER_RESTAURANT = 3;     // dish diversity cap (#10)

export type Surface = "search" | "near" | "collections" | "restaurants" | "related";
export type SignalName = "relevance" | "popularity" | "openNow" | "distance" | "promo" | "availability" | "rating";

const SIGNAL_ORDER: SignalName[] = ["relevance", "popularity", "openNow", "distance", "promo", "availability", "rating"];

export type SurfaceWeights = Record<SignalName, number>;

// rating is pinned at 0 on every surface — reserved slot, no data source (#, guardrail).
export const WEIGHTS: Record<Surface, SurfaceWeights> = {
  search: { relevance: 0.45, popularity: 0.35, openNow: 0.1, distance: 0.0, promo: 0.05, availability: 0.05, rating: 0 },
  near: { relevance: 0.1, popularity: 0.25, openNow: 0.1, distance: 0.5, promo: 0.05, availability: 0, rating: 0 },
  collections: { relevance: 0.15, popularity: 0.55, openNow: 0.15, distance: 0.05, promo: 0.1, availability: 0, rating: 0 },
  restaurants: { relevance: 0.0, popularity: 0.55, openNow: 0.2, distance: 0.15, promo: 0.1, availability: 0, rating: 0 },
  related: { relevance: 0.5, popularity: 0.3, openNow: 0.1, distance: 0.0, promo: 0.0, availability: 0.1, rating: 0 },
};

// ── Context ───────────────────────────────────────────────────────────────────
export type RankContext = {
  nowMs: number;
  origin?: LatLng | null;
  query?: string | null;
  tags?: string[] | null;                         // taxonomy tags constraining the set (collection / query-derived)
  openNowBySlug?: Record<string, boolean>;        // computed by the adapter via checkIsOpen(); default → open
  preorderBySlug?: Record<string, boolean>;       // default → false
  limit?: number;
  cursor?: string | null;
  explain?: boolean;
  seedDishId?: string;                            // related: seed to exclude
  seedTags?: string[];                            // related: seed dish tags
  radiusKm?: number;                              // near
  maxPerRestaurant?: number;                      // dish surfaces — override the diversity cap (default 3)
};

type Signal = { raw: number; applicable: boolean };
export type SignalBreakdown = { signal: SignalName; raw: number; weight: number; weighted: number; applicable: boolean };

export type RankedItem<T> = {
  id: string;                 // dishId or restaurant slug (total-order tiebreak)
  slug: string;               // owning restaurant slug (diversity cap)
  score: number;
  popularityOrders: number;
  popularityRaw: number;
  updatedAt: number;
  distanceKm: number | null;  // annotation (present when usable geo + origin)
  approximate: boolean;       // geocoded-not-confirmed distance
  entity: T;
  breakdown?: SignalBreakdown[];
};

export type RankPage<T> = {
  items: RankedItem<T>[];
  nextCursor: string | null;
  total: number;                     // size of the ranked+capped set (for the frozen snapshot)
  excludedNoUsableLocation?: number; // /near only
};

// ── Normalizers ────────────────────────────────────────────────────────────────
const NA: Signal = { raw: 0, applicable: false };

function flag(map: Record<string, boolean> | undefined, slug: string, dflt: boolean): boolean {
  if (!map) return dflt;
  return slug in map ? !!map[slug] : dflt;
}

/** Relevance is applicable only when a query or tag constraint exists. */
function relevanceSignal(tags: string[], name: string, categoryKey: string, ctx: RankContext): Signal {
  const wantTags = (ctx.seedTags ?? ctx.tags ?? []).filter(Boolean);
  const q = (ctx.query ?? "").trim().toLowerCase();
  if (wantTags.length === 0 && !q) return NA;

  let best = 0;
  if (wantTags.length) {
    const set = new Set(tags);
    if (wantTags.some((t) => set.has(t))) best = Math.max(best, 1.0);
  }
  if (q) {
    const tokens = q.split(/\s+/).filter(Boolean);
    const nameL = name.toLowerCase();
    const catL = categoryKey.toLowerCase();
    if (tokens.some((t) => tags.some((tag) => tag.includes(t)))) best = Math.max(best, 0.7);
    if (tokens.some((t) => nameL.includes(t))) best = Math.max(best, 0.6);
    if (tokens.some((t) => catL.includes(t))) best = Math.max(best, 0.4);
  }
  return { raw: best, applicable: true };
}

function openNowSignal(slug: string, ctx: RankContext): Signal {
  const open = flag(ctx.openNowBySlug, slug, true); // adapter default matches checkIsOpen leniency
  if (open) return { raw: 1, applicable: true };
  const preorder = flag(ctx.preorderBySlug, slug, false);
  return { raw: preorder ? PREORDER_OPEN_CREDIT : 0, applicable: true }; // demoted, still discoverable (#3)
}

function distanceParts(loc: DiscoveryLocation, geoStatus: DiscoveryRestaurant["geoStatus"], origin: LatLng | null | undefined): { sig: Signal; distanceKm: number | null; approximate: boolean } {
  if (!origin || !loc || !isUsableForDistance(geoStatus)) return { sig: NA, distanceKm: null, approximate: false };
  const distanceKm = haversineKm(origin, { lat: loc.lat, lng: loc.lng });
  return { sig: { raw: Math.exp(-distanceKm / DISTANCE_SCALE_KM), applicable: true }, distanceKm, approximate: isApproximateLocation(geoStatus) };
}

const promoSignal = (promo: StructuredPromo | null): Signal => (promo?.active === true ? { raw: 1, applicable: true } : { raw: 0, applicable: true });

function combine(signals: Record<SignalName, Signal>, w: SurfaceWeights): { score: number; breakdown: SignalBreakdown[] } {
  let score = 0;
  const breakdown: SignalBreakdown[] = [];
  for (const s of SIGNAL_ORDER) {
    const sig = signals[s];
    const weight = w[s];
    const weighted = sig.applicable ? weight * sig.raw : 0;
    score += weighted;
    breakdown.push({ signal: s, raw: sig.raw, weight, weighted, applicable: sig.applicable });
  }
  return { score, breakdown };
}

// ── Per-entity scoring ──────────────────────────────────────────────────────────
function scoreDish(dish: DiscoveryDish, ctx: RankContext, w: SurfaceWeights, origin: LatLng | null): RankedItem<DiscoveryDish> {
  const snap = dish.restaurantSnapshot;
  const rel = relevanceSignal(dish.taxonomyTags, dish.name, dish.categoryKey, ctx);
  const dist = distanceParts(snap.location, snap.geoStatus, origin);
  const signals: Record<SignalName, Signal> = {
    relevance: rel,
    popularity: { raw: dish.popularityScore, applicable: true },
    openNow: openNowSignal(dish.restaurantSlug, ctx),
    distance: dist.sig,
    promo: promoSignal(dish.promo),
    availability: { raw: dish.available ? 1 : 0, applicable: true },
    rating: NA,
  };
  const { score, breakdown } = combine(signals, w);
  return { id: dish.dishId, slug: dish.restaurantSlug, score, popularityOrders: dish.popularityOrders, popularityRaw: dish.popularityRaw, updatedAt: dish.updatedAt, distanceKm: dist.distanceKm, approximate: dist.approximate, entity: dish, breakdown };
}

function scoreRestaurant(r: DiscoveryRestaurant, ctx: RankContext, w: SurfaceWeights, origin: LatLng | null, distanceKm?: number | null, approximate?: boolean): RankedItem<DiscoveryRestaurant> {
  const rel = relevanceSignal(r.taxonomyTags, r.name, "", ctx);
  const dist = typeof distanceKm === "number"
    ? { sig: { raw: Math.exp(-distanceKm / DISTANCE_SCALE_KM), applicable: true } as Signal, distanceKm, approximate: !!approximate }
    : distanceParts(r.location, r.geoStatus, origin);
  const signals: Record<SignalName, Signal> = {
    relevance: rel,
    popularity: { raw: r.popularityScore, applicable: true },
    openNow: openNowSignal(r.slug, ctx),
    distance: dist.sig,
    promo: promoSignal(r.promo),
    availability: NA,
    rating: NA,
  };
  const { score, breakdown } = combine(signals, w);
  return { id: r.slug, slug: r.slug, score, popularityOrders: r.popularityOrders, popularityRaw: r.popularityRaw, updatedAt: r.updatedAt, distanceKm: dist.distanceKm, approximate: dist.approximate, entity: r, breakdown };
}

// ── Deterministic ordering + keyset pagination ───────────────────────────────────
type SortKey = { score: number; popularityOrders: number; popularityRaw: number; updatedAt: number; id: string };

function compareKey(a: SortKey, b: SortKey): number {
  if (b.score !== a.score) return b.score - a.score;                       // score DESC
  if (b.popularityOrders !== a.popularityOrders) return b.popularityOrders - a.popularityOrders; // evidence DESC
  if (b.popularityRaw !== a.popularityRaw) return b.popularityRaw - a.popularityRaw;             // raw DESC
  if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt;       // newer first
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;                           // id ASC — total order
}

function capPerSlug<T>(sorted: RankedItem<T>[], cap: number): RankedItem<T>[] {
  const count = new Map<string, number>();
  const out: RankedItem<T>[] = [];
  for (const item of sorted) {
    const n = count.get(item.slug) ?? 0;
    if (n >= cap) continue; // drop 4th+ dish of a restaurant → guarantees ≤cap per page too
    count.set(item.slug, n + 1);
    out.push(item);
  }
  return out;
}

// Validation key = the SEARCH INTENT only. origin + nowMs are the frozen snapshot
// carried inside the cursor (not part of the key) so a jittered origin / advanced
// clock on a "load more" call does NOT invalidate the cursor — the frozen values win.
function contextKey(surface: Surface, ctx: RankContext): string {
  const tags = (ctx.seedTags ?? ctx.tags ?? []).slice().sort().join(",");
  const q = (ctx.query ?? "").trim().toLowerCase();
  return `${surface}|q:${q}|t:${tags}|seed:${ctx.seedDishId ?? ""}`;
}

type CursorPayload = { v: 1; ctxKey: string; nowMs: number; origin: LatLng | null; key: SortKey };

export function encodeCursor(item: RankedItem<unknown>, ctxKey: string, nowMs: number, origin: LatLng | null): string {
  const payload: CursorPayload = {
    v: 1, ctxKey, nowMs, origin,
    key: { score: item.score, popularityOrders: item.popularityOrders, popularityRaw: item.popularityRaw, updatedAt: item.updatedAt, id: item.id },
  };
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

export function decodeCursor(cursor: string | null | undefined, expectedCtxKey: string): CursorPayload | null {
  if (!cursor) return null;
  try {
    const p = JSON.parse(Buffer.from(cursor, "base64").toString("utf8")) as CursorPayload;
    if (p?.v !== 1 || p.ctxKey !== expectedCtxKey || !p.key) return null; // stale / mismatched context → fresh page
    return p;
  } catch {
    return null;
  }
}

/** Sort, apply optional per-restaurant cap, then keyset-paginate against the frozen snapshot. */
function finalize<T>(scored: RankedItem<T>[], surface: Surface, ctx: RankContext, origin: LatLng | null, nowMs: number, capPerRestaurant: number | null): RankPage<T> {
  const sorted = scored.slice().sort((a, b) => compareKey(a, b));
  const capped = capPerRestaurant ? capPerSlug(sorted, capPerRestaurant) : sorted;

  const ctxKey = contextKey(surface, ctx);
  const cur = decodeCursor(ctx.cursor, ctxKey);
  const start = cur ? capped.findIndex((r) => compareKey(cur.key, r) < 0) : 0; // first strictly-after cursor
  const from = start < 0 ? capped.length : start;

  const limit = ctx.limit ?? DEFAULT_LIMIT;
  const page = capped.slice(from, from + limit);
  const hasMore = from + limit < capped.length;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last, ctxKey, nowMs, origin) : null;

  if (!ctx.explain) for (const p of page) delete p.breakdown;
  return { items: page, nextCursor, total: capped.length };
}

/** Cursor freezes nowMs + origin so every page of a session ranks against one snapshot (#7). */
function frozen(ctx: RankContext, surface: Surface): { nowMs: number; origin: LatLng | null } {
  const origin0 = ctx.origin ?? null;
  const cur = decodeCursor(ctx.cursor, contextKey(surface, ctx));
  return { nowMs: cur ? cur.nowMs : ctx.nowMs, origin: cur ? cur.origin : origin0 };
}

// ── Public surface rankers ───────────────────────────────────────────────────────
const hasConstraint = (ctx: RankContext) => !!(ctx.query && ctx.query.trim()) || !!(ctx.tags && ctx.tags.length) || !!(ctx.seedTags && ctx.seedTags.length);

/** /search — food-first dishes. Hard filters: visible, available, and (query/tag present) relevance>0. */
export function rankSearchDishes(dishes: DiscoveryDish[], ctx: RankContext): RankPage<DiscoveryDish> {
  return rankDishSurface(dishes, ctx, "search");
}

/** /collections — dishes constrained to a taxonomy tag (relevance>0 required). */
export function rankCollectionDishes(dishes: DiscoveryDish[], ctx: RankContext): RankPage<DiscoveryDish> {
  return rankDishSurface(dishes, ctx, "collections");
}

/** dish-detail related items — same-taxonomy dishes, seed excluded. */
export function rankRelatedDishes(dishes: DiscoveryDish[], ctx: RankContext): RankPage<DiscoveryDish> {
  return rankDishSurface(dishes.filter((d) => d.dishId !== ctx.seedDishId), ctx, "related");
}

function rankDishSurface(dishes: DiscoveryDish[], ctx: RankContext, surface: Surface): RankPage<DiscoveryDish> {
  const { nowMs, origin } = frozen(ctx, surface);
  const w = WEIGHTS[surface];
  const constrained = hasConstraint(ctx);
  const scored: RankedItem<DiscoveryDish>[] = [];
  for (const d of dishes) {
    if (!d.visible || !d.available) continue;                      // hard filters (#2)
    const item = scoreDish(d, ctx, w, origin);
    const rel = item.breakdown?.find((b) => b.signal === "relevance");
    if (constrained && rel?.applicable && rel.raw <= 0) continue;   // match predicate
    scored.push(item);
  }
  return finalize(scored, surface, ctx, origin, nowMs, ctx.maxPerRestaurant ?? MAX_PER_RESTAURANT);
}

/** /restaurants browse — no query; popularity-led restaurant ranking. */
export function rankRestaurantsBrowse(restaurants: DiscoveryRestaurant[], ctx: RankContext): RankPage<DiscoveryRestaurant> {
  const surface: Surface = "restaurants";
  const { nowMs, origin } = frozen(ctx, surface);
  const w = WEIGHTS[surface];
  const constrained = hasConstraint(ctx);
  const scored: RankedItem<DiscoveryRestaurant>[] = [];
  for (const r of restaurants) {
    if (!r.visible) continue;
    const item = scoreRestaurant(r, ctx, w, origin);
    const rel = item.breakdown?.find((b) => b.signal === "relevance");
    if (constrained && rel?.applicable && rel.raw <= 0) continue;
    scored.push(item);
  }
  return finalize(scored, surface, ctx, origin, nowMs, null);
}

/** /near — distance-dominant restaurants. Reuses 2.4 geo filtering + exclusion accounting. */
export function rankNearRestaurants(restaurants: DiscoveryRestaurant[], ctx: RankContext): RankPage<DiscoveryRestaurant> {
  const surface: Surface = "near";
  const { nowMs, origin } = frozen(ctx, surface);
  if (!origin) return { items: [], nextCursor: null, total: 0, excludedNoUsableLocation: 0 };

  // selectNearby: usable-geo hard filter + radius + honest exclusion count + distanceKm.
  const near = selectNearby(restaurants, origin, { radiusKm: ctx.radiusKm, limit: restaurants.length });
  const w = WEIGHTS[surface];
  const constrained = hasConstraint(ctx);
  const scored: RankedItem<DiscoveryRestaurant>[] = [];
  for (const n of near.results) {
    const item = scoreRestaurant(n.restaurant, ctx, w, origin, n.distanceKm, n.approximate);
    const rel = item.breakdown?.find((b) => b.signal === "relevance");
    if (constrained && rel?.applicable && rel.raw <= 0) continue;
    scored.push(item);
  }
  const page = finalize(scored, surface, ctx, origin, nowMs, null);
  page.excludedNoUsableLocation = near.excludedNoUsableLocation;
  return page;
}
