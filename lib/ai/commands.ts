/**
 * Command Layer — Intent + Target model
 * =====================================
 * Turns a free-text utterance ("open today's orders", "take me to orders",
 * "show orders") into ONE structured command:
 *
 *   { intent: "open", target: "orders" }
 *   { intent: "approve", target: "recommendations", id: 2 }
 *   { intent: "explain", target: "recommendations", id: 1 }
 *
 * Why a model instead of command→page string matching (the PO's directive):
 *  - Voice AND typed chat share one parser.
 *  - Many phrasings collapse to the same (intent, target).
 *  - Future surfaces (WhatsApp, phone) reuse it unchanged — only the target→route
 *    mapping is client-specific (see `webNavigation`).
 *  - New capabilities are new intents/targets, not more regexes scattered around.
 *
 * Pure + deterministic — no server-only, no Firestore, no LLM. Analysis questions
 * ("why did revenue drop?", "compare with last week", "worst-selling items") are
 * intentionally NOT commands: `parseCommand` returns null so they fall through to
 * the grounded, intent-routed Assistant.
 */

import type { RangeLabel } from "./types";

export type CommandIntent = "open" | "read" | "approve" | "reject" | "explain";

export type CommandTarget =
  // Pages
  | "orders"
  | "kitchen"
  | "menu"
  | "reports"
  | "staff"
  | "customers"
  | "inventory"
  | "profile"
  | "dashboard"
  // Dashboard AI sections
  | "recommendations"
  | "purchasing"
  | "forecast"
  | "automation"
  | "brief";

export interface Command {
  intent: CommandIntent;
  target: CommandTarget;
  /** 1-based ordinal, e.g. "recommendation two" → 2. */
  id?: number;
  timeframe?: RangeLabel;
  raw: string;
}

// Intent verb groups (checked in priority order — action verbs before plain "open").
const APPROVE_RE = /\b(approve|accept|apply|confirm|go ahead with|action)\b/;
const REJECT_RE = /\b(reject|decline|dismiss|discard|ignore|skip|remove)\b/;
const READ_RE = /\b(read|read out|play|say|recite|go through)\b/;
const EXPLAIN_RE = /\b(explain|why did you|reason for|justify|tell me about)\b/;
const OPEN_RE = /\b(open|show|view|display|see|go to|goto|take me to|navigate to|bring up|pull up|jump to|switch to|let me see)\b/;

