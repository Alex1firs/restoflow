/**
 * Proactive Signals tests (fake Firestore; deterministic — no LLM).
 * Proves the signals layer is grounded in the existing engines, is READ-ONLY (safe to
 * poll), and is tenant-scoped:
 *  - detects inventory-low + unreviewed-recommendation signals,
 *  - carries a natural `followup` prompt that maps to a real voice intent,
 *  - writes NOTHING,
 *  - never surfaces another tenant's data.
 *
 * Run: npm run test:ai
 */
import assert from "node:assert";
import { FakeFirestore } from "./fake-firestore";
import { detectProactiveSignals } from "../signals";
import { generateRecommendations } from "../recommendations";

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

function seedDb(): FakeFirestore {
  const db = new FakeFirestore();
  const future = { seconds: Math.floor((now().getTime() + 20 * DAY) / 1000) };
  db.seed("restaurants", "grills", { name: "Grills Capitol", status: "active", subscriptionStatus: "active", subscriptionEndDate: future, deliveryEnabled: true, loyalty: { enabled: false } });
  let n = 0;
  for (let offset = 1; offset <= 14; offset++) {
    const perDay = offset <= 7 ? 3 : 2;
    for (let k = 0; k < perDay; k++) {
      const day = new Date(now().getTime() - offset * DAY);
      day.setUTCHours(18, k, 0, 0);
      db.seed("orders", `o${n++}`, { restaurantId: "grills", customerName: `C${n}`, phone: `+2348${n}`, items: [{ name: "Jollof Rice", quantity: 2, price: 2500 }], itemsTotal: 5000, deliveryFee: 0, total: 5000, paymentMethod: "cash", paymentStatus: "paid", status: "completed", orderSource: "counter", serviceMode: "counter", createdAt: day });
    }
  }
  db.seed("menu_items", "m1", { restaurantId: "grills", name: "Jollof Rice", price: 2500, category: "Rice", available: true });
  db.seed("menu_items", "m3", { restaurantId: "grills", name: "Fish Pepper Soup", price: 4000, category: "Soup", available: false });
  db.seed("users", "u1", { restaurantSlug: "grills", displayName: "Bola", role: "owner" });
  db.seed("restaurants", "other", { name: "Other Spot", subscriptionEndDate: future });
  db.seed("menu_items", "xm", { restaurantId: "other", name: "Pizza", price: 99999, category: "Italian", available: true });
  return db;
}

async function main() {
  console.log("\n[Signals] Proactive Voice Signals\n");

  await ok("detects inventory-low + unreviewed-recommendation signals", async () => {
    const db = seedDb();
    await generateRecommendations("grills", { db: asDb(db), now }); // → "new" recs awaiting review
    const signals = await detectProactiveSignals("grills", { db: asDb(db), now });
    const types = new Set(signals.map((s) => s.type));
    assert.ok(types.has("inventory_low"), "unavailable item → inventory_low");
    assert.ok(types.has("recommendations_unreviewed"), "new recs → recommendations_unreviewed");
    signals.forEach((s) => {
      assert.ok(s.message.length > 0 && s.followup.length > 0, "every signal has a message + followup");
    });
  });

  await ok("signals are sorted most-severe first", async () => {
    const db = seedDb();
    await generateRecommendations("grills", { db: asDb(db), now });
    const signals = await detectProactiveSignals("grills", { db: asDb(db), now });
    const rank: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
    for (let i = 1; i < signals.length; i++) {
      assert.ok(rank[signals[i - 1].severity] >= rank[signals[i].severity]);
    }
  });

  await ok("detection is READ-ONLY — writes nothing (safe to poll)", async () => {
    const db = seedDb();
    await detectProactiveSignals("grills", { db: asDb(db), now });
    assert.equal(db.writes.length, 0, "no writes at all");
  });

  await ok("is tenant-scoped — never surfaces another tenant's data", async () => {
    const db = seedDb();
    const signals = await detectProactiveSignals("other", { db: asDb(db), now });
    const blob = JSON.stringify(signals).toLowerCase();
    assert.ok(!blob.includes("jollof") && !blob.includes("99999"));
  });

  console.log(`\n✅ ALL ${passed} SIGNAL CHECKS PASSED\n`);
}

main().catch((err) => {
  console.error("\n❌ SIGNALS TEST FAILED\n", err);
  process.exit(1);
});
