// Discovery indexer — pure orchestration over a DiscoveryStore port.
//
// Turns restaurants + their menu_items into discovery documents. Idempotent
// (upsert + reconcile-delete → re-run yields identical state) and resilient
// (a single failing restaurant never aborts a backfill). No firebase import.

import { projectDish, projectRestaurant, restaurantSnapshotOf } from "./project";
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

    const restaurantDoc = projectRestaurant(source, nowMs);
    const snapshot = restaurantSnapshotOf(source);
    const items = await store.getMenuItems(slug);
    const dishes = items.map((it) =>
      projectDish(it, snapshot, restaurantDoc.visible, nowMs, !!source.hidePrices, restaurantDoc.promo),
    );

    await store.upsertRestaurant(restaurantDoc);
    if (dishes.length) await store.upsertDishes(dishes);
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
