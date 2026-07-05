/**
 * Recommendations Engine tests (fake Firestore; deterministic — no LLM).
 * Proves: concrete actionable recommendations from the tool layer, status
 * lifecycle (dismiss persists across regeneration), cost-control skip, tenant
 * isolation, and that generation/updates write ONLY ai_recommendations + ai_usage.
 *
 * Run: npm run test:ai
 */
import assert from "node:assert";
import { FakeFirestore } from "./fake-firestore";
import { generateRecommendations, listRecommendations, updateRecommendationStatus, AI_RECOMMENDATIONS_COLLECTION } from "../recommendations";
import { AI_USAGE_COLLECTION } from "../usage";

const CORE = ["restaurants", "orders", "payments", "menu_items", "prepared_items", "users"];
const now = () => new Date("2026-07-08T12:00:00Z");

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
 * Seed a week's worth of signal for "grills":
 *  - Jollof Rice sells heavily (price-increase candidate), no cancellations
 *  - Salad is on the menu but never sells (bundle/promote candidate)
 *  - "Fish Pepper Soup" is unavailable (re-enable candidate)
 *  - orders cluster at 19:00 (staffing candidate)
 */
function seedDb(): FakeFirestore {
  const db = new FakeFirestore();
  const future = { seconds: Math.floor((now().getTime() + 20 * 86_400_000) / 1000) };
  db.seed("restaurants", "grills", { name: "Grills Capitol", status: "active", subscriptionStatus: "active", subscriptionEndDate: future, deliveryEnabled: true, loyalty: { enabled: false } });

  // 12 paid orders across the past week, all at 19:xx (7pm), all Jollof Rice.
  for (let i = 0; i < 12; i++) {
    const day = new Date(now().getTime() - (1 + (i % 6)) * 86_400_000);
    day.setUTCHours(18, 0 + i, 0, 0); // 18:00 UTC ≈ 19:00 Lagos
    db.seed("orders", `o${i}`, {
      restaurantId: "grills", customerName: `C${i}`, phone: `+23480000000${i}`,
      items: [{ name: "Jollof Rice", quantity: 2, price: 2500 }], itemsTotal: 5000, deliveryFee: 0, total: 5000,
      paymentMethod: "cash", paymentStatus: "paid", status: "completed", orderSource: "counter", serviceMode: "counter", staffName: "Bola", createdAt: day,
    });
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
    paymentMethod: "cash", paymentStatus: "paid", status: "completed", orderSource: "online", serviceMode: "delivery", createdAt: new Date(now().getTime() - 2 * 86_400_000),
  });
  db.seed("menu_items", "xm", { restaurantId: "other", name: "Pizza", price: 99999, category: "Italian", available: true });
  return db;
}

