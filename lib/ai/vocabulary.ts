/**
 * Business Vocabulary Layer
 * =========================
 * Maps the words restaurant staff actually use ("takings", "covers", "chow",
 * "best sellers", "counter") to internal RestoFlow entities, Firestore
 * collections, and the tools that answer questions about them.
 *
 * Why this exists: the Copilot must translate natural, colloquial (and
 * Nigeria-specific) restaurant language into the *typed tools* it is allowed to
 * call — without guessing collection names in a prompt. Keeping the glossary here
 * makes it auditable and reusable across every AI feature.
 *
 * Pure data + string matching — no runtime/server imports, safe to use anywhere.
 */

import type { ToolName } from "./tools";
import type { ToolCategory } from "./types";

export type EntityKey =
  | "revenue"
  | "order"
  | "menuItem"
  | "customer"
  | "staff"
  | "kitchen"
  | "inventory"
  | "loyalty"
  | "payment"
  | "service"
  | "business"
  | "settings";

export interface VocabularyEntry {
  entity: EntityKey;
  /** The canonical internal term. */
  canonical: string;
  /** Plain-language definition for grounding an LLM or a help tooltip. */
  meaning: string;
  /** Colloquial / regional / abbreviated synonyms (lowercased, matched loosely). */
  synonyms: string[];
  /** Internal Firestore collections this entity maps to. */
  collections: string[];
  /** Tools that answer questions about this entity. */
  relatedTools: ToolName[];
  /** Registry category this entity aligns with. */
  category: ToolCategory;
}

export const VOCABULARY: VocabularyEntry[] = [
  {
    entity: "revenue",
    canonical: "revenue",
    meaning: "Money from paid, non-cancelled orders (in Naira). AOV = average order value.",
    synonyms: ["sales", "takings", "turnover", "income", "gross", "gmv", "aov", "average order value", "earnings", "money made", "how much did i make"],
    collections: ["orders"],
    relatedTools: ["getRevenueSummary", "getSalesByHour", "getRecentTransactions"],
    category: "sales",
  },
  {
    entity: "order",
    canonical: "order",
    meaning: "A customer's order/ticket, whether placed online, at the counter, or dine-in.",
    synonyms: ["orders", "ticket", "chit", "docket", "bill", "tab", "sale", "transaction", "chow order"],
    collections: ["orders", "pending_payments"],
    relatedTools: ["getTodayOrders", "getRecentTransactions", "getRevenueSummary"],
    category: "orders",
  },
  {
    entity: "menuItem",
    canonical: "menu item",
    meaning: "A dish or product on the menu. 'Best seller' = highest quantity sold; 'slow mover' = little/no sales.",
    synonyms: ["dish", "food", "meal", "product", "item", "menu", "best seller", "bestseller", "top item", "slow mover", "dead stock", "chow", "small chops", "swallow", "protein"],
    collections: ["menu_items", "prepared_items"],
    relatedTools: ["getTopSellingItems", "getSlowMovingItems", "getMenuAnalytics"],
    category: "menu",
  },
  {
    entity: "customer",
    canonical: "customer",
    meaning: "A person who orders. Returning = ordered before; repeat rate = share who came back.",
    synonyms: ["customers", "guest", "diner", "patron", "client", "regulars", "repeat customer", "new customer", "customer base"],
    collections: ["orders", "restaurants/{slug}/loyalty_customers"],
    relatedTools: ["getCustomerOverview"],
    category: "customers",
  },
  {
    entity: "staff",
    canonical: "staff",
    meaning: "Employees (owner, manager, staff) and the orders they handled.",
    synonyms: ["employee", "worker", "team", "waiter", "waitress", "server", "cashier", "attendant", "workers"],
    collections: ["users", "waiters", "orders"],
    relatedTools: ["getStaffPerformance"],
    category: "staff",
  },
  {
    entity: "kitchen",
    canonical: "kitchen",
    meaning: "Food preparation speed — time from order received to preparing/ready.",
    synonyms: ["prep time", "preparation", "cooking time", "kitchen speed", "back of house", "bok", "turnaround", "how fast"],
    collections: ["orders"],
    relatedTools: ["getKitchenPerformance"],
    category: "kitchen",
  },
  {
    entity: "inventory",
    canonical: "inventory",
    meaning: "Item availability. NOTE: RestoFlow tracks availability (in/out), not stock quantities.",
    synonyms: ["stock", "supplies", "out of stock", "sold out", "availability", "in stock", "reorder", "restock", "ingredients"],
    collections: ["menu_items", "prepared_items"],
    relatedTools: ["getInventoryOverview"],
    category: "inventory",
  },
  {
    entity: "loyalty",
    canonical: "loyalty",
    meaning: "Punch-card loyalty program — ticks earned per order, rewards unlocked at a goal.",
    synonyms: ["rewards", "loyalty program", "punch card", "stamps", "points", "reward", "repeat rewards"],
    collections: ["restaurants/{slug}/loyalty_customers", "loyalty_ticks"],
    relatedTools: ["getCustomerOverview"],
    category: "customers",
  },
  {
    entity: "payment",
    canonical: "payment",
    meaning: "How orders were paid: online (Paystack), cash, bank transfer, card, or unpaid/part-paid.",
    synonyms: ["payments", "paystack", "cash", "transfer", "bank transfer", "pos payment", "card", "unpaid", "part paid", "pay on delivery", "pod"],
    collections: ["orders", "payments"],
    relatedTools: ["getRevenueSummary", "getRecentTransactions"],
    category: "sales",
  },
  {
    entity: "service",
    canonical: "service mode",
    meaning: "Fulfilment channel: delivery, pickup, dine-in, or counter (POS).",
    synonyms: ["delivery", "pickup", "takeaway", "take away", "dine in", "dine-in", "eat in", "covers", "counter", "pos", "walk in", "table service"],
    collections: ["orders"],
    relatedTools: ["getRevenueSummary", "getTodayOrders"],
    category: "orders",
  },
  {
    entity: "business",
    canonical: "business profile",
    meaning: "The restaurant's identity, open/closed status, enabled channels, and subscription.",
    synonyms: ["restaurant", "shop", "store", "profile", "opening hours", "open now", "subscription", "plan", "billing", "account status"],
    collections: ["restaurants"],
    relatedTools: ["getBusinessProfile"],
    category: "business",
  },
  {
    entity: "settings",
    canonical: "settings",
    meaning: "Operational configuration: delivery fee, minimum order, channels, payment methods, delivery zones.",
    synonyms: ["configuration", "config", "delivery fee", "minimum order", "min order", "delivery zones", "preferences", "options"],
    collections: ["restaurants"],
    relatedTools: ["getRestaurantSettings"],
    category: "settings",
  },
];

