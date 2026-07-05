import "server-only";
import { buildRestaurantContext, type RestaurantContext } from "./context";
import { runDecisionEngine, confidenceToLevel } from "./decision-engine";
import { writeUsageRecord } from "./usage";
import { assertTenant } from "./guardrails";
import { createIntelligenceContext, lagosDateKey } from "./tools/_shared";
import type {
  Insight,
  RangeLabel,
  Recommendation,
  RecommendationAction,
  RecommendationStatus,
  RecommendationType,
  ToolCategory,
} from "./types";

/**
 * Recommendations Engine
 * ======================
 * Turns the intelligence foundation's insights into SPECIFIC, ACTIONABLE
 * recommendations with concrete parameters ("raise Jollof Rice by ₦200",
 * "add staff 12–2pm", "bundle X with Y", "re-enable Z").
 *
 * Consistent with the whole system: the DECISION is deterministic and auditable
 * (rules in code, not a prompt), grounded ONLY in the tool layer / context
 * builder. Each recommendation carries a structured `action` so the future
 * Automation phase can execute an APPROVED recommendation without re-parsing prose.
 *
 * Writes ONLY to `ai_recommendations` (the recs + their accept/dismiss status) and
 * `ai_usage` (accounting). Never a core collection. Tenant-scoped, read-only over
 * business data.
 */

export const AI_RECOMMENDATIONS_COLLECTION = "ai_recommendations";
const REC_VERSION = 1;
const DEFAULT_WINDOW: RangeLabel = "week";

/** Statuses that are shown to the owner as an active recommendation. */
const ACTIVE_STATUSES: RecommendationStatus[] = ["new", "accepted", "snoozed"];

