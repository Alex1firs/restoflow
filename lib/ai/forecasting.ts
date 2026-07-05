import "server-only";
import { buildRestaurantContext, type RestaurantContext } from "./context";
import { runDecisionEngine, confidenceToLevel } from "./decision-engine";
import { listRecommendations } from "./recommendations";
import { writeUsageRecord } from "./usage";
import { assertTenant } from "./guardrails";
import {
  createIntelligenceContext,
  isRevenueOrder,
  lagosDateKey,
} from "./tools/_shared";
import type {
  Forecast,
  ForecastDriver,
  ForecastPoint,
  Insight,
  ItemDemandForecast,
  NormalizedOrder,
  PeakWindowForecast,
  RangeLabel,
  Recommendation,
} from "./types";

/**
 * Forecasting Engine
 * ==================
 * Answers "what will happen next?" — and crucially, WHY — with confidence scores.
 *
 * It does NOT re-implement any business logic. It CONSUMES the existing layers:
 *   • Restaurant Context   (`buildRestaurantContext`) — current state, top items,
 *                           sales-by-hour, revenue summary.
 *   • Decision Engine      (`runDecisionEngine`)       — trend/anomaly insights,
 *                           which become the forecast's "why" drivers.
 *   • Recommendation Engine(`listRecommendations`)     — active recommendations are
 *                           linked to the item demand they will affect, so forecasts
 *                           and planned actions stay coherent.
 *
 * The only genuinely new computation here is the statistical projection
 * (trailing average + week-over-week trend + variance + day-of-week seasonality)
 * over the historical daily series. The revenue-recognition rule (`isRevenueOrder`)
 * and order normalisation are reused from the tool layer — not duplicated.
 *
 * Output is deliberately STRUCTURED so downstream phases can consume it directly:
 *   • Smart Purchasing → `itemDemand[].expectedUnitsNext7` (how much to buy/prep).
 *   • Automation       → `peakWindows[]` (staffing) and `revenue`/`orders` points.
 *
 * Writes ONLY to `ai_forecasts` (the forecast) and `ai_usage` (accounting). Never a
 * core collection. Tenant-scoped, read-only over business data, deterministic.
 */

export const AI_FORECASTS_COLLECTION = "ai_forecasts";
const FORECAST_VERSION = 1;
/** Trailing history window used to fit the projection. */
const HISTORY_DAYS = 28;
/** Reporting window handed to the shared context (top items, by-hour, etc.). */
const CONTEXT_WINDOW: RangeLabel = "week";
const DAY_MS = 86_400_000;

