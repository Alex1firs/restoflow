/**
 * Tests for the pre-Phase-2 improvements:
 *   1. Conversation memory (follow-up intent carry-forward, history in the prompt)
 *   2. Quick Actions catalog integrity
 *   3. Explain Dashboard (grounded re-fetch, tenant isolation, no core writes)
 *
 * Run: npm run test:ai
 */
import assert from "node:assert";
import { FakeFirestore } from "./fake-firestore";
import { askAssistant, resolveConversationalIntent, detectRange } from "../assistant";
import { QUICK_ACTIONS, getQuickAction } from "../quick-actions";
import { explainWidget, isWidgetType, WIDGET_REGISTRY } from "../explain";
import type { AiProvider, GenerateResult } from "../provider";

const CORE = ["restaurants", "orders", "payments", "menu_items", "prepared_items", "users"];
const now = () => new Date("2026-07-04T12:00:00Z");

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
  lastPrompt = "";
  isConfigured() {
    return true;
  }
  async generate(prompt: string): Promise<GenerateResult> {
    this.lastPrompt = prompt;
    return { text: "Answer.", provider: this.name, model: this.model, usage: { inputTokens: 50, outputTokens: 20, estimatedCostUsd: 0.0002 } };
  }
}

function seedDb(): FakeFirestore {
  const db = new FakeFirestore();
  const today = new Date("2026-07-04T09:00:00Z");
  const yesterday = new Date("2026-07-03T13:00:00Z");
  const future = { seconds: Math.floor((now().getTime() + 20 * 86_400_000) / 1000) };

  db.seed("restaurants", "grills", { name: "Grills Capitol", status: "active", subscriptionEndDate: future, deliveryEnabled: true, loyalty: { enabled: false } });
  db.seed("orders", "o_today", {
    restaurantId: "grills", customerName: "Ada", phone: "+2348011112222",
    items: [{ name: "Jollof Rice", quantity: 2, price: 2500 }], itemsTotal: 5000, deliveryFee: 0, total: 5000,
    paymentMethod: "cash", paymentStatus: "paid", status: "completed", orderSource: "counter", serviceMode: "counter", staffName: "Bola", createdAt: today,
  });
  db.seed("orders", "o_yday", {
    restaurantId: "grills", customerName: "Ada", phone: "+2348011112222",
    items: [{ name: "Suya", quantity: 1, price: 8000 }], itemsTotal: 8000, deliveryFee: 0, total: 8000,
    paymentMethod: "online", paymentStatus: "paid", status: "completed", orderSource: "online", serviceMode: "delivery", createdAt: yesterday,
  });
  db.seed("menu_items", "m1", { restaurantId: "grills", name: "Jollof Rice", price: 2500, category: "Rice", available: true });
  db.seed("prepared_items", "p1", { restaurantId: "grills", name: "Suya", price: 8000, category: "Grill", available: true });
  db.seed("users", "u1", { restaurantSlug: "grills", displayName: "Bola", role: "owner" });

  // Foreign tenant that must never leak.
  db.seed("restaurants", "other", { name: "Other Spot", subscriptionEndDate: future });
  db.seed("orders", "x1", {
    restaurantId: "other", customerName: "Foreign", phone: "+2349999999999",
    items: [{ name: "Pizza", quantity: 1, price: 99999 }], itemsTotal: 99999, deliveryFee: 0, total: 99999,
    paymentMethod: "cash", paymentStatus: "paid", status: "completed", orderSource: "online", serviceMode: "delivery", createdAt: today,
  });
  return db;
}

