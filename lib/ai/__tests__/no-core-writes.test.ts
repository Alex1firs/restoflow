/**
 * Integration test: the production-readiness components (context assembly,
 * decision engine, usage persistence, health-style checks) must NEVER write to
 * restaurant, order, payment, or menu collections. The ONLY permitted write is to
 * `ai_usage`.
 *
 * Run: npm run test:ai
 *
 * Uses a fake Firestore that records every write and enforces tenant isolation by
 * honouring `where` filters, so we also prove no cross-tenant data leaks in.
 */
import assert from "node:assert";
import { FakeFirestore } from "./fake-firestore";
import { createIntelligenceContext } from "../tools/_shared";
import { buildRestaurantContext } from "../context";
import { runDecisionEngine } from "../decision-engine";
import { writeUsageRecord, AI_USAGE_COLLECTION } from "../usage";
import { getBusinessProfile } from "../tools";

const CORE_COLLECTIONS = [
  "restaurants",
  "orders",
  "payments",
  "menu_items",
  "prepared_items",
  "users",
  "pending_payments",
  "loyalty_ticks",
  "waiters",
];

let passed = 0;
function ok(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve(fn()).then(() => {
    passed++;
    console.log(`  ✓ ${name}`);
  });
}

function seedDb(): FakeFirestore {
  const db = new FakeFirestore();
  const now = new Date("2026-07-04T12:00:00Z");
  const recent = new Date(now.getTime() - 2 * 86_400_000); // 2 days ago (inside the week window)
  const future = { seconds: Math.floor((now.getTime() + 20 * 86_400_000) / 1000) };

  // Tenant under test: "grills"
  db.seed("restaurants", "grills", {
    name: "Grills Capitol",
    status: "active",
    subscriptionStatus: "active",
    subscriptionEndDate: future,
    deliveryEnabled: true,
    pickupEnabled: true,
    dineInEnabled: true,
    loyalty: { enabled: false },
  });
  db.seed("orders", "o1", {
    restaurantId: "grills",
    customerName: "Ada Obi",
    phone: "+2348011112222",
    items: [{ name: "Jollof Rice", quantity: 2, price: 2500 }],
    itemsTotal: 5000,
    deliveryFee: 0,
    total: 5000,
    paymentMethod: "cash",
    paymentStatus: "paid",
    status: "completed",
    orderSource: "counter",
    serviceMode: "counter",
    staffName: "Bola",
    createdAt: recent,
  });
  db.seed("menu_items", "m1", { restaurantId: "grills", name: "Jollof Rice", price: 2500, category: "Rice", available: true });
  db.seed("menu_items", "m2", { restaurantId: "grills", name: "Salad", price: 1500, category: "Sides", available: false });
  db.seed("prepared_items", "p1", { restaurantId: "grills", name: "Suya", price: 3000, category: "Grill", available: true });
  db.seed("users", "u1", { restaurantSlug: "grills", displayName: "Bola", role: "owner", email: "bola@grills.ng" });

  // A DIFFERENT tenant that must never leak into "grills" context.
  db.seed("restaurants", "other", { name: "Other Spot", status: "active", subscriptionEndDate: future });
  db.seed("orders", "x1", {
    restaurantId: "other",
    customerName: "Foreign",
    phone: "+2349999999999",
    items: [{ name: "Pizza", quantity: 1, price: 99999 }],
    itemsTotal: 99999,
    deliveryFee: 0,
    total: 99999,
    paymentMethod: "cash",
    paymentStatus: "paid",
    status: "completed",
    orderSource: "online",
    serviceMode: "delivery",
    createdAt: recent,
  });
  db.seed("menu_items", "xm1", { restaurantId: "other", name: "Pizza", price: 99999, category: "Italian", available: true });

  return db;
}

async function main() {
  console.log("\n[Integration] AI foundation performs no core-collection writes\n");
  const now = () => new Date("2026-07-04T12:00:00Z");

  // --- Scenario 1: full context assembly + decision engine + usage persistence ---
  {
    const db = seedDb();
    const ctx = createIntelligenceContext("grills", {
      db: db as unknown as FirebaseFirestore.Firestore,
      now,
      requestId: "test-ctx-1",
      feature: "integration-test",
    });

    const context = await buildRestaurantContext(ctx, { range: { range: "week" } });
    const report = runDecisionEngine(context);
    const usage = await writeUsageRecord(ctx, { status: "ok", toolsRun: context.meta.toolsRun, degraded: context.meta.degraded });

    await ok("context assembled without throwing", () => {
      assert.ok(context.business, "business section present");
      assert.equal(context.restaurantSlug, "grills");
    });

    await ok("tenant isolation: only grills data (₦5,000, not ₦99,999)", () => {
      assert.equal(context.sales.summary?.totalRevenue, 5000, "revenue must exclude other tenant");
      assert.equal(context.business?.name, "Grills Capitol");
    });

    await ok("decision engine produced ranked insights with confidence levels", () => {
      assert.ok(Array.isArray(report.insights));
      report.insights.forEach((i) => assert.ok(["Very High", "High", "Medium", "Low"].includes(i.confidenceLevel)));
    });

    await ok("usage record persisted", () => {
      assert.ok(usage, "writeUsageRecord returned a record");
      assert.equal(usage!.feature, "integration-test");
    });

    await ok("EXACTLY ONE collection written, and it is ai_usage", () => {
      const written = db.writtenCollections();
      assert.deepEqual(written, [AI_USAGE_COLLECTION], `expected only [ai_usage], got [${written.join(", ")}]`);
    });

    await ok("NO core collection was ever written", () => {
      for (const c of CORE_COLLECTIONS) {
        const hits = db.writes.filter((w) => w.collection === c);
        assert.equal(hits.length, 0, `unexpected write(s) to "${c}": ${JSON.stringify(hits)}`);
      }
    });

    await ok("every recorded write is a 'set' to ai_usage", () => {
      for (const w of db.writes) {
        assert.equal(w.collection, "ai_usage");
        assert.equal(w.op, "set");
      }
    });
  }

  // --- Scenario 2: health-style single-tool read also writes only ai_usage ---
  {
    const db = seedDb();
    const ctx = createIntelligenceContext("grills", {
      db: db as unknown as FirebaseFirestore.Firestore,
      now,
      requestId: "test-health-1",
      feature: "health",
    });
    const profile = await getBusinessProfile(ctx);
    await writeUsageRecord(ctx, { status: "ok", note: "health probe" });

    await ok("health-style read returns tenant profile", () => {
      assert.equal(profile.data.name, "Grills Capitol");
    });
    await ok("health path writes only ai_usage", () => {
      assert.deepEqual(db.writtenCollections(), [AI_USAGE_COLLECTION]);
    });
  }

  // --- Scenario 3: a read-only run that never persists must write NOTHING ---
  {
    const db = seedDb();
    const ctx = createIntelligenceContext("grills", {
      db: db as unknown as FirebaseFirestore.Firestore,
      now,
      requestId: "test-readonly-1",
    });
    await buildRestaurantContext(ctx, { range: { range: "today" } });
    // no writeUsageRecord call

    await ok("pure read run performs ZERO writes", () => {
      assert.equal(db.writes.length, 0, `expected 0 writes, got ${db.writes.length}`);
    });
  }

  console.log(`\n✅ ALL ${passed} INTEGRATION CHECKS PASSED\n`);
}

main().catch((err) => {
  console.error("\n❌ INTEGRATION TEST FAILED\n", err);
  process.exit(1);
});
