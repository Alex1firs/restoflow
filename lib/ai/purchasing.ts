import "server-only";
import { generateForecast, getForecast } from "./forecasting";
import { generateRecommendations } from "./recommendations";
import { writeUsageRecord } from "./usage";
import { assertTenant } from "./guardrails";
import { confidenceToLevel } from "./decision-engine";
import { createIntelligenceContext, lagosDateKey } from "./tools/_shared";
import type {
  Forecast,
  IngredientDemand,
  IngredientPurchaseLine,
  MenuItemDemand,
  MenuPurchaseLine,
  PurchasingPlan,
  Recommendation,
  ReorderSignal,
} from "./types";

/**
 * Smart Purchasing
 * ================
 * Converts forecasted demand into a concrete PURCHASING & PREPARATION plan —
 * completing the operational loop:
 *
 *   what happened (Brief) → what to do (Recommendations) → what's next (Forecast)
 *     → what to buy & prep (Smart Purchasing) → execute (Automation)
 *
 * Architecture (the extension point the PO asked for):
 *
 *   Menu Item Demand ──▶ [RecipeResolver?] ──▶ Demand Translator ──▶ Purchasing Plan
 *                          (future Recipe Engine)   (STABLE)
 *
 * TODAY the RecipeResolver is absent, so `ingredientDemand` is undefined and the
 * plan is menu-item granular (prep batches, reorder signals, peak-production
 * timing) — valuable with ZERO owner setup. LATER, a Recipe Engine implements
 * `RecipeResolver` (menu demand → bill-of-materials → ingredient demand) and is
 * injected BELOW the translator. Nothing above the translator changes: not the
 * Forecasting/Recommendation/Decision/Context layers, not this public API, not the
 * output shape — `ingredientDemand` simply becomes populated.
 *
 * Deterministic (no LLM), tenant-scoped, business data read-only. Consumes the
 * Forecasting + Recommendation Engines (no duplicated business logic). Writes ONLY
 * to `ai_purchase_plans` + `ai_usage`.
 */

export const AI_PURCHASE_PLANS_COLLECTION = "ai_purchase_plans";
const PLAN_VERSION = 1;
/** Assumed prep batch size (units) when none is defined per item — a heuristic. */
const BATCH_UNITS = 12;

export interface GeneratePurchasingPlanOptions {
  now?: () => Date;
  db?: FirebaseFirestore.Firestore;
  /** Regenerate even if today's plan already exists. */
  force?: boolean;
  requestId?: string;
  /**
   * The future Recipe Engine seam. When provided, its ingredient demand is fed
   * into the SAME translator to produce ingredient-level purchase lines. Absent
   * today → menu-item plan only. This is the ONLY thing a future phase adds.
   */
  recipeResolver?: RecipeResolver;
}

// ---------------------------------------------------------------------------
// Extension seam — the future Recipe Engine plugs in HERE, below the translator.
// ---------------------------------------------------------------------------

