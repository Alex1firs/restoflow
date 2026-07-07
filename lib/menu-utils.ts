// Display-layer menu helpers: category normalization + search.
//
// NON-DESTRUCTIVE. Nothing here mutates or migrates data — it only changes how
// the existing menu_items are grouped and filtered for display. Every item keeps
// its original `category` string in Firestore; two items whose categories differ
// only by case/whitespace ("grills" / "Grills" / " GRILLS ") are simply shown
// under one merged tab. No item can be dropped by grouping — an item with a blank
// category just isn't given a tab; it still appears in the unfiltered menu.

export type MenuLike = {
  id: string;
  name: string;
  category?: string | null;
  description?: string | null;
};

export type CategoryGroup = { key: string; label: string; count: number };

/** Grouping key: trim, collapse internal whitespace, lowercase. "" if blank. */
export function normalizeCategoryKey(raw: string | null | undefined): string {
  return (raw ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/** Restaurant-friendly display label — Title-Cased from the normalized value. */
export function categoryDisplayLabel(raw: string | null | undefined): string {
  const norm = normalizeCategoryKey(raw);
  if (!norm) return "";
  return norm.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Dedupe categories by normalized key, preserving first-seen (menu) order and
 * counting how many items fall under each. Blank categories are skipped (no tab)
 * but their items remain in the full list.
 */
export function groupCategories(items: MenuLike[]): CategoryGroup[] {
  const order: string[] = [];
  const map = new Map<string, CategoryGroup>();
  for (const it of items) {
    const key = normalizeCategoryKey(it.category);
    if (!key) continue;
    const existing = map.get(key);
    if (existing) {
      existing.count++;
    } else {
      map.set(key, { key, label: categoryDisplayLabel(it.category), count: 1 });
      order.push(key);
    }
  }
  return order.map((k) => map.get(k)!);
}

/** True if the item matches the search query by name, description, or category. */
export function itemMatchesQuery(item: MenuLike, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const name = (item.name ?? "").toLowerCase();
  const desc = (item.description ?? "").toLowerCase();
  const cat = normalizeCategoryKey(item.category); // already lowercased
  return name.includes(q) || desc.includes(q) || cat.includes(q);
}

/**
 * Filter the menu by an active normalized category key (null = all) AND a search
 * query. Category matching is normalized, so an active "grills" tab captures
 * items stored as "Grills", "GRILLS", etc.
 */
export function filterMenuItems<T extends MenuLike>(
  items: T[],
  activeCategoryKey: string | null,
  query: string,
): T[] {
  return items.filter((it) => {
    if (activeCategoryKey && normalizeCategoryKey(it.category) !== activeCategoryKey) return false;
    if (!itemMatchesQuery(it, query)) return false;
    return true;
  });
}
