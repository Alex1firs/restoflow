/**
 * Explainability Layer tests (pure — no Firestore, no LLM).
 * Proves every AI output explains itself with the SAME shape (what / why / ifIgnored),
 * built deterministically from EXISTING structured fields (no new reasoning):
 *  - recommendations expose why-reasons + a monetary "missed if ignored",
 *  - forecasts reuse their drivers as the "why",
 *  - purchasing lines explain from demand + reorder signal,
 *  - automations explain from their source,
 *  - explanationToSpeech renders why / ifIgnored / full for Voice.
 *
 * Run: npm run test:ai
 */
import assert from "node:assert";
import { explainRecommendation, explainForecast, explainPurchasingLine, explainAutomation, explanationToSpeech } from "../explainability";
import type { Automation, Forecast, MenuPurchaseLine, Recommendation } from "../types";

let passed = 0;
function ok(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

function rec(p: Partial<Recommendation>): Recommendation {
  return {
    id: "r", restaurantId: "grills", dateKey: "2026-07-08", type: p.type ?? "price_increase", category: "menu",
    title: p.title ?? "Increase the price of Jollof Rice by ₦200",
    rationale: p.rationale ?? "Jollof Rice sold 42 units this week with only 2% cancellations. Strong, reliable demand gives you room to raise the price.",
    expectedImpact: p.expectedImpact ?? "About ₦8,400 more revenue per week at the same volume.",
    action: p.action ?? { kind: "price_increase", target: "Jollof Rice", delta: 200 },
    confidence: p.confidence ?? 0.82, confidenceLevel: "High", priority: 80, status: "new",
    timeWindow: { label: "week", from: "", to: "" }, generatedAt: "", updatedAt: "", source: "deterministic", version: 1,
  } as Recommendation;
}

function main() {
  console.log("\n[Explain] Explainability Layer\n");

  ok("recommendation → what / why[] / ifIgnored / confidence", () => {
    const e = explainRecommendation(rec({}));
    assert.equal(e.what, "Increase the price of Jollof Rice by ₦200");
    assert.ok(e.why.length >= 2, "rationale split into discrete reasons");
    assert.ok(e.why.every((r) => /[.!?]$/.test(r)), "each reason is a clean sentence");
    assert.ok(/missed revenue/i.test(e.ifIgnored) && /month/i.test(e.ifIgnored), "weekly gain reframed to monthly missed");
    assert.equal(e.confidenceLevel, "High");
  });

  ok("weekly ₦8,400 → about ₦36,120/month missed", () => {
    const e = explainRecommendation(rec({}));
    // 8400 * 4.3 = 36,120
    assert.ok(e.ifIgnored.includes("36,120"), `got: ${e.ifIgnored}`);
  });

  ok("reenable_item explains the ongoing lost sales", () => {
    const e = explainRecommendation(rec({ type: "reenable_item", title: "Restock and re-enable Fish Pepper Soup", expectedImpact: "Recover lost sales" }));
    assert.ok(/turning away orders/i.test(e.ifIgnored));
  });

  ok("forecast → drivers become the why", () => {
    const forecast = {
      revenue: { predicted: 117600, low: 88200, high: 147000 }, orders: { predicted: 84 },
      peakWindows: [{ window: "19:00-21:00", expectedSharePct: 40 }],
      drivers: [{ type: "trend", detail: "Revenue is trending up 20% versus the prior week." }, { type: "baseline", detail: "Averaged ₦16,800 per day." }],
      confidence: 0.8, confidenceLevel: "High",
    } as unknown as Forecast;
    const e = explainForecast(forecast);
    assert.ok(/117,600/.test(e.what) && /84/.test(e.what));
    assert.equal(e.why.length, 2);
    assert.ok(/19:00-21:00/.test(e.ifIgnored));
  });

  ok("purchasing line → demand + signal drive the explanation", () => {
    const line = { item: "Jollof Rice", expectedUnits: 47, expectedUnitsPerDay: 6.7, preparationBatches: 1, peakWindow: "19:00-21:00", reorderSignal: "HIGH", guidance: "Prep ~47 over 7 days.", trendPct: 20, relatedRecommendationIds: [] } as MenuPurchaseLine;
    const e = explainPurchasingLine(line);
    assert.ok(/47 of Jollof Rice/.test(e.what));
    assert.ok(/running out/i.test(e.ifIgnored));
    assert.equal(e.confidenceLevel, "Very High"); // HIGH → 0.85
  });

  ok("automation → explained from its source", () => {
    const a = { title: "Restock and re-enable Fish Pepper Soup", source: { type: "recommendation", id: "x", actionKind: "reenable_item" } } as Automation;
    const e = explainAutomation(a);
    assert.ok(/approved recommendation/i.test(e.why[0]));
    assert.ok(/won't be carried out/i.test(e.ifIgnored));
  });

  ok("explanationToSpeech renders why / ifIgnored / full for Voice", () => {
    const e = explainRecommendation(rec({}));
    assert.equal(explanationToSpeech(e, "why"), e.why.join(" "));
    assert.equal(explanationToSpeech(e, "ifIgnored"), e.ifIgnored);
    const full = explanationToSpeech(e, "full");
    assert.ok(full.includes(e.what) && full.includes("why"));
  });

  console.log(`\n✅ ALL ${passed} EXPLAINABILITY CHECKS PASSED\n`);
}

main();
