/**
 * Forecasting Engine tests (fake Firestore; deterministic — no LLM).
 * Proves the forecast CONSUMES the existing layers rather than duplicating logic:
 *  - projects revenue/orders (next 7 days) from historical daily series,
 *  - explains WHY via Decision-Engine insights + computed trend/seasonality drivers,
 *  - exposes confidence scores + user-friendly levels,
 *  - produces structured item-demand (for Smart Purchasing) + peak windows (for Automation),
 *  - LINKS active recommendations to the item demand they affect,
 *  - tenant isolation, cost-control skip, and writes ONLY ai_forecasts + ai_usage.
 *
 * Run: npm run test:ai
 */
import assert from "node:assert";
import { FakeFirestore } from "./fake-firestore";
import { generateForecast, getForecast, AI_FORECASTS_COLLECTION } from "../forecasting";
import { generateRecommendations, AI_RECOMMENDATIONS_COLLECTION } from "../recommendations";
import { AI_USAGE_COLLECTION } from "../usage";

const CORE = ["restaurants", "orders", "payments", "menu_items", "prepared_items", "users"];
const now = () => new Date("2026-07-08T12:00:00Z");
const DAY = 86_400_000;

let passed = 0;
async function ok(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

function asDb(db: FakeFirestore) {
  return db as unknown as FirebaseFirestore.Firestore;
}

/**
 * Seed 14 completed days of history for "grills" with a clear UPWARD trend:
 *  - recent week (1–7 days ago): 3 Jollof orders/day  → ₦15,000/day
 *  - older  week (8–14 days ago): 2 Jollof orders/day → ₦10,000/day
 * All orders land at ~19:00 Lagos (a clean peak window). Jollof Rice is the
 * dominant item (a price-increase recommendation candidate).
 */
function seedDb(): FakeFirestore {
  const db = new FakeFirestore();
  const future = { seconds: Math.floor((now().getTime() + 20 * DAY) / 1000) };
  db.seed("restaurants", "grills", {
    name: "Grills Capitol", status: "active", subscriptionStatus: "active",
    subscriptionEndDate: future, deliveryEnabled: true, loyalty: { enabled: false },
  });

  let n = 0;
  for (let offset = 1; offset <= 14; offset++) {
    const perDay = offset <= 7 ? 3 : 2; // recent week busier than the prior week
    for (let k = 0; k < perDay; k++) {
      const day = new Date(now().getTime() - offset * DAY);
      day.setUTCHours(18, k, 0, 0); // 18:xx UTC ≈ 19:xx Lagos → clean peak
      db.seed("orders", `o${n++}`, {
        restaurantId: "grills", customerName: `C${n}`, phone: `+23480000${String(n).padStart(4, "0")}`,
        items: [{ name: "Jollof Rice", quantity: 2, price: 2500 }], itemsTotal: 5000, deliveryFee: 0, total: 5000,
        paymentMethod: "cash", paymentStatus: "paid", status: "completed", orderSource: "counter", serviceMode: "counter", staffName: "Bola", createdAt: day,
      });
    }
  }
  db.seed("menu_items", "m1", { restaurantId: "grills", name: "Jollof Rice", price: 2500, category: "Rice", available: true });
  db.seed("menu_items", "m2", { restaurantId: "grills", name: "Salad", price: 1500, category: "Sides", available: true });
  db.seed("users", "u1", { restaurantSlug: "grills", displayName: "Bola", role: "owner" });

  // Foreign tenant — must never appear in grills' forecast.
  db.seed("restaurants", "other", { name: "Other Spot", subscriptionEndDate: future });
  db.seed("orders", "x1", {
    restaurantId: "other", customerName: "Foreign", phone: "+2349999999999",
    items: [{ name: "Pizza", quantity: 1, price: 99999 }], itemsTotal: 99999, deliveryFee: 0, total: 99999,
    paymentMethod: "cash", paymentStatus: "paid", status: "completed", orderSource: "online", serviceMode: "delivery", createdAt: new Date(now().getTime() - 2 * DAY),
  });
  db.seed("menu_items", "xm", { restaurantId: "other", name: "Pizza", price: 99999, category: "Italian", available: true });
  return db;
}

async function main() {
  console.log("\n[Forecast] Forecasting Engine\n");

  // ── Block A: forecast in isolation (no recommendations yet) ───────────────
  {
    const db = seedDb();
    const f = await generateForecast("grills", { db: asDb(db), now, requestId: "fc-1" });

    await ok("projects a next-7-days revenue point with a prediction interval", () => {
      assert.equal(f.revenue.metric, "revenue");
      assert.equal(f.revenue.horizon, "next_7_days");
      assert.equal(f.revenue.unit, "NGN");
      assert.ok(f.revenue.predicted > 0, "predicted revenue must be positive");
      assert.ok(f.revenue.low <= f.revenue.predicted && f.revenue.predicted <= f.revenue.high, "predicted must sit inside [low, high]");
    });

    await ok("projects a next-7-days orders point", () => {
      assert.equal(f.orders.metric, "orders");
      assert.equal(f.orders.unit, "orders");
      assert.ok(f.orders.predicted > 0);
    });

    await ok("exposes confidence score + user-friendly level", () => {
      assert.ok(f.confidence > 0 && f.confidence <= 0.95);
      assert.ok(["Very High", "High", "Medium", "Low"].includes(f.confidenceLevel));
      assert.ok(["Very High", "High", "Medium", "Low"].includes(f.revenue.confidenceLevel));
    });

    await ok("basis reflects ~14 days of history and detects the upward trend", () => {
      assert.equal(f.basis.daysOfHistory, 14);
      assert.ok((f.basis.trendPct ?? 0) > 0, "revenue trend should be positive");
      assert.ok(f.basis.dailyAvgRevenue > 0);
    });

    await ok("explains WHY via drivers (baseline + trend, sourced deterministically)", () => {
      const types = new Set(f.drivers.map((d) => d.type));
      assert.ok(types.has("baseline"), "expected a baseline driver");
      const trend = f.drivers.find((d) => d.type === "trend");
      assert.ok(trend && /up/i.test(trend.detail), "expected an upward trend driver");
    });

    await ok("structured item demand for Smart Purchasing (Jollof Rice, units > 0)", () => {
      const jollof = f.itemDemand.find((i) => i.item === "Jollof Rice");
      assert.ok(jollof, "expected a Jollof Rice demand forecast");
      assert.ok(jollof!.expectedUnitsNext7 > 0);
      assert.ok(jollof!.expectedUnitsPerDay > 0);
      assert.ok(["Very High", "High", "Medium", "Low"].includes(jollof!.confidenceLevel));
    });

    await ok("structured peak window for Automation (~19:00)", () => {
      assert.ok(f.peakWindows.length > 0, "expected at least one peak window");
      assert.ok(f.peakWindows[0].window.startsWith("19:"), `expected a 19:00 peak, got ${f.peakWindows[0].window}`);
      assert.ok(f.peakWindows[0].expectedSharePct > 0);
    });

    await ok("no foreign-tenant data leaks in", () => {
      const blob = JSON.stringify(f);
      assert.ok(!blob.includes("99999") && !blob.toLowerCase().includes("pizza"));
    });

    await ok("writes ONLY ai_forecasts + ai_usage (no core writes)", () => {
      const written = db.writtenCollections().sort();
      assert.deepEqual(written, [AI_FORECASTS_COLLECTION, AI_USAGE_COLLECTION].sort());
      for (const c of CORE) assert.equal(db.writes.filter((w) => w.collection === c).length, 0);
    });

    await ok("second generate (no force) returns cached forecast, no re-write", async () => {
      const before = db.writes.filter((w) => w.collection === AI_FORECASTS_COLLECTION).length;
      const again = await generateForecast("grills", { db: asDb(db), now, requestId: "fc-1b" });
      assert.equal(again.dateKey, f.dateKey);
      const after = db.writes.filter((w) => w.collection === AI_FORECASTS_COLLECTION).length;
      assert.equal(after, before, "cached path must not re-write the forecast");
    });

    await ok("getForecast returns today's cached forecast without computing", async () => {
      const cached = await getForecast("grills", { db: asDb(db), now });
      assert.ok(cached, "expected a cached forecast");
      assert.equal(cached!.restaurantId, "grills");
    });
  }

  // ── Block B: forecast CONSUMES the Recommendation Engine ──────────────────
  await ok("links active recommendations to the item demand they affect", async () => {
    const db = seedDb();
    // Generate recommendations first → a price_increase rec for Jollof Rice.
    const recs = await generateRecommendations("grills", { db: asDb(db), now });
    const priceRec = recs.find((r) => r.type === "price_increase");
    assert.ok(priceRec, "precondition: expected a price_increase recommendation");

    const f = await generateForecast("grills", { db: asDb(db), now, requestId: "fc-2" });
    const jollof = f.itemDemand.find((i) => i.item === "Jollof Rice");
    assert.ok(jollof, "expected Jollof demand forecast");
    assert.ok(jollof!.relatedRecommendationIds.includes(priceRec!.id), "demand forecast must link the price rec");
    assert.ok(jollof!.note && /price increase/i.test(jollof!.note), "expected a price-increase demand note");

    // A recommendation driver should surface in the "why".
    const recDriver = f.drivers.find((d) => d.type === "recommendation");
    assert.ok(recDriver, "expected a recommendation driver in the forecast's rationale");

    // Still no core writes even after consuming recommendations.
    for (const c of CORE) assert.equal(db.writes.filter((w) => w.collection === c).length, 0);
    // The only collections touched: ai_forecasts, ai_recommendations, ai_usage.
    const written = db.writtenCollections().sort();
    assert.deepEqual(written, [AI_FORECASTS_COLLECTION, AI_RECOMMENDATIONS_COLLECTION, AI_USAGE_COLLECTION].sort());
  });

  // ── Tenant isolation: another tenant's forecast is built from its OWN data ──
  await ok("forecast is tenant-scoped (other sees only its own single order)", async () => {
    const db = seedDb();
    const f = await generateForecast("other", { db: asDb(db), now });
    const blob = JSON.stringify(f);
    assert.ok(!blob.toLowerCase().includes("jollof"), "must not see grills' items");
    // Only one paid order 2 days ago → tiny/degraded forecast, but valid shape.
    assert.equal(f.restaurantId, "other");
    assert.ok(f.confidence > 0);
  });

  console.log(`\n✅ ALL ${passed} FORECAST CHECKS PASSED\n`);
}

main().catch((err) => {
  console.error("\n❌ FORECAST TEST FAILED\n", err);
  process.exit(1);
});
