/**
 * Deliberately NOT `server-only`.
 *
 * This module holds no secret, reads no environment variable, and imports
 * `Firestore` as a TYPE only — it operates on a database handle passed in by
 * the caller and cannot reach one on its own. Marking it server-only bought no
 * safety and made the matching logic untestable, which is a worse trade.
 * The modules that DO hold secrets (config, store, webhook, sweeps) keep the
 * annotation, and a test asserts that.
 */
import type { Firestore } from "firebase-admin/firestore";
import { toPublicRestaurant, toPublicMenuItem, type PublicRestaurant } from "./discovery";
import { readMarketplaceSettings, pricingConfigFor } from "./config";

/**
 * Food-aware search.
 *
 * "What are you craving?" is a DISH question, and the previous implementation
 * could only answer a restaurant-name one: searching "jollof" returned nothing
 * even though a seeded restaurant sells Jollof Rice & Chicken.
 *
 * This extends the existing discovery path rather than adding a parallel
 * index. It starts from the same `marketplaceEnabled` query, builds cards with
 * the same `toPublicRestaurant`, and prices dishes with the same
 * `toPublicMenuItem` — which is what guarantees a `pos_only` or `hidden` item
 * cannot make a restaurant reachable through search when discovery would not
 * show it.
 *
 * ── Why the matching is in memory ───────────────────────────────────────────
 * Firestore has no substring index. A prefix query would miss "jollof" inside
 * "Party Jollof", and a full-text service is a dependency this does not need
 * yet. At marketplace scale this is one query for listed restaurants and one
 * for their menu items. When that stops being cheap, the `discovery_dishes`
 * projection already in this repo is where it moves — this contract would not
 * change.
 */

export type DishHit = {
  id: string;
  name: string;
  priceMinor: number;
  imageUrl: string | null;
  restaurantSlug: string;
  restaurantName: string;
};

export type SearchResult = {
  restaurants: Array<PublicRestaurant & { matchedDishes?: string[] }>;
  dishes: DishHit[];
};

/** Tokens, so "fried rice" still matches "Special Fried Rice". */
function tokens(q: string): string[] {
  return q.toLowerCase().split(/\s+/).map((t) => t.trim()).filter((t) => t.length >= 2);
}

function matchesAll(haystack: string, ts: string[]): boolean {
  const h = haystack.toLowerCase();
  return ts.every((t) => h.includes(t));
}

/** Exported for tests: the pure half, with no database. */
export function rankAndMatch(
  ts: string[],
  restaurants: Array<{ card: PublicRestaurant; raw: Record<string, unknown> }>,
  items: Array<{ id: string; raw: Record<string, unknown> }>
): SearchResult {
  if (ts.length === 0) return { restaurants: [], dishes: [] };

  const bySlug = new Map(restaurants.map((r) => [r.card.slug, r]));
  const matched = new Map<string, PublicRestaurant & { matchedDishes?: string[] }>();

  for (const { card } of restaurants) {
    if (matchesAll(card.name, ts) || card.cuisines.some((c) => matchesAll(c, ts))) {
      matched.set(card.slug, { ...card });
    }
  }

  const dishes: DishHit[] = [];
  for (const { id, raw } of items) {
    const slug = String(raw.restaurantId ?? "");
    const entry = bySlug.get(slug);
    if (!entry) continue; // menu item of a restaurant that is not listed

    const name = String(raw.name ?? "");
    const category = String(raw.category ?? "");
    if (!matchesAll(name, ts) && !matchesAll(category, ts)) continue;

    // The SAME visibility gate discovery uses: null for pos_only and hidden.
    const config = pricingConfigFor({ settings: readMarketplaceSettings(entry.raw) });
    const item = toPublicMenuItem(id, raw, config);
    if (!item) continue;

    dishes.push({
      id: item.id, name: item.name, priceMinor: item.priceMinor,
      imageUrl: item.imageUrl, restaurantSlug: slug, restaurantName: entry.card.name,
    });

    const existing = matched.get(slug) ?? { ...entry.card, matchedDishes: [] };
    existing.matchedDishes = [...(existing.matchedDishes ?? []), item.name].slice(0, 3);
    matched.set(slug, existing);
  }

  return { restaurants: [...matched.values()], dishes };
}

export async function searchMarketplace(
  db: Firestore,
  args: { q: string; at: { lat: number; lng: number } | null; nowMs: number }
): Promise<SearchResult> {
  const ts = tokens(args.q);
  if (ts.length === 0) return { restaurants: [], dishes: [] };

  // Only restaurants that opted in — the same filter discovery starts from.
  const snap = await db.collection("restaurants")
    .where("marketplace.marketplaceEnabled", "==", true)
    .limit(60).get();

  const restaurants = snap.docs.flatMap((d) => {
    const raw = d.data() ?? {};
    const card = toPublicRestaurant(d.id, raw, { at: args.at, nowMs: args.nowMs });
    return card ? [{ card, raw }] : [];
  });
  if (restaurants.length === 0) return { restaurants: [], dishes: [] };

  // `in` takes at most 30 values.
  const slugs = restaurants.slice(0, 30).map((r) => r.card.slug);
  const menus = await db.collection("menu_items").where("restaurantId", "in", slugs).get();
  const items = menus.docs.map((d) => ({ id: d.id, raw: d.data() ?? {} }));

  return rankAndMatch(ts, restaurants, items);
}