export interface GenerateForecastOptions {
  now?: () => Date;
  db?: FirebaseFirestore.Firestore;
  /** Regenerate even if today's forecast already exists. */
  force?: boolean;
  requestId?: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Generate (or return today's cached) forecast for a restaurant. */
export async function generateForecast(
  slug: string,
  opts: GenerateForecastOptions = {}
): Promise<Forecast> {
  const ctx = createIntelligenceContext(slug, {
    feature: "forecast",
    now: opts.now,
    db: opts.db,
    requestId: opts.requestId,
  });
  const now = ctx.now();
  const dateKey = lagosDateKey(now);
  const ref = ctx.db.collection(AI_FORECASTS_COLLECTION).doc(`${slug}:${dateKey}`);

  // Cost control: today's forecast already exists and no refresh requested → return it.
  if (!opts.force) {
    const existing = await ref.get();
    if (existing.exists) {
      const f = existing.data() as Forecast;
      assertTenant(ctx.scope, f as unknown as Record<string, unknown>);
      return f;
    }
  }

  // ── Consume the existing layers (no duplicated logic) ────────────────────
  const context = await buildRestaurantContext(ctx, { range: { range: CONTEXT_WINDOW } });
  const report = runDecisionEngine(context);
  const recommendations = await listRecommendations(slug, { db: ctx.db, now: opts.now });

  // Historical daily series — the ONLY new computation, over the shared order reader.
  const from = new Date(now.getTime() - HISTORY_DAYS * DAY_MS);
  const orders = await ctx.getOrders(from, now);
  const history = buildDailySeries(orders, now);

  const revenueStats = windowStats(history.days.map((d) => d.revenue));
  const ordersStats = windowStats(history.days.map((d) => d.orders));

  const daysOfHistory = history.days.length;
  const confidence = overallConfidence(daysOfHistory, revenueStats.cv);
  const degraded = context.meta.degraded || daysOfHistory < 3;

  const revenuePoint = projectPoint("revenue", "NGN", revenueStats, confidence, 100);
  const ordersPoint = projectPoint("orders", "orders", ordersStats, confidence, 1);

  const itemDemand = projectItemDemand(context, ordersStats.trendPct, recommendations);
  const peakWindows = projectPeakWindows(context);
  const drivers = buildDrivers(context, report.insights, recommendations, {
    dailyAvgRevenue: revenueStats.mean,
    revenueTrendPct: revenueStats.trendPct,
    daysOfHistory,
    strongestWeekday: history.strongestWeekday,
  });

  const horizonFrom = new Date(now.getTime() + DAY_MS);
  const horizonTo = new Date(now.getTime() + 8 * DAY_MS);

  const forecast: Forecast = {
    restaurantId: slug,
    dateKey,
    horizonWindow: { from: horizonFrom.toISOString(), to: horizonTo.toISOString() },
    method: "deterministic-trend-seasonality",
    basis: {
      daysOfHistory,
      dailyAvgRevenue: round2(revenueStats.mean),
      dailyAvgOrders: round2(ordersStats.mean),
      trendPct: revenueStats.trendPct == null ? null : round2(revenueStats.trendPct * 100),
      volatility: round2(revenueStats.cv),
    },
    revenue: revenuePoint,
    orders: ordersPoint,
    itemDemand,
    peakWindows,
    drivers,
    confidence,
    confidenceLevel: confidenceToLevel(confidence),
    degraded,
    source: "deterministic",
    version: FORECAST_VERSION,
    generatedAt: now.toISOString(),
  };

  await ref.set(forecast);
  await writeUsageRecord(ctx, {
    status: "ok",
    note: `forecast dateKey=${dateKey} days=${daysOfHistory} force=${!!opts.force}`,
  });

  return forecast;
}

/** Read today's cached forecast without generating one (NO computation). */
export async function getForecast(
  slug: string,
  opts: { db?: FirebaseFirestore.Firestore; now?: () => Date } = {}
): Promise<Forecast | null> {
  const ctx = createIntelligenceContext(slug, { feature: "forecast-read", now: opts.now, db: opts.db });
  const dateKey = lagosDateKey(ctx.now());
  const snap = await ctx.db.collection(AI_FORECASTS_COLLECTION).doc(`${slug}:${dateKey}`).get();
  if (!snap.exists) return null;
  const f = snap.data() as Forecast;
  assertTenant(ctx.scope, f as unknown as Record<string, unknown>);
  return f;
}

// ---------------------------------------------------------------------------
// Historical series (the only new computation — reuses isRevenueOrder)
// ---------------------------------------------------------------------------

interface DailyPoint {
  dateKey: string;
  orders: number;
  revenue: number;
}

interface DailySeries {
  /** Completed days, most-recent first (today's partial day excluded). */
  days: DailyPoint[];
  strongestWeekday: string | null;
}

/**
 * Bucket normalised orders into completed Lagos calendar days. Today is excluded
 * (partial). Internal zero-order days within the observed span are kept so the
 * average reflects real cadence; leading empty days (before the first order) are
 * not fabricated, so a brand-new restaurant isn't unfairly averaged against 28 days.
 */
function buildDailySeries(orders: NormalizedOrder[], now: Date): DailySeries {
  const byDay = new Map<string, { orders: number; revenue: number }>();
  for (const o of orders) {
    const key = lagosDateKey(o.createdAt);
    const bucket = byDay.get(key) ?? { orders: 0, revenue: 0 };
    bucket.orders += 1;
    if (isRevenueOrder(o)) bucket.revenue += o.total;
    byDay.set(key, bucket);
  }

  const todayKey = lagosDateKey(now);

  // Walk back from yesterday; find the furthest completed day that has data.
  let span = 0;
  for (let offset = 1; offset <= HISTORY_DAYS; offset++) {
    const key = lagosDateKey(new Date(now.getTime() - offset * DAY_MS));
    if (key === todayKey) continue;
    if (byDay.has(key)) span = offset;
  }

  const days: DailyPoint[] = [];
  const weekdayTotals = new Array(7).fill(0);
  const weekdayCounts = new Array(7).fill(0);
  for (let offset = 1; offset <= span; offset++) {
    const day = new Date(now.getTime() - offset * DAY_MS);
    const key = lagosDateKey(day);
    const bucket = byDay.get(key) ?? { orders: 0, revenue: 0 };
    days.push({ dateKey: key, orders: bucket.orders, revenue: bucket.revenue });
    const wd = weekdayIndex(key);
    weekdayTotals[wd] += bucket.revenue;
    weekdayCounts[wd] += 1;
  }

  return { days, strongestWeekday: strongestWeekday(weekdayTotals, weekdayCounts) };
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Weekday (0=Sun..6=Sat) for a YYYY-MM-DD Lagos day key (midday avoids TZ edge). */
function weekdayIndex(dateKey: string): number {
  return new Date(`${dateKey}T12:00:00+01:00`).getUTCDay();
}

function strongestWeekday(totals: number[], counts: number[]): string | null {
  let best = -1;
  let bestAvg = 0;
  let observed = 0;
  for (let i = 0; i < 7; i++) {
    if (counts[i] === 0) continue;
    observed++;
    const avg = totals[i] / counts[i];
    if (avg > bestAvg) {
      bestAvg = avg;
      best = i;
    }
  }
  // Need at least a few distinct weekdays before claiming seasonality.
  if (best < 0 || observed < 3 || bestAvg <= 0) return null;
  return WEEKDAYS[best];
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

interface Stats {
  mean: number;
  cv: number; // coefficient of variation (std / mean)
  recentAvg: number;
  trendPct: number | null; // recent half vs older half, as a fraction
}

/** Values are ordered most-recent first. */
function windowStats(values: number[]): Stats {
  const n = values.length;
  if (n === 0) return { mean: 0, cv: 0, recentAvg: 0, trendPct: null };
  const mean = avg(values);
  const variance = avg(values.map((v) => (v - mean) ** 2));
  const std = Math.sqrt(variance);
  const cv = mean > 0 ? std / mean : 0;

  const recentN = Math.min(7, n);
  const recentAvg = avg(values.slice(0, recentN));
  const older = values.slice(recentN, recentN * 2);
  const olderAvg = older.length ? avg(older) : null;
  const trendPct = olderAvg != null && olderAvg > 0 ? (recentAvg - olderAvg) / olderAvg : null;

  return { mean, cv, recentAvg, trendPct };
}

/** Dampened trend nudge, capped so we never wildly extrapolate. */
function trendAdjustment(trendPct: number | null): number {
  if (trendPct == null) return 0;
  return clamp(trendPct, -0.4, 0.4) * 0.3;
}

function projectPoint(
  metric: "revenue" | "orders",
  unit: "NGN" | "orders",
  stats: Stats,
  confidence: number,
  roundStep: number
): ForecastPoint {
  const baselineDaily = stats.recentAvg > 0 ? stats.recentAvg : stats.mean;
  const predictedDaily = baselineDaily * (1 + trendAdjustment(stats.trendPct));
  const predicted = roundTo(predictedDaily * 7, roundStep);
  const band = clamp(0.15 + stats.cv * 0.5, 0.15, 0.6);
  return {
    metric,
    horizon: "next_7_days",
    predicted,
    low: Math.max(0, roundTo(predicted * (1 - band), roundStep)),
    high: roundTo(predicted * (1 + band), roundStep),
    unit,
    confidence,
    confidenceLevel: confidenceToLevel(confidence),
  };
}

function projectItemDemand(
  context: RestaurantContext,
  ordersTrendPct: number | null,
  recommendations: Recommendation[]
): ItemDemandForecast[] {
  const items = context.menu.topItems?.items ?? [];
  const adj = 1 + trendAdjustment(ordersTrendPct);
  const trendPctOut = ordersTrendPct == null ? null : round2(ordersTrendPct * 100);

  return items.slice(0, 6).map((item) => {
    const weeklyUnits = item.quantity;
    const expectedNext7 = Math.max(0, Math.round(weeklyUnits * adj));
    const expectedPerDay = round2(expectedNext7 / 7);
    // Sample-size-aware confidence: more weekly units → tighter estimate.
    const conf = round2(clamp(0.4 + 0.5 * clamp(weeklyUnits / 40, 0, 1), 0, 0.95));

    const related = recommendations.filter(
      (r) => r.action?.target && r.action.target.toLowerCase() === item.name.toLowerCase()
    );
    return {
      item: item.name,
      expectedUnitsPerDay: expectedPerDay,
      expectedUnitsNext7: expectedNext7,
      trendPct: trendPctOut,
      confidence: conf,
      confidenceLevel: confidenceToLevel(conf),
      relatedRecommendationIds: related.map((r) => r.id),
      note: demandNote(related),
    };
  });
}

/** Explain how a linked recommendation is expected to move this item's demand. */
function demandNote(related: Recommendation[]): string | null {
  if (related.length === 0) return null;
  const r = related[0];
  switch (r.type) {
    case "price_increase":
      return "A price increase is recommended — demand may soften slightly, but revenue per unit rises.";
    case "promote_item":
      return "A promotion is recommended — demand may rise above this projection.";
    case "bundle":
      return "A bundle is recommended — demand may rise if paired with a best seller.";
    case "reenable_item":
      return "Item is currently unavailable — units will only materialise once it is re-enabled.";
    default:
      return "An active recommendation may change this item's demand.";
  }
}

function projectPeakWindows(context: RestaurantContext): PeakWindowForecast[] {
  const byHour = context.sales.byHour;
  if (!byHour || byHour.peakHour == null) return [];
  const total = byHour.hours.reduce((sum, h) => sum + h.orders, 0);
  if (total <= 0) return [];
  const peak = byHour.peakHour;
  const windowOrders = (byHour.hours[peak]?.orders ?? 0) + (byHour.hours[(peak + 1) % 24]?.orders ?? 0);
  return [
    {
      window: `${pad(peak)}:00-${pad((peak + 2) % 24)}:00`,
      expectedSharePct: round2((windowOrders / total) * 100),
    },
  ];
}

// ---------------------------------------------------------------------------
// Drivers — the "why" (sourced from the Decision Engine + Recommendation Engine)
// ---------------------------------------------------------------------------

function buildDrivers(
  _context: RestaurantContext,
  insights: Insight[],
  recommendations: Recommendation[],
  facts: { dailyAvgRevenue: number; revenueTrendPct: number | null; daysOfHistory: number; strongestWeekday: string | null }
): ForecastDriver[] {
  const drivers: ForecastDriver[] = [];

  drivers.push({
    type: "baseline",
    detail: facts.daysOfHistory > 0
      ? `Averaged ${naira(facts.dailyAvgRevenue)} per day over the last ${facts.daysOfHistory} completed day${facts.daysOfHistory === 1 ? "" : "s"}.`
      : `No completed sales history yet — projection is a low-confidence placeholder.`,
    value: round2(facts.dailyAvgRevenue),
  });

  if (facts.revenueTrendPct != null) {
    const dir = facts.revenueTrendPct >= 0 ? "up" : "down";
    drivers.push({
      type: "trend",
      detail: `Revenue is trending ${dir} ${Math.abs(Math.round(facts.revenueTrendPct * 100))}% versus the prior week.`,
      value: round2(facts.revenueTrendPct * 100),
    });
  } else if (facts.daysOfHistory > 0) {
    drivers.push({
      type: "trend",
      detail: "Not enough history to establish a reliable week-over-week trend yet.",
      value: null,
    });
  }

  if (facts.strongestWeekday) {
    drivers.push({
      type: "seasonality",
      detail: `${facts.strongestWeekday} is typically your strongest day — expect above-average sales then.`,
      value: facts.strongestWeekday,
    });
  }

  // The Decision Engine's trend/anomaly/warning insights ARE the forecast's "why".
  const relevant = insights
    .filter((i) => i.type === "trend" || i.type === "anomaly" || i.type === "warning")
    .slice(0, 3);
  for (const i of relevant) {
    drivers.push({ type: "insight", detail: i.reason, value: i.code });
  }

  const active = recommendations.filter((r) => r.status !== "dismissed" && r.status !== "expired");
  if (active.length > 0) {
    drivers.push({
      type: "recommendation",
      detail: `${active.length} active recommendation${active.length === 1 ? "" : "s"} could change these numbers (e.g. "${active[0].title}").`,
      value: active.length,
    });
  }

  return drivers;
}

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

function overallConfidence(daysOfHistory: number, cv: number): number {
  const dataFactor = clamp(daysOfHistory / 14, 0, 1); // ~2 weeks → full marks
  const stability = clamp(1 - cv, 0, 1); // steadier revenue → more confident
  return round2(clamp(0.3 + 0.4 * dataFactor + 0.3 * stability, 0, 0.95));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function roundTo(n: number, step: number): number {
  return Math.round(n / step) * step;
}
function naira(n: number): string {
  return `₦${Math.round(n).toLocaleString("en-NG")}`;
}
function pad(h: number): string {
  return String(((h % 24) + 24) % 24).padStart(2, "0");
}
