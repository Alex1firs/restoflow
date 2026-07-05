import { confidenceToLevel } from "./decision-engine";
import type {
  Automation,
  Explanation,
  Forecast,
  MenuPurchaseLine,
  Recommendation,
} from "./types";

/**
 * Explainability Layer (Phase 7.3)
 * ================================
 * Every AI output explains itself with the SAME three-field shape:
 *   what?  ·  why?  ·  what happens if ignored?
 *
 * These builders are PURE and DETERMINISTIC — they restructure each artifact's
 * EXISTING fields (a recommendation's rationale/impact, a forecast's drivers, a
 * purchasing line's guidance, an automation's source). They generate NO new
 * reasoning, so the Voice Assistant can answer "Why?" / "Explain" / "What if I
 * ignore it?" straight from these fields instead of re-deriving anything.
 *
 * This is an OUTPUT concern — separate from the Operating Profile (an INPUT concern).
 * No engine logic changes; explanations are attached at the consumption boundary.
 */

const WEEKS_PER_MONTH = 4.3;

/** Split a rationale sentence-string into discrete reasons. */
function splitReasons(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\s+—\s+|;\s+/)
    .map((s) => s.trim().replace(/\s+/g, " "))
    .filter((s) => s.length > 0)
    .map((s) => (/[.!?]$/.test(s) ? s : `${s}.`));
}

function lowerFirst(s: string): string {
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

function naira(n: number): string {
  return `₦${Math.round(n).toLocaleString("en-NG")}`;
}

/** Reframe a per-period gain into a monthly "missed if ignored" figure when possible. */
function missedFromImpact(impact: string): string {
  const money = impact.match(/₦\s?([\d,]+)/);
  if (!money) return `If ignored, you forgo: ${lowerFirst(impact)}`;
  const amount = Number(money[1].replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return `If ignored, you forgo: ${lowerFirst(impact)}`;
  if (/per\s+day|daily|\/day/i.test(impact)) return `Estimated missed revenue if ignored: about ${naira(amount * 30)} per month.`;
  if (/per\s+(week|month)|weekly|monthly|\/week/i.test(impact)) {
    const monthly = /month/i.test(impact) ? amount : amount * WEEKS_PER_MONTH;
    return `Estimated missed revenue if ignored: about ${naira(monthly)} per month.`;
  }
  return `If ignored, you forgo: ${lowerFirst(impact)}`;
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/** Explain a recommendation from its own structured fields. */
export function explainRecommendation(rec: Recommendation): Explanation {
  const ifIgnored =
    rec.type === "reenable_item"
      ? "If ignored, you keep turning away orders for an item customers want."
      : missedFromImpact(rec.expectedImpact);
  return {
    what: rec.title,
    why: splitReasons(rec.rationale),
    ifIgnored,
    confidence: rec.confidence,
    confidenceLevel: rec.confidenceLevel,
  };
}

/** Explain a forecast — the drivers ARE the "why". */
export function explainForecast(forecast: Forecast): Explanation {
  const peak = forecast.peakWindows[0]?.window;
  const ifIgnored = peak
    ? `Without preparing, you risk understaffing or stockouts during the ${peak} peak.`
    : `Without preparing, you risk understaffing or stockouts at your busiest times.`;
  return {
    what: `Over the next 7 days, expect about ${naira(forecast.revenue.predicted)} in revenue from roughly ${Math.round(forecast.orders.predicted)} orders.`,
    why: forecast.drivers.map((d) => d.detail),
    ifIgnored,
    confidence: forecast.confidence,
    confidenceLevel: forecast.confidenceLevel,
  };
}

const SIGNAL_CONFIDENCE: Record<string, number> = { HIGH: 0.85, MEDIUM: 0.6, LOW: 0.4 };

/** Explain a purchasing line from its demand + reorder signal. */
export function explainPurchasingLine(line: MenuPurchaseLine): Explanation {
  const why: string[] = [line.guidance];
  const ifIgnored =
    line.reorderSignal === "HIGH"
      ? line.expectedUnits > 0
        ? `If ignored, you risk running out of ${line.item} and losing sales at peak.`
        : `If ignored, ${line.item} stays unavailable and you keep losing those sales.`
      : `If ignored, ${line.item} stocking may drift out of line with demand.`;
  const confidence = SIGNAL_CONFIDENCE[line.reorderSignal] ?? 0.5;
  return {
    what: line.expectedUnits > 0 ? `Prepare about ${line.expectedUnits} of ${line.item} over the next 7 days.` : `Restock ${line.item}.`,
    why,
    ifIgnored,
    confidence,
    confidenceLevel: confidenceToLevel(confidence),
  };
}

/** Explain an automation from its source. */
export function explainAutomation(automation: Automation): Explanation {
  const confidence = 0.8;
  return {
    what: automation.title,
    why: [`Created from an approved ${automation.source.type} (${automation.source.actionKind.replace(/_/g, " ")}).`],
    ifIgnored: `If not run, this ${automation.source.actionKind.replace(/_/g, " ")} action won't be carried out.`,
    confidence,
    confidenceLevel: confidenceToLevel(confidence),
  };
}

/** Render an explanation as a natural spoken paragraph (for Voice). */
export function explanationToSpeech(exp: Explanation, part: "why" | "ifIgnored" | "full" = "full"): string {
  if (part === "why") return exp.why.join(" ");
  if (part === "ifIgnored") return exp.ifIgnored;
  return `${exp.what} Here's why: ${exp.why.join(" ")} ${exp.ifIgnored}`;
}