// Target phrases, longest first so "smart purchasing" beats "purchasing", etc.
const TARGET_PATTERNS: { target: CommandTarget; re: RegExp }[] = [
  { target: "purchasing", re: /\b(smart purchasing|purchasing plan|purchase plan|purchasing|purchase order|restock plan|shopping list)\b/ },
  { target: "profile", re: /\b(operating profile|business profile|my profile|profile)\b/ },
  { target: "recommendations", re: /\b(recommendations?|recs?|suggestions?|advice)\b/ },
  { target: "automation", re: /\b(automations?|automation rules?)\b/ },
  { target: "forecast", re: /\b(forecast|projections?|predictions?)\b/ },
  { target: "brief", re: /\b(briefing|brief|rundown)\b/ },
  { target: "orders", re: /\b(today'?s orders|orders?|tickets?|order feed)\b/ },
  { target: "kitchen", re: /\b(kitchen|prep station|back of house)\b/ },
  { target: "reports", re: /\b(reports?|analytics)\b/ },
  { target: "staff", re: /\b(staff|employees?|team members?|waiters?)\b/ },
  { target: "customers", re: /\b(customers?|loyalty|regulars?)\b/ },
  { target: "inventory", re: /\b(inventory|stock levels?|availability)\b/ },
  { target: "menu", re: /\b(menu)\b/ },
  { target: "dashboard", re: /\b(dashboard|home screen|overview)\b/ },
];

const ORDINAL_WORDS: Record<string, number> = {
  one: 1, first: 1, two: 2, second: 2, three: 3, third: 3, four: 4, fourth: 4, five: 5, fifth: 5,
  six: 6, sixth: 6, seven: 7, seventh: 7, eight: 8, eighth: 8, nine: 9, ninth: 9, ten: 10, tenth: 10,
};

/** Extract a 1-based ordinal from "recommendation two" / "number 3" / "the first one". */
export function parseCommandOrdinal(text: string): number | undefined {
  const digit = text.match(/\b(?:number\s+|#)?(\d{1,2})\b/);
  if (digit) {
    const n = parseInt(digit[1], 10);
    if (n >= 1 && n <= 20) return n;
  }
  const word = text.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\b/);
  return word ? ORDINAL_WORDS[word[1]] : undefined;
}

function detectTarget(text: string): CommandTarget | null {
  for (const { target, re } of TARGET_PATTERNS) {
    if (re.test(text)) return target;
  }
  return null;
}

function normalize(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9#'\s]/g, " ").replace(/\s+/g, " ").trim()} `;
}

/**
 * Parse a free-text utterance into a structured Command, or null when it isn't a
 * navigation/action command (so the caller routes it to the Assistant as a question).
 */
export function parseCommand(text: string): Command | null {
  const raw = text.trim();
  const t = normalize(raw);
  const target = detectTarget(t);

  // --- Actions on a recommendation (approval-first is enforced downstream) ---
  const looksRecommendation = target === "recommendations" || /\brecommendation/.test(t);
  if (APPROVE_RE.test(t) && looksRecommendation) {
    return { intent: "approve", target: "recommendations", id: parseCommandOrdinal(t), raw };
  }
  if (REJECT_RE.test(t) && looksRecommendation) {
    return { intent: "reject", target: "recommendations", id: parseCommandOrdinal(t), raw };
  }
  // "explain recommendation one" — read that recommendation's explanation (read-only).
  if (EXPLAIN_RE.test(t) && looksRecommendation) {
    return { intent: "explain", target: "recommendations", id: parseCommandOrdinal(t), raw };
  }

  // --- Read something aloud (only genuinely readable targets) ---
  if (READ_RE.test(t) && target && (target === "brief" || target === "recommendations" || target === "purchasing")) {
    return { intent: "read", target, raw };
  }

  // --- Navigation ---
  if (target && OPEN_RE.test(t)) {
    return { intent: "open", target, raw };
  }
  // A bare target with an unmistakable "go there" shape but no verb, e.g. "orders page".
  if (target && /\b(page|screen|section|tab)\b/.test(t)) {
    return { intent: "open", target, raw };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Web navigation mapping (client-specific; other surfaces provide their own)
// ---------------------------------------------------------------------------

export interface NavTarget {
  target: CommandTarget;
  path: string;
  label: string;
  /** DOM anchor for a dashboard AI section, so the client can scroll to it. */
  anchor?: string;
}

const WEB_NAV: Record<CommandTarget, { seg: string; label: string; anchor?: string }> = {
  orders: { seg: "orders", label: "today's orders" },
  kitchen: { seg: "kitchen", label: "the kitchen" },
  menu: { seg: "menu", label: "the menu" },
  reports: { seg: "reports", label: "reports" },
  staff: { seg: "staff", label: "staff performance" },
  customers: { seg: "loyalty", label: "customers" },
  inventory: { seg: "menu", label: "inventory availability" },
  profile: { seg: "operating-profile", label: "your operating profile" },
  dashboard: { seg: "dashboard", label: "the dashboard" },
  // AI sections live on the dashboard; anchor lets the client scroll to the card.
  recommendations: { seg: "dashboard", label: "your recommendations", anchor: "ai-recommendations" },
  purchasing: { seg: "dashboard", label: "Smart Purchasing", anchor: "ai-purchasing" },
  forecast: { seg: "dashboard", label: "the forecast", anchor: "ai-forecast" },
  automation: { seg: "dashboard", label: "automation", anchor: "ai-automation" },
  brief: { seg: "dashboard", label: "your daily brief", anchor: "ai-brief" },
};

/** Resolve a target to a web route for a given tenant. */
export function webNavigation(target: CommandTarget, slug: string): NavTarget {
  const n = WEB_NAV[target];
  return { target, path: `/admin/${slug}/${n.seg}`, label: n.label, anchor: n.anchor };
}

/** A short human/spoken description of a parsed command. */
export function describeCommand(cmd: Command): string {
  const label = WEB_NAV[cmd.target]?.label ?? cmd.target;
  switch (cmd.intent) {
    case "open": return `Opening ${label}.`;
    case "read": return `Reading ${label}.`;
    case "approve": return `Approving recommendation${cmd.id ? ` ${cmd.id}` : ""}.`;
    case "reject": return `Dismissing recommendation${cmd.id ? ` ${cmd.id}` : ""}.`;
    case "explain": return `Explaining recommendation${cmd.id ? ` ${cmd.id}` : ""}.`;
  }
}