async function main() {
  console.log("\n[Improvements] conversation memory · quick actions · explain\n");

  // --- 1. Conversation memory (deterministic intent) ---
  await ok("detectRange finds explicit windows, null when absent", () => {
    assert.equal(detectRange("how much today"), "today");
    assert.equal(detectRange("sales yesterday"), "yesterday");
    assert.equal(detectRange("top items this week"), "week");
    assert.equal(detectRange("retention this month"), "month");
    assert.equal(detectRange("why?"), null);
  });

  await ok("follow-up 'Why?' inherits window + topic from prior turn", () => {
    const intent = resolveConversationalIntent("Why?", [
      { question: "How much revenue did we make this week?", answer: "You made ₦13,000." },
    ]);
    assert.equal(intent.isFollowUp, true);
    assert.equal(intent.range.range, "week");
    assert.ok(intent.topics.includes("revenue"), `topics: ${intent.topics.join(",")}`);
  });

  await ok("fresh question is not a follow-up and defaults to today", () => {
    const intent = resolveConversationalIntent("How much did we make?", []);
    assert.equal(intent.isFollowUp, false);
    assert.equal(intent.range.range, "today");
  });

  {
    const db = seedDb();
    const provider = new FakeProvider();
    const res = await askAssistant("grills", "Why?", {
      db: db as unknown as FirebaseFirestore.Firestore,
      now, provider, role: "owner", requestId: "imp-followup",
      history: [{ question: "How much did we make yesterday?", answer: "You made ₦8,000 yesterday." }],
    });
    await ok("end-to-end follow-up resolves to yesterday window (₦8,000)", () => {
      assert.equal(res.isFollowUp, true);
      assert.equal(res.range.label, "yesterday");
      assert.equal(res.data.sales.summary?.totalRevenue, 8000);
    });
    await ok("prior turn is included in the model prompt", () => {
      assert.ok(provider.lastPrompt.includes("Earlier in this conversation"));
      assert.ok(provider.lastPrompt.includes("₦8,000") || provider.lastPrompt.includes("8,000"));
    });
    await ok("follow-up still writes only ai_usage", () => {
      assert.deepEqual(db.writtenCollections(), ["ai_usage"]);
    });
  }

  // --- 2. Quick Actions ---
  await ok("quick actions catalog is well-formed", () => {
    assert.ok(QUICK_ACTIONS.length >= 7);
    const ids = new Set(QUICK_ACTIONS.map((a) => a.id));
    assert.equal(ids.size, QUICK_ACTIONS.length, "ids must be unique");
    for (const a of QUICK_ACTIONS) {
      assert.ok(a.question.length > 0 && a.label.length > 0 && a.icon.length > 0);
    }
    assert.equal(getQuickAction("revenue_today")?.label, "Revenue Today");
  });

  // --- 3. Explain Dashboard ---
  await ok("widget registry covers expected widgets; type guard works", () => {
    assert.ok(isWidgetType("revenue"));
    assert.ok(!isWidgetType("bogus"));
    assert.ok(Object.keys(WIDGET_REGISTRY).length >= 8);
  });

  {
    const db = seedDb();
    const provider = new FakeProvider();
    const res = await explainWidget("grills", "revenue", {
      db: db as unknown as FirebaseFirestore.Firestore,
      now, provider, role: "owner", requestId: "imp-explain",
      clientData: { displayedTotal: 5000 },
    });
    await ok("explain re-fetches authoritative revenue (₦5,000) via the tool layer", () => {
      const data = res.data as { totalRevenue: number };
      assert.equal(data.totalRevenue, 5000);
      assert.equal(res.mode, "ai");
    });
    await ok("explain grounding contains authoritative data, never the other tenant", () => {
      assert.ok(provider.lastPrompt.includes('"authoritativeData"'));
      assert.ok(!provider.lastPrompt.includes("99999"));
    });
    await ok("explain writes only ai_usage (no core-collection writes)", () => {
      assert.deepEqual(db.writtenCollections(), ["ai_usage"]);
      for (const c of CORE) assert.equal(db.writes.filter((w) => w.collection === c).length, 0);
    });
  }

  await ok("explain degrades deterministically without a provider", async () => {
    const db = seedDb();
    const res = await explainWidget("grills", "revenue", {
      db: db as unknown as FirebaseFirestore.Firestore,
      now, provider: null, role: "owner", requestId: "imp-explain-det",
    });
    assert.equal(res.mode, "deterministic");
    assert.ok(res.explanation.includes("₦5,000"), res.explanation);
  });

  console.log(`\n✅ ALL ${passed} IMPROVEMENT CHECKS PASSED\n`);
}

main().catch((err) => {
  console.error("\n❌ IMPROVEMENTS TEST FAILED\n", err);
  process.exit(1);
});