// Fast lookup index: synonym/canonical -> entry.
const INDEX = new Map<string, VocabularyEntry>();
for (const entry of VOCABULARY) {
  INDEX.set(entry.canonical.toLowerCase(), entry);
  INDEX.set(entry.entity.toLowerCase(), entry);
  for (const s of entry.synonyms) INDEX.set(s.toLowerCase(), entry);
}

function normalize(term: string): string {
  return term.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Resolve a single term/phrase to its vocabulary entry, or null if unknown. */
export function resolveTerm(term: string): VocabularyEntry | null {
  return INDEX.get(normalize(term)) ?? null;
}

/** Look up an entity by its canonical key. */
export function getEntity(entity: EntityKey): VocabularyEntry | undefined {
  return VOCABULARY.find((e) => e.entity === entity);
}

/**
 * Scan a free-text question and return the vocabulary entries whose canonical
 * term or synonyms appear in it (longest phrases first, de-duplicated by entity).
 * Powers "which tools should the Copilot consider for this question?".
 */
export function matchEntities(text: string): VocabularyEntry[] {
  const haystack = ` ${normalize(text)} `;
  const seen = new Set<EntityKey>();
  const matches: VocabularyEntry[] = [];

  // Match longer phrases before shorter ones so "average order value" wins over "order".
  const terms = [...INDEX.keys()].sort((a, b) => b.length - a.length);
  for (const term of terms) {
    if (haystack.includes(` ${term} `) || haystack.includes(` ${term}`) || haystack.includes(`${term} `)) {
      const entry = INDEX.get(term)!;
      if (!seen.has(entry.entity)) {
        seen.add(entry.entity);
        matches.push(entry);
      }
    }
  }
  return matches;
}

/** Suggest the tools most relevant to a free-text question, de-duplicated. */
export function suggestTools(text: string): ToolName[] {
  const tools: ToolName[] = [];
  const seen = new Set<string>();
  for (const entry of matchEntities(text)) {
    for (const t of entry.relatedTools) {
      if (!seen.has(t)) {
        seen.add(t);
        tools.push(t);
      }
    }
  }
  return tools;
}

/** The full glossary, for a help surface or LLM grounding block. */
export function glossary(): { term: string; entity: EntityKey; meaning: string }[] {
  return VOCABULARY.map((e) => ({ term: e.canonical, entity: e.entity, meaning: e.meaning }));
}
