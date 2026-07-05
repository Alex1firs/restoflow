/**
 * Restaurant Intelligence Assistant tests.
 *
 * Uses a fake Firestore (records writes) and a FAKE provider (captures the prompt
 * it was given — no real LLM). Proves:
 *   - answers are grounded ONLY in the tool layer / context builder
 *   - the model is given the tenant's real numbers and nothing from other tenants
 *   - time-window parsing works ("yesterday" → yesterday)
 *   - a deterministic fallback answer is produced when no provider is configured
 *   - answering writes ONLY to ai_usage (never a core collection)
 *
 * Run: npm run test:ai
 */
import assert from "node:assert";
import { FakeFirestore } from "./fake-firestore";
import { askAssistant, parseRange } from "../assistant";
import type { AiProvider, GenerateResult } from "../provider";

const CORE = ["restaurants", "orders", "payments", "menu_items", "prepared_items", "users"];
const now = () => new Date("2026-07-04T12:00:00Z");

let passed = 0;
async function ok(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

/** A fake reasoning provider that records the prompt and returns a canned answer. */
class FakeProvider implements AiProvider {
  readonly name = "anthropic" as const;
  readonly model = "fake-claude";
  readonly capabilities = ["reasoning" as const];
  lastPrompt = "";
  lastSystem = "";
  isConfigured() {
    return true;
  }
  async generate(prompt: string, opts: { system?: string } = {}): Promise<GenerateResult> {
    this.lastPrompt = prompt;
    this.lastSystem = opts.system ?? "";
    return {
      text: "Based on your data, here is the answer.",
      provider: this.name,
      model: this.model,
      usage: { inputTokens: 100, outputTokens: 30, estimatedCostUsd: 0.0004 },
    };
  }
}

function seedDb(): FakeFirestore {
  const db = new FakeFirestore();
  const today = new Date("2026-07-04T09:00:00Z");
  const yesterday = new Date("2026-07-03T13:00:00Z");
  const future = { seconds: Math.floor((now().getTime() + 20 * 86_400_000) / 1000) };

  db.seed("restaurants", "grills", {
    name: "Grills Capitol",
    status: "active",
    subscriptionStatus: "active",
    subscriptionEndDate: future,
    deliveryEnabled: true,
    loyalty: { enabled: false },
  });
  // grills: one order today (₦5,000), one yesterday (₦8,000)
  db.seed("orders", "o_today", {
    restaurantId: "grills", customerName: "Ada", phone: "+2348011112222",
    items: [{ name: "Jollof Rice", quantity: 2, price: 2500 }],
    itemsTotal: 5000, deliveryFee: 0, total: 5000,
    paymentMethod: "cash", paymentStatus: "paid", status: "completed",
    orderSource: "counter", serviceMode: "counter", staffName: "Bola", createdAt: today,
  });
  db.seed("orders", "o_yday", {
    restaurantId: "grills", customerName: "Ada", phone: "+2348011112222",
    items: [{ name: "Jollof Rice", quantity: 1, price: 2500 }, { name: "Suya", quantity: 1, price: 5500 }],
    itemsTotal: 8000, deliveryFee: 0, total: 8000,
    paymentMethod: "online", paymentStatus: "paid", status: "completed",
    orderSource: "online", serviceMode: "delivery", createdAt: yesterday,
  });
  db.seed("menu_items", "m1", { restaurantId: "grills", name: "Jollof Rice", price: 2500, category: "Rice", available: true });
  db.seed("menu_items", "m2", { restaurantId: "grills", name: "Salad", price: 1500, category: "Sides", available: false });
  db.seed("prepared_items", "p1", { restaurantId: "grills", name: "Suya", price: 5500, category: "Grill", available: true });
  db.seed("users", "u1", { restaurantSlug: "grills", displayName: "Bola", role: "owner" });

  // Another tenant that must never leak into grills' answers.
  db.seed("restaurants", "other", { name: "Other Spot", subscriptionEndDate: future });
  db.seed("orders", "x1", {
    restaurantId: "other", customerName: "Foreign", phone: "+2349999999999",
    items: [{ name: "Pizza", quantity: 1, price: 99999 }],
    itemsTotal: 99999, deliveryFee: 0, total: 99999,
    paymentMethod: "cash", paymentStatus: "paid", status: "completed",
    orderSource: "online", serviceMode: "delivery", createdAt: today,
  });

  return db;
}

async function main() {
  console.log("\n[Assistant] Restaurant Intelligence Assistant\n");

  await ok("parseRange detects time windows", () => {
    assert.equal(parseRange("how much did we make yesterday").range, "yesterday");
    assert.equal(parseRange("top items this week").range, "week");
    assert.equal(parseRange("repeat customers this month").range, "month");
    assert.equal(parseRange("how are we doing").range, "today");
  });

  // --- AI mode with a fake provider ---
  {
    const db = seedDb();
    const provider = new FakeProvider();
    const res = await askAssistant("grills", "How much did we make today?", {
      db: db as unknown as FirebaseFirestore.Firestore,
      now,
      provider,
      requestId: "asst-1",
      role: "owner",
    });

    await ok("returns an AI-mode answer", () => {
      assert.equal(res.mode, "ai");
      assert.equal(res.degraded, false);
      assert.ok(res.answer.length > 0);
      assert.equal(res.provider, "anthropic");
    });

    await ok("grounding given to the model contains the tenant's real revenue (₦5,000)", () => {
      assert.ok(provider.lastPrompt.includes('"totalRevenue":5000'), "prompt must contain grounded revenue");
    });

    await ok("grounding NEVER contains the other tenant's data (₦99,999)", () => {
      assert.ok(!provider.lastPrompt.includes("99999"), "cross-tenant figure leaked into prompt!");
      assert.ok(!provider.lastPrompt.toLowerCase().includes("pizza"), "cross-tenant item leaked into prompt!");
    });

    await ok("system prompt forbids invention", () => {
      assert.ok(/never invent/i.test(provider.lastSystem));
      assert.ok(/Restaurant Intelligence/.test(provider.lastSystem));
    });

    await ok("answer is grounded on real tools", () => {
      assert.ok(res.groundedOn.includes("getRevenueSummary"));
      assert.ok(res.data.sales.summary?.totalRevenue === 5000);
    });

    await ok("time window is today", () => assert.equal(res.range.label, "today"));

    await ok("usage reported", () => {
      assert.ok(res.usage && res.usage.tokensUsed > 0);
    });

    await ok("answering wrote ONLY ai_usage (no core-collection writes)", () => {
      assert.deepEqual(db.writtenCollections(), ["ai_usage"]);
      for (const c of CORE) assert.equal(db.writes.filter((w) => w.collection === c).length, 0);
    });
  }

  // --- "yesterday" question selects the yesterday window ---
  {
    const db = seedDb();
    const provider = new FakeProvider();
    const res = await askAssistant("grills", "Why were sales lower yesterday?", {
      db: db as unknown as FirebaseFirestore.Firestore,
      now,
      provider,
      requestId: "asst-2",
      role: "owner",
    });
    await ok("'yesterday' question uses yesterday window with ₦8,000", () => {
      assert.equal(res.range.label, "yesterday");
      assert.equal(res.data.sales.summary?.totalRevenue, 8000);
    });
    await ok("'why' question surfaces deterministic insights for grounding", () => {
      assert.ok(Array.isArray(res.insights));
      // insights section present in the model prompt
      assert.ok(provider.lastPrompt.includes('"insights"'));
    });
  }

  // --- Deterministic fallback when no provider is configured ---
  {
    const db = seedDb();
    const res = await askAssistant("grills", "How much did we make today?", {
      db: db as unknown as FirebaseFirestore.Firestore,
      now,
      provider: null, // simulate no LLM configured
      requestId: "asst-3",
      role: "owner",
    });
    await ok("degrades to a deterministic answer with the real number", () => {
      assert.equal(res.mode, "deterministic");
      assert.equal(res.degraded, true);
      assert.ok(res.answer.includes("₦5,000"), `expected ₦5,000 in: ${res.answer}`);
      assert.equal(res.provider, null);
    });
    await ok("deterministic path still writes only ai_usage", () => {
      assert.deepEqual(db.writtenCollections(), ["ai_usage"]);
    });
  }

  console.log(`\n✅ ALL ${passed} ASSISTANT CHECKS PASSED\n`);
}

main().catch((err) => {
  console.error("\n❌ ASSISTANT TEST FAILED\n", err);
  process.exit(1);
});