export interface GenerateRecommendationsOptions {
  now?: () => Date;
  db?: FirebaseFirestore.Firestore;
  window?: RangeLabel;
  /** Regenerate even if today's set already exists. */
  force?: boolean;
  requestId?: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Generate (or return today's cached) recommendation set for a restaurant. */
export async function generateRecommendations(
  slug: string,
  opts: GenerateRecommendationsOptions = {}
): Promise<Recommendation[]> {
  const ctx = createIntelligenceContext(slug, { feature: "recommendations", now: opts.now, db: opts.db, requestId: opts.requestId });
  const dateKey = lagosDateKey(ctx.now());
  const window = opts.window ?? DEFAULT_WINDOW;
  const col = ctx.db.collection(AI_RECOMMENDATIONS_COLLECTION);

  // Load existing recs for this tenant (to preserve accept/dismiss status & expire stale ones).
  const existingSnap = await col.where("restaurantId", "==", slug).get();
  const existing = new Map<string, Recommendation>();
  for (const d of existingSnap.docs) {
    const r = d.data() as Recommendation;
    assertTenant(ctx.scope, r as unknown as Record<string, unknown>);
    existing.set(r.id, r);
  }

  // Cost control: today's set already exists and no refresh requested → return it.
  if (!opts.force) {
    const todays = [...existing.values()].filter((r) => r.dateKey === dateKey && r.status !== "expired");
    if (todays.length > 0) return sortRecs(todays.filter((r) => ACTIVE_STATUSES.includes(r.status)));
  }

  // Ground in the tool layer + decision engine.
  const context = await buildRestaurantContext(ctx, { range: { range: window } });
  const report = runDecisionEngine(context);

  const timeWindow = { label: window, from: context.range.from, to: context.range.to };
  const isoNow = ctx.now().toISOString();
  const candidates = buildCandidates(context, report.insights);
  const candidateIds = new Set(candidates.map((c) => c.id));

  const out: Recommendation[] = [];
  for (const c of candidates) {
    const prev = existing.get(c.id);
    // Preserve an owner decision (accepted/dismissed/snoozed); otherwise it's new.
    const status: RecommendationStatus = prev && prev.status !== "new" && prev.status !== "expired" ? prev.status : "new";
    const rec: Recommendation = {
      id: c.id,
      restaurantId: slug,
      dateKey,
      type: c.type,
      category: c.category,
      title: c.title,
      rationale: c.rationale,
      expectedImpact: c.expectedImpact,
      action: c.action,
      confidence: c.confidence,
      confidenceLevel: confidenceToLevel(c.confidence),
      priority: c.priority,
      status,
      timeWindow,
      generatedAt: isoNow,
      updatedAt: isoNow,
      source: "deterministic",
      version: REC_VERSION,
    };
    await col.doc(`${slug}:${c.id}`).set(rec);
    out.push(rec);
  }

  // Expire previously-"new" recs that no longer apply (keep accepted/dismissed/snoozed).
  for (const r of existing.values()) {
    if (r.status === "new" && !candidateIds.has(r.id)) {
      await col.doc(`${slug}:${r.id}`).set({ status: "expired", updatedAt: isoNow }, { merge: true });
    }
  }

  await writeUsageRecord(ctx, { status: "ok", note: `recommendations dateKey=${dateKey} count=${out.length} force=${!!opts.force}` });

  return sortRecs(out.filter((r) => ACTIVE_STATUSES.includes(r.status)));
}

/** List the active recommendations for a restaurant (default: not dismissed/expired). */
export async function listRecommendations(
  slug: string,
  opts: { db?: FirebaseFirestore.Firestore; now?: () => Date; includeDismissed?: boolean } = {}
): Promise<Recommendation[]> {
  const ctx = createIntelligenceContext(slug, { feature: "recommendations-read", now: opts.now, db: opts.db });
  const snap = await ctx.db.collection(AI_RECOMMENDATIONS_COLLECTION).where("restaurantId", "==", slug).get();
  const recs = snap.docs.map((d) => d.data() as Recommendation).filter((r) => {
    assertTenant(ctx.scope, r as unknown as Record<string, unknown>);
    return opts.includeDismissed ? r.status !== "expired" : ACTIVE_STATUSES.includes(r.status);
  });
  return sortRecs(recs);
}

/** Update a recommendation's status (accept / dismiss / snooze). Writes ai_recommendations only. */
export async function updateRecommendationStatus(
  slug: string,
  recId: string,
  status: RecommendationStatus,
  opts: { db?: FirebaseFirestore.Firestore; now?: () => Date } = {}
): Promise<Recommendation | null> {
  const ctx = createIntelligenceContext(slug, { feature: "recommendations-update", now: opts.now, db: opts.db });
  const ref = ctx.db.collection(AI_RECOMMENDATIONS_COLLECTION).doc(`${slug}:${recId}`);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const rec = snap.data() as Recommendation;
  assertTenant(ctx.scope, rec as unknown as Record<string, unknown>); // never mutate another tenant's rec

  const updatedAt = ctx.now().toISOString();
  await ref.set({ status, updatedAt }, { merge: true });
  return { ...rec, status, updatedAt };
}

// ---------------------------------------------------------------------------
// Deterministic recommendation rules
// ---------------------------------------------------------------------------

interface RecCandidate {
  id: string;
  type: RecommendationType;
  category: ToolCategory;
  title: string;
  rationale: string;
  expectedImpact: string;
  action: RecommendationAction;
  confidence: number;
  priority: number;
}

const PRICE_UPLIFT = 0.08; // suggest ~8% increase on high-demand items
const MIN_QTY_FOR_PRICING = 8;
const LOW_CANCELLATION = 0.1;
const PEAK_SHARE_THRESHOLD = 0.22; // a window holding ≥22% of orders is a clear peak
const LOW_REPEAT = 0.25;

function buildCandidates(context: RestaurantContext, insights: Insight[]): RecCandidate[] {
  const out: RecCandidate[] = [];
  for (const rule of RULES) {
    try {
      out.push(...rule(context, insights));
    } catch {
      /* a single rule must never break the set */
    }
  }
  return out;
}

type Rule = (c: RestaurantContext, insights: Insight[]) => RecCandidate[];

const priceIncreaseRule: Rule = (c) => {
  const s = c.sales.summary;
  const items = c.menu.topItems?.items ?? [];
  if (!s || items.length === 0 || s.cancellationRate >= LOW_CANCELLATION) return [];
  const out: RecCandidate[] = [];
  for (const item of items.slice(0, 2)) {
    if (item.quantity < MIN_QTY_FOR_PRICING || item.revenue <= 0) continue;
    const avgPrice = Math.round(item.revenue / item.quantity);
    if (avgPrice <= 0) continue;
    const delta = Math.max(50, roundTo(avgPrice * PRICE_UPLIFT, 50));
    const suggestedPrice = avgPrice + delta;
    const confidence = scoreConf(clamp(item.quantity / 40, 0, 1), item.quantity, 20);
    out.push({
      id: `price_increase:${slugify(item.name)}`,
      type: "price_increase",
      category: "menu",
      title: `Increase the price of ${item.name} by ${naira(delta)}`,
      rationale: `${item.name} sold ${item.quantity} units this ${c.range.label} with only ${pct(s.cancellationRate)} cancellations — strong, reliable demand gives you room to raise the price from ${naira(avgPrice)} to ${naira(suggestedPrice)}.`,
      expectedImpact: `About ${naira(delta * item.quantity)} more revenue per ${c.range.label} at the same volume.`,
      action: { kind: "price_increase", target: item.name, currentPrice: avgPrice, suggestedPrice, delta },
      confidence,
      priority: 80 + Math.round(confidence * 10),
    });
  }
  return out;
};

const staffingRule: Rule = (c) => {
  const h = c.sales.byHour;
  if (!h || h.peakHour == null) return [];
  const total = h.hours.reduce((sum, b) => sum + b.orders, 0);
  if (total < 10) return [];
  const peak = h.peakHour;
  // 2-hour window starting at the peak hour.
  const windowOrders = (h.hours[peak]?.orders ?? 0) + (h.hours[(peak + 1) % 24]?.orders ?? 0);
  const share = windowOrders / total;
  if (share < PEAK_SHARE_THRESHOLD) return [];

  const slowKitchen = c.reports.kitchen?.avgReadyMinutes != null && c.reports.kitchen.avgReadyMinutes > 25;
  const confidence = scoreConf(clamp(share / 0.5, 0, 1), total, 30);
  return [
    {
      id: `staffing:${pad(peak)}`,
      type: "staffing",
      category: "staff",
      title: `Add prep/kitchen staff between ${fmtHour(peak)} and ${fmtHour(peak + 2)}`,
      rationale: `${pct(share)} of your orders land between ${fmtHour(peak)} and ${fmtHour(peak + 2)} — your busiest window${slowKitchen ? `, and prep time is already averaging ${c.reports.kitchen!.avgReadyMinutes} min` : ""}.`,
      expectedImpact: `Faster service and fewer delays during your peak.`,
      action: { kind: "staffing", window: `${pad(peak)}:00-${pad((peak + 2) % 24)}:00` },
      confidence,
      priority: 70 + Math.round(confidence * 10),
    },
  ];
};

const bundleRule: Rule = (c) => {
  const never = c.menu.slowItems?.neverSold ?? [];
  const top = c.menu.topItems?.items?.[0];
  if (never.length === 0 || !top || top.quantity <= 0) return [];
  const slow = never[0];
  return [
    {
      id: `bundle:${slugify(slow)}`,
      type: "bundle",
      category: "menu",
      title: `Bundle ${slow} with ${top.name}`,
      rationale: `${slow} had no sales this ${c.range.label}, while ${top.name} is your best seller — pairing them in a combo can move the slow item.`,
      expectedImpact: `Shift slow inventory and lift average order value.`,
      action: { kind: "bundle", target: slow, pairWith: top.name },
      confidence: 0.6,
      priority: 55,
    },
  ];
};

const reenableRule: Rule = (c) => {
  const outOfStock = c.inventory?.outOfStock ?? [];
  return outOfStock.slice(0, 2).map((it) => ({
    id: `reenable_item:${slugify(it.name)}`,
    type: "reenable_item" as const,
    category: "inventory" as const,
    title: `Restock and re-enable ${it.name}`,
    rationale: `${it.name} is marked unavailable, so customers can't order it right now.`,
    expectedImpact: `Recover the sales you're currently turning away.`,
    action: { kind: "reenable_item" as const, target: it.name },
    confidence: 0.9,
    priority: 90,
  }));
};

const promoteRule: Rule = (c) => {
  const low = (c.menu.slowItems?.items ?? []).filter((i) => i.quantity > 0);
  if (low.length === 0) return [];
  const item = low[0];
  return [
    {
      id: `promote_item:${slugify(item.name)}`,
      type: "promote_item",
      category: "menu",
      title: `Promote or discount ${item.name}`,
      rationale: `${item.name} had only ${item.quantity} sale${item.quantity === 1 ? "" : "s"} this ${c.range.label} despite being available.`,
      expectedImpact: `Stimulate demand for an underperforming item.`,
      action: { kind: "promote_item", target: item.name },
      confidence: 0.5,
      priority: 45,
    },
  ];
};

const loyaltyRule: Rule = (c) => {
  const cu = c.customers;
  if (!cu || cu.totalCustomers < 10) return [];
  if (cu.repeatRate >= LOW_REPEAT || cu.loyalty?.enabled) return [];
  const confidence = scoreConf(clamp((LOW_REPEAT - cu.repeatRate) / LOW_REPEAT, 0, 1), cu.totalCustomers, 30);
  return [
    {
      id: `loyalty:program`,
      type: "loyalty",
      category: "customers",
      title: `Turn on loyalty rewards to win repeat customers`,
      rationale: `Only ${pct(cu.repeatRate)} of customers returned this ${c.range.label} and no loyalty program is active.`,
      expectedImpact: `Convert first-time buyers into regulars.`,
      action: { kind: "loyalty" },
      confidence,
      priority: 60 + Math.round(confidence * 10),
    },
  ];
};

const RULES: Rule[] = [reenableRule, priceIncreaseRule, staffingRule, loyaltyRule, bundleRule, promoteRule];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sortRecs(recs: Recommendation[]): Recommendation[] {
  return [...recs].sort((a, b) => (b.priority - a.priority) || (b.confidence - a.confidence));
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
function scoreConf(strength: number, sample: number, needed: number): number {
  const adequacy = clamp(sample / Math.max(1, needed), 0, 1);
  return Math.round(clamp((0.55 + 0.4 * clamp(strength, 0, 1)) * (0.6 + 0.4 * adequacy), 0, 0.98) * 100) / 100;
}
function roundTo(n: number, step: number): number {
  return Math.round(n / step) * step;
}
function naira(n: number): string {
  return `₦${Math.round(n).toLocaleString("en-NG")}`;
}
function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}
function pad(h: number): string {
  return String(((h % 24) + 24) % 24).padStart(2, "0");
}
function fmtHour(hour: number): string {
  const h24 = ((hour % 24) + 24) % 24;
  const h = ((h24 + 11) % 12) + 1;
  return `${h}${h24 < 12 ? "am" : "pm"}`;
}
function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "item";
}
