// Food taxonomy (Sprint 2.2) — PO-approved seed.
//
// Non-destructive: maps each dish onto canonical discovery categories at INDEX
// time. It never mutates menu_items — the dish keeps its original `category`
// string (preserved as `rawCategory`) and its Sprint-1 normalized `categoryKey`.
//
// Multi-tagging (ruling #3): a dish is tagged from BOTH its category synonyms and
// its dish-name keywords, so "Specials / Jollof Rice" → [combos-specials, rice-jollof].
// Unmapped fallback (ruling #4): if nothing matches, the dish keeps its normalized
// category label as a single provisional tag — it is never dropped or left tagless
// (unless it also has no category at all).
//
// Seed is code-embedded + versioned (TAXONOMY_VERSION). A runtime-editable
// discovery_taxonomy/{version} Firestore doc can mirror this later if needed; not
// required for 2.2.

import { normalizeCategoryKey } from "../menu-utils";

export const TAXONOMY_VERSION = 1;

type SeedEntry = {
  key: string;
  label: string;
  categorySynonyms: string[]; // matched against the normalized category
  nameKeywords: string[];     // matched (word-boundary) against the dish name
};

// 13 canonical categories (the 15-row seed with swallow/soups-broths/swallow-soups
// merged into one per ruling #1).
const SEED: SeedEntry[] = [
  {
    key: "rice-jollof", label: "Rice & Jollof",
    categorySynonyms: ["jollof", "jollof rice", "rice dishes", "rice", "fried rice", "coconut rice", "native rice", "white rice", "ofada", "rice and stew"],
    nameKeywords: ["jollof", "fried rice", "coconut rice", "ofada", "native rice", "rice"],
  },
  {
    key: "swallow-soups", label: "Swallow & Soups",
    categorySynonyms: ["soup", "soups", "pepper soup", "peppersoup", "swallow", "egusi", "okro", "okra", "ogbono", "banga", "afang", "oha", "edikaikong", "edikang ikong", "white soup", "nsala", "vegetable soup", "fufu", "eba", "semo", "semovita", "amala", "pounded yam", "wheat", "starch", "tuwo"],
    nameKeywords: ["soup", "egusi", "okro", "okra", "ogbono", "banga", "afang", "oha", "edikaikong", "nsala", "pepper soup", "fufu", "eba", "semo", "amala", "pounded yam", "tuwo", "starch"],
  },
  {
    key: "grills-suya", label: "Grills & Suya",
    categorySynonyms: ["grills", "grill", "grilled", "suya", "barbecue", "bbq", "asun", "peppered meat", "nkwobi", "isi ewu", "isi-ewu"],
    nameKeywords: ["suya", "grilled", "barbecue", "bbq", "asun", "nkwobi", "isi ewu", "peppered"],
  },
  {
    key: "proteins", label: "Proteins",
    categorySynonyms: ["protein", "proteins", "meat", "meats"],
    nameKeywords: ["chicken", "turkey", "goat meat", "beef", "gizzard", "ponmo", "shaki", "kpomo", "assorted"],
  },
  {
    key: "pasta-noodles", label: "Pasta & Noodles",
    categorySynonyms: ["pasta", "noodles", "spaghetti", "macaroni", "indomie"],
    nameKeywords: ["pasta", "spaghetti", "macaroni", "noodles", "indomie", "stir fry", "stir-fry"],
  },
  {
    key: "snacks-smallchops", label: "Snacks & Small Chops",
    categorySynonyms: ["small chops", "smallchops", "snacks", "snack", "finger foods", "fingers", "pastries", "small chop"],
    nameKeywords: ["small chops", "samosa", "spring roll", "puff puff", "puff-puff", "chin chin", "meat pie", "sausage roll"],
  },
  {
    key: "swallow-sides", label: "Sides",
    categorySynonyms: ["sides", "side", "side dish", "side dishes", "extras", "add ons", "add-ons", "addons"],
    nameKeywords: ["plantain", "dodo", "moi moi", "moin moin", "moimoi", "coleslaw", "salad", "chips", "fries", "boli"],
  },
  {
    key: "breakfast", label: "Breakfast",
    categorySynonyms: ["breakfast", "brunch"],
    nameKeywords: ["pancake", "akara", "custard", "pap", "akamu", "yam and egg", "bread and egg", "toast", "cereal"],
  },
  {
    key: "drinks", label: "Drinks",
    categorySynonyms: ["drink", "drinks", "beverage", "beverages", "juices", "juice", "smoothies"],
    nameKeywords: ["smoothie", "juice", "zobo", "chapman", "water", "soda", "soft drink", "cocktail", "mocktail", "tea", "coffee", "yoghurt", "yogurt", "malt"],
  },
  {
    key: "desserts", label: "Desserts",
    categorySynonyms: ["dessert", "desserts", "sweets"],
    nameKeywords: ["cake", "ice cream", "ice-cream", "parfait", "doughnut", "donut", "waffle", "cupcake"],
  },
  {
    key: "seafood", label: "Seafood",
    categorySynonyms: ["seafood", "sea food"],
    nameKeywords: ["prawns", "shrimp", "crab", "calamari", "catfish", "croaker", "titus", "fish", "lobster", "point and kill"],
  },
  {
    key: "continental", label: "Continental",
    categorySynonyms: ["continental", "intercontinental"],
    nameKeywords: ["burger", "pizza", "shawarma", "sandwich", "wrap", "wings", "fried chicken", "hotdog", "hot dog"],
  },
  {
    key: "combos-specials", label: "Combos & Specials",
    categorySynonyms: ["combo", "combos", "special", "specials", "platter", "platters", "family pack", "bundle", "bundles", "value meal", "meal deal"],
    nameKeywords: ["combo", "platter", "family pack", "bundle", "special"],
  },
];

export const CANONICAL_CATEGORIES: { key: string; label: string }[] = SEED.map((s) => ({ key: s.key, label: s.label }));
const CANONICAL_KEYS = new Set(SEED.map((s) => s.key));

/** Whether a tag is one of the curated canonical categories (vs a provisional fallback). */
export function isCanonicalTag(tag: string): boolean {
  return CANONICAL_KEYS.has(tag);
}

// Word-boundary containment (handles multi-word needles + punctuation safely).
function containsWord(haystack: string, needle: string): boolean {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(haystack);
}

/**
 * Derive canonical taxonomy tags for a dish. Applies category-synonym AND
 * dish-name-keyword matching (multi-tag), deduped and in stable seed order.
 * Falls back to the normalized category label when nothing matches.
 */
export function deriveTaxonomyTags(rawCategory: string | null | undefined, name: string | null | undefined): string[] {
  const cat = normalizeCategoryKey(rawCategory);
  const nm = (name ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  const tags = new Set<string>();

  for (const entry of SEED) {
    if (cat && entry.categorySynonyms.some((syn) => cat === syn || containsWord(cat, syn))) {
      tags.add(entry.key);
      continue; // already tagged by category; name check is redundant for this entry
    }
    if (nm && entry.nameKeywords.some((kw) => containsWord(nm, kw))) {
      tags.add(entry.key);
    }
  }

  if (tags.size === 0) {
    return cat ? [cat] : []; // provisional fallback (Sprint-1 normalized key), non-destructive
  }
  return [...tags];
}