async function main() {
  console.log("\n[Recommendations] Recommendations Engine\n");

  {
    const db = seedDb();
    const recs = await generateRecommendations("grills", { db: asDb(db), now, requestId: "rec-1" });
    const byType = new Map(recs.map((r) => [r.type, r]));

    await ok("produces actionable recommendations", () => {
      assert.ok(recs.length > 0);
      recs.forEach((r) => {
        assert.equal(r.restaurantId, "grills");
        assert.ok(r.title.length > 0 && r.rationale.length > 0);
        assert.ok(["Very High", "High", "Medium", "Low"].includes(r.confidenceLevel));
        assert.equal(r.source, "deterministic");
      });
    });

    await ok("price increase for the high-demand, low-cancellation item", () => {
      const p = byType.get("price_increase");
      assert.ok(p, "expected a price_increase rec");
      assert.equal(p!.action.target, "Jollof Rice");
      assert.ok((p!.action.delta ?? 0) >= 50);
      assert.ok((p!.action.suggestedPrice ?? 0) > (p!.action.currentPrice ?? 0));
      assert.ok(/Increase the price of Jollof Rice by ₦/.test(p!.title));
    });

    await ok("re-enable for the unavailable item", () => {
      const r = byType.get("reenable_item");
      assert.ok(r, "expected a reenable_item rec");
      assert.equal(r!.action.target, "Fish Pepper Soup");
    });

    await ok("staffing for the 7pm peak", () => {
      const s = byType.get("staffing");
      assert.ok(s, "expected a staffing rec");
      assert.ok(/staff/i.test(s!.title));
      assert.ok(s!.action.window);
    });

    await ok("bundle for the never-sold item", () => {
      const b = byType.get("bundle");
      assert.ok(b, "expected a bundle rec");
      assert.equal(b!.action.pairWith, "Jollof Rice");
    });

    await ok("ranked by priority (re-enable first)", () => {
      assert.equal(recs[0].type, "reenable_item");
    });

    await ok("no foreign-tenant data leaks in", () => {
      const blob = JSON.stringify(recs);
      assert.ok(!blob.includes("99999") && !blob.toLowerCase().includes("pizza"));
    });

    await ok("writes ONLY ai_recommendations + ai_usage (no core writes)", () => {
      const written = db.writtenCollections().sort();
      assert.deepEqual(written, [AI_RECOMMENDATIONS_COLLECTION, AI_USAGE_COLLECTION].sort());
      for (const c of CORE) assert.equal(db.writes.filter((w) => w.collection === c).length, 0);
    });

    // --- Cost control: regeneration without force returns the cached set ---
    await ok("second generate (no force) returns cached set", async () => {
      const writesBefore = db.writes.length;
      const again = await generateRecommendations("grills", { db: asDb(db), now, requestId: "rec-1b" });
      assert.equal(again.length, recs.length);
      // No new ai_recommendations writes (only cache read); usage may or may not add.
      const recWritesAfter = db.writes.filter((w) => w.collection === AI_RECOMMENDATIONS_COLLECTION).length;
      const recWritesBefore = db.writes.slice(0, writesBefore).filter((w) => w.collection === AI_RECOMMENDATIONS_COLLECTION).length;
      assert.equal(recWritesAfter, recWritesBefore, "cached path must not re-write recommendations");
    });

    // --- Status lifecycle: dismiss persists across regeneration ---
    await ok("dismiss persists across a forced regeneration", async () => {
      const price = byType.get("price_increase")!;
      const updated = await updateRecommendationStatus("grills", price.id, "dismissed", { db: asDb(db), now });
      assert.equal(updated!.status, "dismissed");

      // Dismissed rec should not appear in the active list.
      const active = await listRecommendations("grills", { db: asDb(db), now });
      assert.ok(!active.find((r) => r.id === price.id), "dismissed rec must be hidden");

      // Force-regenerate → the dismissed rec stays dismissed (not resurrected as "new").
      await generateRecommendations("grills", { db: asDb(db), now, force: true, requestId: "rec-1c" });
      const active2 = await listRecommendations("grills", { db: asDb(db), now });
      assert.ok(!active2.find((r) => r.id === price.id), "dismissed rec must remain hidden after regen");
    });
  }

  // --- Update isolation: can't touch another tenant's rec ---
  await ok("updateRecommendationStatus won't cross tenants", async () => {
    const db = seedDb();
    await generateRecommendations("grills", { db: asDb(db), now });
    // "other" tenant tries to flip a grills rec id → no grills doc under other:<id>, returns null.
    const res = await updateRecommendationStatus("other", "reenable_item:fish-pepper-soup", "dismissed", { db: asDb(db), now });
    assert.equal(res, null);
  });

  await ok("all recommendation writes are to ai_* collections only", async () => {
    const db = seedDb();
    await generateRecommendations("grills", { db: asDb(db), now });
    await updateRecommendationStatus("grills", "staffing:18", "accepted", { db: asDb(db), now }).catch(() => {});
    for (const c of CORE) assert.equal(db.writes.filter((w) => w.collection === c).length, 0);
  });

  console.log(`\n✅ ALL ${passed} RECOMMENDATION CHECKS PASSED\n`);
}

main().catch((err) => {
  console.error("\n❌ RECOMMENDATIONS TEST FAILED\n", err);
  process.exit(1);
});
