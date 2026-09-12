// Discovery indexer — pure orchestration over a DiscoveryStore port.
//
// Turns restaurants + their menu_items into discovery documents. Idempotent
// (upsert + reconcile-delete → re-run yields identical state) and resilient
// (a single failing restaurant never aborts a backfill). No firebase import.

import { computeVisibility, projectDish, projectRestaurant, restaurantSnapshotOf } from "./project";
import type { DiscoveryStore } from "./store";

export type ReindexResult = {
  slug: string;
  ok: boolean;
  visible: boolean;
  dishCount: number;
  purged?: boolean;
  error?: string;
};

/**
 * Re-project one restaurant and all its dishes into the discovery index.
 * If the restaurant no longer exists, purge it. Invisible restaurants (draft /
 * expired / suspended) are still indexed but flagged `visible=false`, so a later
 * status change is a cheap field update and the public APIs simply filter.
 */
/**
 * Keep the popularity a previous run computed.
 *
 * Deliberately field-by-field rather than a spread of the whole prior document:
 * everything else in the projection is derived from source data and MUST be
 * replaced, so carrying anything more would resurrect stale names and prices.
 */
function carryPopularity<T extends {
  popularityScore: number; popularityRaw: number; popularityOrders: number; signalsComputedAt: number | null;
}>(fresh: T, prior: T | null): T {
  if (!prior || prior.signalsComputedAt == null) return fresh;
  return {
    ...fresh,
    popularityScore: prior.popularityScore,
    popularityRaw: prior.popularityRaw,
    popularityOrders: prior.popularityOrders,
    signalsComputedAt: prior.signalsComputedAt,
  };
}

export async function reindexRestaurant(
  store: DiscoveryStore,
  slug: string,
  nowMs: number,
): Promise<ReindexResult> {
  try {
    const source = await store.getRestaurant(slug);
    if (!source) {
      await store.deleteAllDishesForRestaurant(slug);
      await store.deleteRestaurant(slug);
      return { slug, ok: true, visible: false, dishCount: 0, purged: true };
    }

    const snapshot = restaurantSnapshotOf(source);
    const visible = computeVisibility(source, nowMs);
    const items = await store.getMenuItems(slug);
    const dishes = items.map((it) =>
      projectDish(it, snapshot, visible, nowMs, !!source.hidePrices, source.promo ?? null),
    );
    // Restaurant-level taxonomy = union of its dishes' tags (2.2).
    const taxonomyTags = [...new Set(dishes.flatMap((d) => d.taxonomyTags))];
    const restaurantDoc = projectRestaurant(source, nowMs, taxonomyTags);

    // Popularity is computed by a different job on a different cadence, and a
    // projection has no way to derive it — so writing the fresh document would
    // reset every score to the cold-start neutral. That is not a cosmetic loss:
    // it drops the restaurant out of Popular Around You until the next nightly
    // pass, as a consequence of someone editing one dish.
    const [priorRestaurant, priorDishes] = await Promise.all([
      store.getDiscoveryRestaurant(slug),
      store.getDiscoveryDishesForRestaurant(slug),
    ]);
    const priorBySlug = new Map(priorDishes.map((d) => [d.dishId, d]));

    await store.upsertRestaurant(carryPopularity(restaurantDoc, priorRestaurant));
    const merged = dishes.map((d) => carryPopularity(d, priorBySlug.get(d.dishId) ?? null));
    if (merged.length) await store.upsertDishes(merged);
    await store.deleteDishesNotIn(slug, dishes.map((d) => d.dishId));

    return { slug, ok: true, visible: restaurantDoc.visible, dishCount: dishes.length };
  } catch (e) {
    return { slug, ok: false, visible: false, dishCount: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Explicit removal (e.g. restaurant hard-deleted or manually delisted). */
export async function removeFromDiscovery(store: DiscoveryStore, slug: string): Promise<ReindexResult> {
  try {
    await store.deleteAllDishesForRestaurant(slug);
    await store.deleteRestaurant(slug);
    return { slug, ok: true, visible: false, dishCount: 0, purged: true };
  } catch (e) {
    return { slug, ok: false, visible: false, dishCount: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

export type BackfillSummary = {
  total: number;
  ok: number;
  failed: number;
  visible: number;
  dishes: number;
  results: ReindexResult[];
};

/**
 * Full (or scoped) rebuild. Processes restaurants one-by-one so a single failure
 * is recorded and skipped rather than aborting the run.
 */
export async function backfillAll(
  store: DiscoveryStore,
  nowMs: number,
  opts?: { slugs?: string[] },
): Promise<BackfillSummary> {
  const slugs = opts?.slugs ?? (await store.listRestaurantSlugs());
  const results: ReindexResult[] = [];
  for (const slug of slugs) {
    results.push(await reindexRestaurant(store, slug, nowMs));
  }
  return {
    total: results.length,
    ok: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    visible: results.filter((r) => r.visible).length,
    dishes: results.reduce((n, r) => n + r.dishCount, 0),
    results,
  };
}
