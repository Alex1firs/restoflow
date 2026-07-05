/**
 * Daily AI Brief tests (fake Firestore + fake provider — no real LLM/DB).
 * Proves: grounded generation, tenant isolation, cost-control skip, manual
 * force-refresh, concurrent-generation dedupe, deterministic fallback, and that
 * generation writes ONLY ai_briefs + ai_usage (never a core collection).
 *
 * Run: npm run test:ai
 */
import assert from "node:assert";
import { FakeFirestore } from "./fake-firestore";
import { generateBrief, getBrief, lagosDateKey, BriefBusyError, AI_BRIEFS_COLLECTION } from "../brief";
import { AI_USAGE_COLLECTION } from "../usage";
import type { AiProvider, GenerateResult } from "../provider";

const CORE = ["restaurants", "orders", "payments", "menu_items", "prepared_items", "users"];
const now = () => new Date("2026-07-04T12:00:00Z");
const DATE_KEY = "2026-07-04"; // Lagos date for the above instant

let passed = 0;
async function ok(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

class FakeProvider implements AiProvider {
  readonly name = "anthropic" as const;
  readonly model = "fake-claude";
  readonly capabilities = ["reasoning" as const];
  calls = 0;
  lastPrompt = "";
  isConfigured() {
    return true;
  }
  async generate(prompt: string): Promise<GenerateResult> {
    this.calls++;
    this.lastPrompt = prompt;
    return { text: "Yesterday you did well.", provider: this.name, model: this.model, usage: { inputTokens: 120, outputTokens: 40, estimatedCostUsd: 0.0005 } };
  }
}

function seedDb(): FakeFirestore {
  const db = new FakeFirestore();
  const yesterday = new Date("2026-07-03T13:00:00Z");
  const dayBefore = new Date("2026-07-02T13:00:00Z");
  const future = { seconds: Math.floor((now().getTime() + 20 * 86_400_000) / 1000) };

  db.seed("restaurants", "grills", { name: "Grills Capitol", status: "active", subscriptionStatus: "active", subscriptionEndDate: future, deliveryEnabled: true, loyalty: { enabled: false } });
  // grills yesterday: ₦8,000; day-before: ₦4,000 (so there's a previous-period comparison)
  db.seed("orders", "o_y", {
    restaurantId: "grills", customerName: "Ada", phone: "+2348011112222",
    items: [{ name: "Jollof Rice", quantity: 2, price: 4000 }], itemsTotal: 8000, deliveryFee: 0, total: 8000,
    paymentMethod: "cash", paymentStatus: "paid", status: "completed", orderSource: "counter", serviceMode: "counter", staffName: "Bola", createdAt: yesterday,
  });
  db.seed("orders", "o_db", {
    restaurantId: "grills", customerName: "Ada", phone: "+2348011112222",
    items: [{ name: "Jollof Rice", quantity: 1, price: 4000 }], itemsTotal: 4000, deliveryFee: 0, total: 4000,
    paymentMethod: "cash", paymentStatus: "paid", status: "completed", orderSource: "counter", serviceMode: "counter", staffName: "Bola", createdAt: dayBefore,
  });
  db.seed("menu_items", "m1", { restaurantId: "grills", name: "Jollof Rice", price: 4000, category: "Rice", available: true });
  db.seed("prepared_items", "p1", { restaurantId: "grills", name: "Suya", price: 5000, category: "Grill", available: true });
  db.seed("users", "u1", { restaurantSlug: "grills", displayName: "Bola", role: "owner" });

  // Foreign tenant — must never leak into grills' brief.
  db.seed("restaurants", "other", { name: "Other Spot", subscriptionEndDate: future });
  db.seed("orders", "x1", {
    restaurantId: "other", customerName: "Foreign", phone: "+2349999999999",
    items: [{ name: "Pizza", quantity: 1, price: 99999 }], itemsTotal: 99999, deliveryFee: 0, total: 99999,
    paymentMethod: "cash", paymentStatus: "paid", status: "completed", orderSource: "online", serviceMode: "delivery", createdAt: yesterday,
  });
  return db;
}

function asDb(db: FakeFirestore) {
  return db as unknown as FirebaseFirestore.Firestore;
}

async function main() {
  console.log("\n[Brief] Daily AI Brief\n");

  await ok("lagosDateKey formats YYYY-MM-DD", () => assert.equal(lagosDateKey(now()), DATE_KEY));

  // --- Generation (AI mode) ---
  {
    const db = seedDb();
    const provider = new FakeProvider();
    const brief = await generateBrief("grills", { db: asDb(db), now, provider, requestId: "brief-1" });

    await ok("produces a complete brief with all sections", () => {
      assert.equal(brief.status, "complete");
      assert.equal(brief.restaurantId, "grills");
      assert.equal(brief.dateKey, DATE_KEY);
      assert.equal(brief.timeWindow.label, "yesterday");
      assert.ok(brief.summary.length > 0);
      assert.ok(Array.isArray(brief.highlights) && brief.highlights.length > 0);
      assert.ok(Array.isArray(brief.recommendations));
      assert.ok(Array.isArray(brief.anomalies));
      assert.equal(brief.mode, "ai");
      assert.equal(brief.modelUsed, "anthropic");
    });

    await ok("metrics reflect the yesterday window (₦8,000)", () => {
      assert.equal(brief.metrics.revenue, 8000);
      assert.ok(brief.metrics.revenueChangePct != null); // 8000 vs 4000 = +100%
    });

    await ok("confidence is a valid 0..1 with a level", () => {
      assert.ok(brief.confidence >= 0 && brief.confidence <= 1);
      assert.ok(["Very High", "High", "Medium", "Low"].includes(brief.confidenceLevel));
    });

    await ok("grounding contains grills data, never the other tenant", () => {
      assert.ok(provider.lastPrompt.includes("8000") || provider.lastPrompt.includes("8,000"));
      assert.ok(!provider.lastPrompt.includes("99999"));
      assert.ok(!provider.lastPrompt.toLowerCase().includes("pizza"));
    });

    await ok("writes ONLY ai_briefs + ai_usage (no core collections)", () => {
      const written = db.writtenCollections().sort();
      assert.deepEqual(written, [AI_BRIEFS_COLLECTION, AI_USAGE_COLLECTION].sort());
      for (const c of CORE) assert.equal(db.writes.filter((w) => w.collection === c).length, 0);
    });

    // --- Cost control: skip regeneration when today's brief exists ---
    await ok("second call without force returns cache (no new LLM call)", async () => {
      const before = provider.calls;
      const cached = await generateBrief("grills", { db: asDb(db), now, provider, requestId: "brief-1b" });
      assert.equal(provider.calls, before, "provider must NOT be called again");
      assert.equal(cached.dateKey, DATE_KEY);
      assert.equal(cached.status, "complete");
    });

    // --- Manual refresh forces regeneration ---
    await ok("force refresh regenerates (LLM called again)", async () => {
      const before = provider.calls;
      await generateBrief("grills", { db: asDb(db), now, provider, force: true, requestId: "brief-1c" });
      assert.equal(provider.calls, before + 1);
    });

    // --- getBrief reads the cached complete brief ---
    await ok("getBrief returns the cached brief", async () => {
      const got = await getBrief("grills", { db: asDb(db), now });
      assert.ok(got);
      assert.equal(got!.restaurantId, "grills");
    });
  }

  // --- Concurrency dedupe ---
  await ok("concurrent generation is de-duplicated (BriefBusyError)", async () => {
    const db = seedDb();
    // Simulate an in-flight generation with a fresh lock.
    db.seed(AI_BRIEFS_COLLECTION, `grills:${DATE_KEY}`, { restaurantId: "grills", dateKey: DATE_KEY, status: "generating", lockedAtMs: now().getTime() });
    await assert.rejects(
      () => generateBrief("grills", { db: asDb(db), now, provider: new FakeProvider() }),
      BriefBusyError
    );
  });

  // --- Deterministic fallback ---
  await ok("degrades deterministically without a provider", async () => {
    const db = seedDb();
    const brief = await generateBrief("grills", { db: asDb(db), now, provider: null, requestId: "brief-det" });
    assert.equal(brief.mode, "deterministic");
    assert.equal(brief.degraded, true);
    assert.equal(brief.modelUsed, null);
    assert.ok(brief.summary.includes("₦8,000"), brief.summary);
    // still only AI collections written
    const written = db.writtenCollections().sort();
    assert.deepEqual(written, [AI_BRIEFS_COLLECTION, AI_USAGE_COLLECTION].sort());
  });

  await ok("getBrief returns null when no brief exists", async () => {
    const db = seedDb();
    const got = await getBrief("grills", { db: asDb(db), now });
    assert.equal(got, null);
  });

  console.log(`\n✅ ALL ${passed} BRIEF CHECKS PASSED\n`);
}

main().catch((err) => {
  console.error("\n❌ BRIEF TEST FAILED\n", err);
  process.exit(1);
});
