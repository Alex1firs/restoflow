import "server-only";
import { buildRestaurantContext } from "./context";
import { getForecast } from "./forecasting";
import { listRecommendations } from "./recommendations";
import { createIntelligenceContext, lagosHour } from "./tools/_shared";
import type { InsightSeverity, ProactiveSignal } from "./types";

/**
 * Proactive Signals (Phase 7.1)
 * =============================
 * Detects event-driven moments worth interrupting the owner about — sales beating or
 * missing forecast, a growing kitchen queue, an approaching peak, unavailable items,
 * unreviewed recommendations. Each signal carries a `followup` prompt so tapping/saying
 * it continues straight into a voice conversation.
 *
 * Strictly READ-ONLY and deterministic. It reuses the existing engines — today's
 * Restaurant Context, the cached Forecast, and the Recommendation Engine — and adds NO
 * new business logic. It writes nothing (safe to poll frequently).
 */

export interface DetectSignalsOptions {
  db?: FirebaseFirestore.Firestore;
  now?: () => Date;
}

const SEVERITY_RANK: Record<InsightSeverity, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
/** Assumed active trading window (Lagos hours) for pacing sales-vs-forecast. */
const OPEN_HOUR = 8;
const OPEN_SPAN = 14;

/** Return the currently-active proactive signals for a restaurant, most-severe first. */
export async function detectProactiveSignals(slug: string, opts: DetectSignalsOptions = {}): Promise<ProactiveSignal[]> {
  const ctx = createIntelligenceContext(slug, { feature: "signals", now: opts.now, db: opts.db });
  const nowDate = ctx.now();
  const hour = lagosHour(nowDate);

  // Reuse existing engines (all reads, all cached where possible).
  const [context, forecast, recs] = await Promise.all([
    buildRestaurantContext(ctx, { range: { range: "today" } }),
    getForecast(slug, { db: opts.db, now: opts.now }),
    listRecommendations(slug, { db: opts.db, now: opts.now }),
  ]);

  const signals: ProactiveSignal[] = [];

  // 1. Sales vs forecast pace (needs a cached forecast + some of the day elapsed).
  const elapsed = clamp((hour - OPEN_HOUR) / OPEN_SPAN, 0, 1);
  const predictedDaily = forecast ? forecast.revenue.predicted / 7 : 0;
  const revenueSoFar = context.orders?.revenueSoFar ?? 0;
  if (predictedDaily > 0 && elapsed >= 0.15) {
    const expectedByNow = predictedDaily * elapsed;
    if (expectedByNow > 0) {
      const ratio = revenueSoFar / expectedByNow;
      if (ratio >= 1.15) {
        signals.push({ id: "sales_above_forecast", type: "sales_above_forecast", severity: "low", message: `Sales are ${pct(ratio - 1)} above forecast so far today.`, followup: "What are today's recommendations?" });
      } else if (ratio <= 0.7 && elapsed >= 0.3) {
        signals.push({ id: "sales_below_forecast", type: "sales_below_forecast", severity: "high", message: `Sales are running ${pct(1 - ratio)} below forecast today.`, followup: "Why are sales lower today?" });
      }
    }
  }

  // 2. Peak approaching (one hour before the forecast's busiest window).
  const peak = forecast?.peakWindows[0]?.window;
  if (peak) {
    const startHour = parseInt(peak.slice(0, 2), 10);
    if (Number.isFinite(startHour) && hour === startHour - 1) {
      signals.push({ id: "peak_approaching", type: "peak_approaching", severity: "medium", message: `Your busiest window, around ${peak}, starts soon.`, followup: "How should I prepare for the rush?" });
    }
  }

  // 3. Kitchen queue growing (live active orders).
  const active = context.orders?.active ?? 0;
  if (active >= 8) {
    signals.push({ id: "kitchen_queue_growing", type: "kitchen_queue_growing", severity: "medium", message: `Your kitchen has ${active} active orders — the queue is growing.`, followup: "How is kitchen performance right now?" });
  }

  // 4. Inventory low (unavailable items).
  const outOfStock = context.inventory?.outOfStock?.length ?? 0;
  if (outOfStock > 0) {
    signals.push({ id: "inventory_low", type: "inventory_low", severity: "medium", message: `${outOfStock} item${outOfStock === 1 ? " is" : "s are"} currently unavailable.`, followup: "What should I restock?" });
  }

  // 5. Recommendations awaiting review.
  const awaiting = recs.filter((r) => r.status === "new").length;
  if (awaiting > 0) {
    signals.push({ id: "recommendations_unreviewed", type: "recommendations_unreviewed", severity: "low", message: `You have ${awaiting} recommendation${awaiting === 1 ? "" : "s"} waiting for your approval.`, followup: "Read the recommendations." });
  }

  return signals.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}
