// Storage port for the discovery indexer.
//
// The indexer orchestration (indexer.ts) depends only on this interface — never
// on firebase directly — so it stays pure and unit-testable with an in-memory
// fake. The real Firestore adapter (firestore-store.ts) implements it against
// the Admin SDK; the backfill script wires the same adapter with its own db.

import type { DiscoveryDish, DiscoveryRestaurant, SourceMenuItem, SourceRestaurant } from "./types";
import type { PopularityOrder, PopularityUpdate } from "./popularity";

export interface DiscoveryStore {
  /** All restaurant slugs (doc ids of the `restaurants` collection). */
  listRestaurantSlugs(): Promise<string[]>;
  /** Normalized source restaurant, or null if it no longer exists. */
  getRestaurant(slug: string): Promise<SourceRestaurant | null>;
  /** All menu items for a restaurant. */
  getMenuItems(slug: string): Promise<SourceMenuItem[]>;

  upsertRestaurant(doc: DiscoveryRestaurant): Promise<void>;
  upsertDishes(docs: DiscoveryDish[]): Promise<void>;

  /** Remove stale discovery dishes for a slug whose ids are not in `keepIds`. */
  deleteDishesNotIn(slug: string, keepIds: string[]): Promise<void>;
  /** Purge (restaurant removed entirely). */
  deleteRestaurant(slug: string): Promise<void>;
  deleteAllDishesForRestaurant(slug: string): Promise<void>;

  // ── Popularity (2.3) — READ-ONLY on `orders`; writes only discovery docs. ──
  /** Paid, non-rejected orders created at/after `sinceMs`, across all restaurants. */
  getRecentOrders(sinceMs: number): Promise<PopularityOrder[]>;
  listDiscoveryDishIds(): Promise<string[]>;
  listDiscoveryRestaurantSlugs(): Promise<string[]>;
  applyDishPopularity(updates: PopularityUpdate[]): Promise<void>;
  applyRestaurantPopularity(updates: PopularityUpdate[]): Promise<void>;
}