export interface RecipeResolver {
  readonly id: string;
  /** Translate menu-item demand into ingredient demand via a bill-of-materials. */
  resolve(menuDemand: MenuItemDemand[]): IngredientDemand[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Generate (or return today's cached) purchasing plan for a restaurant. */
export async function generatePurchasingPlan(
  slug: string,
  opts: GeneratePurchasingPlanOptions = {}
): Promise<PurchasingPlan> {
  const ctx = createIntelligenceContext(slug, {
    feature: "purchasing",
    now: opts.now,
    db: opts.db,
    requestId: opts.requestId,
  });
  const dateKey = lagosDateKey(ctx.now());
  const ref = ctx.db.collection(AI_PURCHASE_PLANS_COLLECTION).doc(`${slug}:${dateKey}`);

  // Cost control: today's plan already exists and no refresh requested → return it.
  if (!opts.force) {
    const existing = await ref.get();
    if (existing.exists) {
      const p = existing.data() as PurchasingPlan;
      assertTenant(ctx.scope, p as unknown as Record<string, unknown>);
      return p;
    }
  }

  // ── Consume the Forecasting Engine (the demand source) ───────────────────
  // Reuse today's forecast if present; only compute one if it's missing.
  let forecast = await getForecast(slug, { db: ctx.db, now: opts.now });
  if (!forecast) forecast = await generateForecast(slug, { db: ctx.db, now: opts.now });

  // ── Consume the Recommendation Engine (restock / promo signals) ──────────
  // Cost-controlled: returns today's cached set if present, else generates it once.
  const recommendations = await generateRecommendations(slug, { db: ctx.db, now: opts.now });

  const menuDemand = buildMenuDemand(forecast, recommendations);

  // ── Optional Recipe Engine (future) → ingredient demand ──────────────────
  const ingredientDemand = opts.recipeResolver ? opts.recipeResolver.resolve(menuDemand) : undefined;

  // ── The STABLE Demand Translator → purchasing plan ───────────────────────
  const peakWindow = forecast.peakWindows[0]?.window ?? null;
  const { menuLines, ingredientLines } = menuDemandTranslator.translate({
    menuDemand,
    peakWindow,
    ingredientDemand,
  });

  const highCount = menuLines.filter((l) => l.reorderSignal === "HIGH").length;
  const plan: PurchasingPlan = {
    restaurantId: slug,
    dateKey,
    horizonWindow: forecast.horizonWindow,
    method: "forecast-driven-menu-demand",
    menuDemand: menuLines,
    ...(ingredientLines && ingredientLines.length > 0 ? { ingredientDemand: ingredientLines } : {}),
    peakWindows: forecast.peakWindows,
    summary: buildSummary(menuLines.length, highCount),
    ingredientPlanningAvailable: !!ingredientLines && ingredientLines.length > 0,
    basedOnForecastAt: forecast.generatedAt,
    confidence: forecast.confidence,
    confidenceLevel: confidenceToLevel(forecast.confidence),
    degraded: forecast.degraded,
    source: "deterministic",
    version: PLAN_VERSION,
    generatedAt: ctx.now().toISOString(),
  };

  await ref.set(plan);
  await writeUsageRecord(ctx, {
    status: "ok",
    note: `purchasing dateKey=${dateKey} items=${menuLines.length} ingredient=${plan.ingredientPlanningAvailable} force=${!!opts.force}`,
  });

  return plan;
}

/** Read today's cached plan without generating one (NO computation). */
export async function getPurchasingPlan(
  slug: string,
  opts: { db?: FirebaseFirestore.Firestore; now?: () => Date } = {}
): Promise<PurchasingPlan | null> {
  const ctx = createIntelligenceContext(slug, { feature: "purchasing-read", now: opts.now, db: opts.db });
  const dateKey = lagosDateKey(ctx.now());
  const snap = await ctx.db.collection(AI_PURCHASE_PLANS_COLLECTION).doc(`${slug}:${dateKey}`).get();
  if (!snap.exists) return null;
  const p = snap.data() as PurchasingPlan;
  assertTenant(ctx.scope, p as unknown as Record<string, unknown>);
  return p;
}

// ---------------------------------------------------------------------------
// Demand assembly (from the forecast + recommendations — no duplicated logic)
// ---------------------------------------------------------------------------

function buildMenuDemand(forecast: Forecast, recommendations: Recommendation[]): MenuItemDemand[] {
  const active = recommendations.filter((r) => r.status !== "dismissed" && r.status !== "expired");
  const reenableTargets = new Map<string, string[]>(); // lower(name) → rec ids
  const promoteTargets = new Set<string>();
  for (const r of active) {
    const target = r.action?.target?.toLowerCase();
    if (!target) continue;
    if (r.type === "reenable_item") reenableTargets.set(target, [...(reenableTargets.get(target) ?? []), r.id]);
    if (r.type === "promote_item") promoteTargets.add(target);
  }

  const byName = new Map<string, MenuItemDemand>();
  for (const d of forecast.itemDemand) {
    const key = d.item.toLowerCase();
    byName.set(key, {
      item: d.item,
      expectedUnitsNext7: d.expectedUnitsNext7,
      expectedUnitsPerDay: d.expectedUnitsPerDay,
      trendPct: d.trendPct,
      relatedRecommendationIds: [...d.relatedRecommendationIds],
      unavailable: reenableTargets.has(key),
      promoted: promoteTargets.has(key),
    });
  }

  // Include unavailable items that need restocking even if they had no recent sales
  // (a `reenable_item` recommendation targets them) so they still appear on the plan.
  for (const [key, recIds] of reenableTargets) {
    if (byName.has(key)) continue;
    const rec = recommendations.find((r) => r.id === recIds[0]);
    byName.set(key, {
      item: rec?.action?.target ?? key,
      expectedUnitsNext7: 0,
      expectedUnitsPerDay: 0,
      trendPct: null,
      relatedRecommendationIds: recIds,
      unavailable: true,
      promoted: promoteTargets.has(key),
    });
  }

  return [...byName.values()];
}

// ---------------------------------------------------------------------------
// The Demand Translator (STABLE — nothing above this changes when recipes arrive)
// ---------------------------------------------------------------------------

export interface TranslatorInput {
  menuDemand: MenuItemDemand[];
  peakWindow: string | null;
  /** Supplied by a future Recipe Engine; absent today. */
  ingredientDemand?: IngredientDemand[];
}

export interface TranslatorOutput {
  menuLines: MenuPurchaseLine[];
  ingredientLines?: IngredientPurchaseLine[];
}

export interface DemandTranslator {
  readonly id: string;
  translate(input: TranslatorInput): TranslatorOutput;
}

/** The one translator implementation today. Emits ingredient lines iff given ingredient demand. */
export const menuDemandTranslator: DemandTranslator = {
  id: "menu-demand-v1",
  translate({ menuDemand, peakWindow, ingredientDemand }): TranslatorOutput {
    const maxUnits = Math.max(1, ...menuDemand.map((d) => d.expectedUnitsNext7));

    const menuLines: MenuPurchaseLine[] = menuDemand
      .map((d) => {
        const signal = reorderSignal(d, maxUnits);
        const batches = d.expectedUnitsPerDay <= 0 ? 0 : Math.max(1, Math.ceil(d.expectedUnitsPerDay / BATCH_UNITS));
        return {
          item: d.item,
          expectedUnits: d.expectedUnitsNext7,
          expectedUnitsPerDay: d.expectedUnitsPerDay,
          preparationBatches: batches,
          peakWindow: d.unavailable ? null : peakWindow,
          reorderSignal: signal,
          guidance: guidanceFor(d, batches, signal, peakWindow),
          trendPct: d.trendPct,
          relatedRecommendationIds: d.relatedRecommendationIds,
        };
      })
      .sort((a, b) => signalRank(b.reorderSignal) - signalRank(a.reorderSignal) || b.expectedUnits - a.expectedUnits);

    const ingredientLines = ingredientDemand?.map<IngredientPurchaseLine>((i) => {
      const onHand = i.onHand ?? null;
      const reorderQuantity = onHand == null ? null : Math.max(0, round2(i.requiredQuantity - onHand));
      const signal: ReorderSignal =
        reorderQuantity == null ? "MEDIUM" : reorderQuantity <= 0 ? "LOW" : reorderQuantity >= i.requiredQuantity * 0.5 ? "HIGH" : "MEDIUM";
      return {
        ingredient: i.ingredient,
        unit: i.unit,
        requiredQuantity: round2(i.requiredQuantity),
        onHand,
        reorderQuantity,
        supplier: i.supplier ?? null,
        reorderSignal: signal,
      };
    });

    return ingredientLines && ingredientLines.length > 0 ? { menuLines, ingredientLines } : { menuLines };
  },
};

// ---------------------------------------------------------------------------
// Deterministic signal + guidance
// ---------------------------------------------------------------------------

function reorderSignal(d: MenuItemDemand, maxUnits: number): ReorderSignal {
  if (d.unavailable) return "HIGH"; // losing sales right now — restock first
  let score = 0;
  const ratio = d.expectedUnitsNext7 / maxUnits;
  if (ratio >= 0.66) score += 2;
  else if (ratio >= 0.33) score += 1;
  if (d.trendPct != null) {
    if (d.trendPct >= 25) score += 2;
    else if (d.trendPct >= 10) score += 1;
    else if (d.trendPct <= -25) score -= 1;
  }
  if (score >= 3) return "HIGH";
  if (score >= 1) return "MEDIUM";
  return "LOW";
}

function guidanceFor(d: MenuItemDemand, batches: number, signal: ReorderSignal, peakWindow: string | null): string {
  if (d.unavailable) {
    return `Currently unavailable — restock and re-enable to recover lost sales.`;
  }
  const parts: string[] = [];
  parts.push(`Expect ~${d.expectedUnitsNext7} over 7 days (~${d.expectedUnitsPerDay}/day, ${batches} batch${batches === 1 ? "" : "es"}/day).`);
  if (peakWindow) parts.push(`Concentrate prep before the ${peakWindow} peak.`);
  if (d.trendPct != null && d.trendPct >= 10) parts.push(`Demand is trending up ${Math.round(d.trendPct)}% — order extra stock.`);
  else if (d.trendPct != null && d.trendPct <= -10) parts.push(`Demand is easing ${Math.abs(Math.round(d.trendPct))}% — avoid over-ordering.`);
  if (d.promoted) parts.push(`A promotion is planned — demand may exceed this.`);
  if (signal === "HIGH") parts.push(`Prioritise stock for this item.`);
  return parts.join(" ");
}

function buildSummary(itemCount: number, highCount: number): string {
  if (itemCount === 0) return `Not enough demand signal yet to build a purchasing plan.`;
  const head = `Prep & purchasing plan for ${itemCount} item${itemCount === 1 ? "" : "s"} over the next 7 days`;
  return highCount > 0
    ? `${head} — ${highCount} need${highCount === 1 ? "s" : ""} priority restocking.`
    : `${head}. Stock levels look steady.`;
}

function signalRank(s: ReorderSignal): number {
  return s === "HIGH" ? 3 : s === "MEDIUM" ? 2 : 1;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
