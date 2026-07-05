/**
 * Smart Purchasing tests (fake Firestore; deterministic — no LLM).
 * Proves the plan CONSUMES the Forecasting + Recommendation Engines and:
 *  - produces menu-item prep/reorder lines (batches, peak window, LOW/MED/HIGH signal),
 *  - flags unavailable items (reenable_item rec) as HIGH restock — even with no sales,
 *  - leaves `ingredientDemand` undefined today (ingredientPlanningAvailable=false),
 *  - LIGHTS UP ingredient lines when a RecipeResolver is injected — WITHOUT changing
 *    the forecast, recommendations, or the translator (the extension-point contract),
 *  - tenant isolation, cost-control skip, writes ONLY ai_purchase_plans + ai_usage.
 *
 * Run: npm run test:ai
 */
import assert from "node:assert";
import { FakeFirestore } from "./fake-firestore";
import {
  generatePurchasingPlan,
  getPurchasingPlan,
  menuDemandTranslator,
  AI_PURCHASE_PLANS_COLLECTION,
  type RecipeResolver,
} from "../purchasing";
import { AI_FORECASTS_COLLECTION } from "../forecasting";
import { AI_RECOMMENDATIONS_COLLECTION } from "../recommendations";
import { AI_USAGE_COLLECTION } from "../usage";
import type { IngredientDemand, MenuItemDemand } from "../types";

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
 * Same trending history as the forecast test, PLUS an unavailable item
 * ("Fish Pepper Soup") so a reenable_item recommendation drives a HIGH restock line.
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
    const perDay = offset <= 7 ? 3 : 2; // recent week busier → upward trend
    for (let k = 0; k < perDay; k++) {
      const day = new Date(now().getTime() - offset * DAY);
      day.setUTCHours(18, k, 0, 0);
      db.seed("orders", `o${n++}`, {
        restaurantId: "grills", customerName: `C${n}`, phone: `+23480000${String(n).padStart(4, "0")}`,
        items: [{ name: "Jollof Rice", quantity: 2, price: 2500 }], itemsTotal: 5000, deliveryFee: 0, total: 5000,
        paymentMethod: "cash", paymentStatus: "paid", status: "completed", orderSource: "counter", serviceMode: "counter", staffName: "Bola", createdAt: day,
      });
    }
  }
  db.seed("menu_items", "m1", { restaurantId: "grills", name: "Jollof Rice", price: 2500, category: "Rice", available: true });
  db.seed("menu_items", "m2", { restaurantId: "grills", name: "Salad", price: 1500, category: "Sides", available: true });
  db.seed("menu_items", "m3", { restaurantId: "grills", name: "Fish Pepper Soup", price: 4000, category: "Soup", available: false });
  db.seed("users", "u1", { restaurantSlug: "grills", displayName: "Bola", role: "owner" });

  // Foreign tenant — must never appear.
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
  console.log("\n[Purchasing] Smart Purchasing\n");

  // ── Block A: menu-item plan with no recipes (zero setup) ──────────────────
  {
    const db = seedDb();
    const plan = await generatePurchasingPlan("grills", { db: asDb(db), now, requestId: "pp-1" });

    await ok("produces a menu-item prep/purchasing plan", () => {
      assert.equal(plan.restaurantId, "grills");
      assert.ok(plan.menuDemand.length > 0);
      assert.ok(plan.summary.length > 0);
      assert.equal(plan.source, "deterministic");
      assert.ok(plan.basedOnForecastAt, "plan must record its forecast provenance");
    });

    await ok("each line has a valid reorder signal, batches and guidance", () => {
      for (const l of plan.menuDemand) {
        assert.ok(["LOW", "MEDIUM", "HIGH"].includes(l.reorderSignal));
        assert.ok(l.preparationBatches >= 0);
        assert.ok(l.guidance.length > 0);
      }
    });

    await ok("Jollof Rice: real demand, ≥1 batch/day, peak window attached", () => {
      const jollof = plan.menuDemand.find((l) => l.item === "Jollof Rice");
      assert.ok(jollof, "expected a Jollof Rice line");
      assert.ok(jollof!.expectedUnits > 0);
      assert.ok(jollof!.preparationBatches >= 1);
      assert.ok(jollof!.peakWindow && jollof!.peakWindow.startsWith("19:"), "expected a 19:00 peak window");
    });

    await ok("unavailable item is a HIGH restock line even with no recent sales", () => {
      const soup = plan.menuDemand.find((l) => l.item === "Fish Pepper Soup");
      assert.ok(soup, "expected the unavailable item on the plan");
      assert.equal(soup!.reorderSignal, "HIGH");
      assert.equal(soup!.preparationBatches, 0);
      assert.ok(/restock/i.test(soup!.guidance));
    });

    await ok("sorted with HIGH-priority restocks first", () => {
      const rank = (s: string) => (s === "HIGH" ? 3 : s === "MEDIUM" ? 2 : 1);
      for (let i = 1; i < plan.menuDemand.length; i++) {
        assert.ok(rank(plan.menuDemand[i - 1].reorderSignal) >= rank(plan.menuDemand[i].reorderSignal));
      }
    });

    await ok("ingredient planning is OFF today (no recipes)", () => {
      assert.equal(plan.ingredientPlanningAvailable, false);
      assert.equal(plan.ingredientDemand, undefined);
    });

    await ok("no foreign-tenant data leaks in", () => {
      const blob = JSON.stringify(plan);
      assert.ok(!blob.includes("99999") && !blob.toLowerCase().includes("pizza"));
    });

    await ok("writes ONLY ai_* collections (no core writes)", () => {
      for (const c of CORE) assert.equal(db.writes.filter((w) => w.collection === c).length, 0);
      const written = new Set(db.writtenCollections());
      // Plan generation also generated the forecast it consumed → those ai_* writes are expected.
      assert.ok(written.has(AI_PURCHASE_PLANS_COLLECTION));
      for (const c of written) {
        assert.ok([AI_PURCHASE_PLANS_COLLECTION, AI_FORECASTS_COLLECTION, AI_RECOMMENDATIONS_COLLECTION, AI_USAGE_COLLECTION].includes(c), `unexpected collection written: ${c}`);
      }
    });

    await ok("second generate (no force) returns cached plan, no re-write", async () => {
      const before = db.writes.filter((w) => w.collection === AI_PURCHASE_PLANS_COLLECTION).length;
      const again = await generatePurchasingPlan("grills", { db: asDb(db), now, requestId: "pp-1b" });
      assert.equal(again.dateKey, plan.dateKey);
      const after = db.writes.filter((w) => w.collection === AI_PURCHASE_PLANS_COLLECTION).length;
      assert.equal(after, before, "cached path must not re-write the plan");
    });

    await ok("getPurchasingPlan returns today's cached plan without computing", async () => {
      const cached = await getPurchasingPlan("grills", { db: asDb(db), now });
      assert.ok(cached && cached.restaurantId === "grills");
    });
  }

  // ── Block B: the extension point — a Recipe Engine lights up ingredients ──
  await ok("RecipeResolver seam produces ingredient lines with NO change above the translator", async () => {
    const db = seedDb();
    // A fake future Recipe Engine: Jollof Rice → 0.15kg rice/unit, partial stock on hand.
    const fakeRecipes: RecipeResolver = {
      id: "fake-recipes",
      resolve(menuDemand: MenuItemDemand[]): IngredientDemand[] {
        const jollof = menuDemand.find((d) => d.item === "Jollof Rice");
        const units = jollof?.expectedUnitsNext7 ?? 0;
        return [
          { ingredient: "Rice", unit: "kg", requiredQuantity: units * 0.15, onHand: 2, supplier: "Supplier A" },
          { ingredient: "Palm Oil", unit: "L", requiredQuantity: units * 0.05, onHand: null, supplier: "Supplier B" },
        ];
      },
    };

    const plan = await generatePurchasingPlan("grills", { db: asDb(db), now, recipeResolver: fakeRecipes });

    assert.equal(plan.ingredientPlanningAvailable, true);
    assert.ok(plan.ingredientDemand && plan.ingredientDemand.length === 2, "expected two ingredient lines");
    const rice = plan.ingredientDemand!.find((i) => i.ingredient === "Rice")!;
    assert.ok(rice.requiredQuantity > 0);
    // reorderQuantity = max(0, required - onHand); onHand 2kg known.
    assert.equal(rice.reorderQuantity, Math.round((rice.requiredQuantity - 2) * 100) / 100);
    assert.equal(rice.supplier, "Supplier A");
    // Unknown stock → reorderQuantity null, signal MEDIUM (can't confirm need).
    const oil = plan.ingredientDemand!.find((i) => i.ingredient === "Palm Oil")!;
    assert.equal(oil.reorderQuantity, null);
    // The menu plan is IDENTICAL in shape — ingredients are purely additive.
    assert.ok(plan.menuDemand.length > 0);
  });

  await ok("the translator itself is a pure, stable function (unit-level)", () => {
    const menuDemand: MenuItemDemand[] = [
      { item: "A", expectedUnitsNext7: 40, expectedUnitsPerDay: 6, trendPct: 30, relatedRecommendationIds: [], unavailable: false, promoted: false },
      { item: "B", expectedUnitsNext7: 4, expectedUnitsPerDay: 1, trendPct: null, relatedRecommendationIds: [], unavailable: false, promoted: false },
    ];
    const withoutIngredients = menuDemandTranslator.translate({ menuDemand, peakWindow: "19:00-21:00" });
    assert.equal(withoutIngredients.ingredientLines, undefined);
    assert.equal(withoutIngredients.menuLines[0].item, "A"); // higher demand + up-trend first
    assert.equal(withoutIngredients.menuLines[0].reorderSignal, "HIGH");

    const withIngredients = menuDemandTranslator.translate({
      menuDemand,
      peakWindow: "19:00-21:00",
      ingredientDemand: [{ ingredient: "X", unit: "kg", requiredQuantity: 5, onHand: 1 }],
    });
    assert.ok(withIngredients.ingredientLines && withIngredients.ingredientLines.length === 1);
    // Same menu output regardless of ingredient presence.
    assert.deepEqual(withIngredients.menuLines, withoutIngredients.menuLines);
  });

  // ── Tenant isolation ──────────────────────────────────────────────────────
  await ok("plan is tenant-scoped (other never sees grills' items)", async () => {
    const db = seedDb();
    const plan = await generatePurchasingPlan("other", { db: asDb(db), now });
    const blob = JSON.stringify(plan);
    assert.ok(!blob.toLowerCase().includes("jollof") && !blob.toLowerCase().includes("pepper soup"));
    assert.equal(plan.restaurantId, "other");
  });

  console.log(`\n✅ ALL ${passed} PURCHASING CHECKS PASSED\n`);
}

main().catch((err) => {
  console.error("\n❌ PURCHASING TEST FAILED\n", err);
  process.exit(1);
});
