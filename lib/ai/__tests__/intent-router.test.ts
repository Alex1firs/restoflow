/**
 * Deterministic Intent Router tests.
 *
 * Proves the fix for the "always returns the weekly revenue summary" bug:
 *   - detectIntent routes distinct questions to distinct intents
 *   - routeIntent dispatches each intent to its OWN handler → different responses
 *   - an unavailable intent (tax) says so explicitly, not a revenue summary
 *   - "worth attention" items are filtered to the detected intent
 *   - end-to-end through askAssistant (deterministic mode), the three canonical
 *     questions produce three different answers
 *
 * Run: npm run test:ai
 */
import assert from "node:assert";
import { FakeFirestore } from "./fake-firestore";
import { detectIntent, routeIntent, renderAnalytical, type AssistantIntent } from "../intent-router";
import { askAssistant } from "../assistant";
import type { RestaurantContext } from "../context";
import type { Insight } from "../types";

const now = () => new Date("2026-07-04T12:00:00Z");

let passed = 0;
async function ok(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// --- Test factories -------------------------------------------------------

function makeContext(over: Record<string, unknown>): RestaurantContext {
  const base = {
    generatedAt: "2026-07-04T12:00:00Z",
    restaurantSlug: "grills",
    range: { label: "today", from: "2026-07-04T00:00:00Z", to: "2026-07-04T23:59:59Z" },
    business: null,
    settings: null,
    sales: { summary: null, byHour: null },
    orders: null,
    menu: { analytics: null, topItems: null, slowItems: null },
    customers: null,
    staff: null,
    inventory: null,
    profile: null,
    reports: { kitchen: null, recentTransactions: null },
    meta: { toolsRun: [], toolsFailed: [], degraded: false, auditEventCount: 0 },
  };
  return { ...base, ...over } as unknown as RestaurantContext;
}

function insight(code: string, title: string, type: Insight["type"] = "warning"): Insight {
  return {
    type,
    severity: "medium",
    code,
    title,
    reason: "reason",
    suggestedAction: "take this action",
    confidence: 0.8,
    confidenceLevel: "High",
  };
}

// --- Seed for the end-to-end assertion ------------------------------------

function seedDb(): FakeFirestore {
  const db = new FakeFirestore();
  const today = new Date("2026-07-04T09:00:00Z");
  const earlier = new Date("2026-07-02T10:00:00Z");
  const future = { seconds: Math.floor((now().getTime() + 20 * 86_400_000) / 1000) };

  db.seed("restaurants", "grills", {
    name: "Grills Capitol",
    status: "active",
    subscriptionStatus: "active",
    subscriptionEndDate: future,
    deliveryEnabled: true,
    loyalty: { enabled: false },
  });
  db.seed("orders", "o_today", {
    restaurantId: "grills", customerName: "Ada", phone: "+2348011112222",
    items: [{ name: "Jollof Rice", quantity: 2, price: 2500 }],
    itemsTotal: 5000, deliveryFee: 0, total: 5000,
    paymentMethod: "cash", paymentStatus: "paid", status: "completed",
    orderSource: "counter", serviceMode: "counter", staffName: "Bola", createdAt: today,
  });
  db.seed("orders", "o_earlier", {
    restaurantId: "grills", customerName: "Ada", phone: "+2348011112222",
    items: [{ name: "Suya", quantity: 1, price: 5500 }],
    itemsTotal: 5500, deliveryFee: 0, total: 5500,
    paymentMethod: "online", paymentStatus: "paid", status: "completed",
    orderSource: "online", serviceMode: "delivery", createdAt: earlier,
  });
  db.seed("menu_items", "m1", { restaurantId: "grills", name: "Jollof Rice", price: 2500, category: "Rice", available: true });
  db.seed("prepared_items", "p1", { restaurantId: "grills", name: "Suya", price: 5500, category: "Grill", available: true });
  db.seed("users", "u1", { restaurantSlug: "grills", displayName: "Bola", role: "owner" });
  return db;
}

async function main() {
  console.log("\n[IntentRouter] Deterministic intent routing\n");

  // --- detectIntent: the three canonical questions route differently ---
  await ok("the three questions detect three DIFFERENT intents", () => {
    const a = detectIntent("What is my revenue this week?");
    const b = detectIntent("Is there any new order?");
    const c = detectIntent("Is there any tax for me to do?");
    assert.equal(a, "revenue");
    assert.equal(b, "orders");
    assert.equal(c, "tax");
    assert.equal(new Set([a, b, c]).size, 3, "expected three distinct intents");
  });

  await ok("detectIntent covers the full intent surface", () => {
    const cases: [string, AssistantIntent][] = [
      ["How much did we make yesterday?", "revenue"],
      ["Any orders come in today?", "orders"],
      ["Is there any VAT I need to remit?", "tax"],
      ["What's out of stock?", "inventory"],
      ["What should I buy from my supplier?", "purchasing"],
      ["What do you recommend I do to grow?", "recommendations"],
      ["How fast is the kitchen today?", "kitchen"],
      ["How is my staff performing?", "staff"],
      ["How many repeat customers do I have?", "customers"],
      ["When does my subscription renew?", "subscription"],
      ["What are my best sellers?", "menu"],
      ["Give me an overview of the business", "reports"],
      ["asdf qwerty zzz", "unknown"],
    ];
    for (const [q, expected] of cases) {
      assert.equal(detectIntent(q), expected, `"${q}" → expected ${expected}, got ${detectIntent(q)}`);
    }
  });

  // --- routeIntent: distinct handlers produce distinct responses ---
  await ok("routeIntent produces three different responses for the three questions", () => {
    const context = makeContext({
      sales: { summary: { totalOrders: 2, totalRevenue: 10500, paidOrders: 2, averageOrderValue: 5250, previous: { totalRevenue: 8000, totalOrders: 2, revenueChangePct: 31, ordersChangePct: 0 } }, byHour: null },
      orders: { total: 1, byStatus: { completed: 1 }, active: 0, revenueSoFar: 5000, latestOrders: [{ orderId: "o", orderNumber: 1, total: 5000, status: "completed", createdAt: "x", serviceMode: "counter" }] },
    });
    const revenueAns = routeIntent("revenue", context, []);
    const ordersAns = routeIntent("orders", context, []);
    const taxAns = routeIntent("tax", context, []);

    assert.notEqual(revenueAns, ordersAns);
    assert.notEqual(revenueAns, taxAns);
    assert.notEqual(ordersAns, taxAns);

    assert.ok(/made ₦10,500/.test(revenueAns), `revenue answer: ${revenueAns}`);
    assert.ok(/1 order today/.test(ordersAns), `orders answer: ${ordersAns}`);
    assert.ok(/doesn't track tax/i.test(taxAns), `tax answer: ${taxAns}`);
  });

  // --- Unavailable intent says so instead of an unrelated summary ---
  await ok("tax intent explicitly says it isn't tracked and returns NO revenue summary", () => {
    const context = makeContext({
      sales: { summary: { totalOrders: 2, totalRevenue: 10500, paidOrders: 2, averageOrderValue: 5250, previous: { totalRevenue: 8000, totalOrders: 2, revenueChangePct: 31, ordersChangePct: 0 } }, byHour: null },
    });
    const taxAns = routeIntent("tax", context, []);
    assert.ok(/doesn't track tax/i.test(taxAns));
    assert.ok(!taxAns.includes("₦"), `tax answer must not contain a money figure: ${taxAns}`);
    assert.ok(!/10,500/.test(taxAns), "tax answer must not leak the revenue figure");
  });

  // --- "worth attention" is scoped to the detected intent ---
  await ok("worth-attention items are filtered to the intent", () => {
    const insights = [insight("REVENUE_DROP", "Revenue dropped 20%"), insight("KITCHEN_SLOW", "Kitchen is slow")];
    const context = makeContext({
      sales: { summary: { totalOrders: 2, totalRevenue: 10500, paidOrders: 2, averageOrderValue: 5250, previous: { totalRevenue: 8000, totalOrders: 2, revenueChangePct: 31, ordersChangePct: 0 } }, byHour: null },
      reports: { kitchen: { avgPrepMinutes: 12, avgReadyMinutes: 18, ordersMeasured: 4, slowestReadyMinutes: 30, byStation: null }, recentTransactions: null },
    });

    const revenueAns = routeIntent("revenue", context, insights);
    const kitchenAns = routeIntent("kitchen", context, insights);

    // The revenue anomaly belongs to the revenue answer, NOT the kitchen answer.
    assert.ok(revenueAns.includes("Revenue dropped 20%"), `revenue answer should surface its anomaly: ${revenueAns}`);
    assert.ok(!revenueAns.includes("Kitchen is slow"), "revenue answer must not include the kitchen insight");
    assert.ok(kitchenAns.includes("Kitchen is slow"), `kitchen answer should surface its insight: ${kitchenAns}`);
    assert.ok(!kitchenAns.includes("Revenue dropped 20%"), "kitchen answer must NOT include the revenue anomaly");
  });

  // --- Richer analytical answers: the 5-part Answer→Insight→Prediction→Rec→Action shape ---
  await ok("revenue answer delivers analysis, not just a number", () => {
    const context = makeContext({
      generatedAt: "2026-07-04T12:00:00Z",
      range: { label: "week", from: "2026-06-28T00:00:00.000Z", to: "2026-07-04T23:59:59.999Z" },
      sales: { summary: { totalOrders: 2, totalRevenue: 10000, paidOrders: 2, averageOrderValue: 5000, previous: { totalRevenue: 11628, totalOrders: 2, revenueChangePct: -14, ordersChangePct: 0 } }, byHour: null },
      menu: { analytics: null, topItems: { items: [{ name: "Peppered Turkey", quantity: 3, revenue: 6200, orders: 2 }], totalItemsSold: 3 }, slowItems: null },
    });
    const ans = routeIntent("revenue", context, [insight("REVENUE_DROP", "Revenue dropped 14%")]);

    assert.ok(/made ₦10,000/.test(ans), `answer beat: ${ans}`);
    assert.ok(/down 14%/.test(ans), `insight: trend — ${ans}`);
    assert.ok(/Peppered Turkey drove 62%/.test(ans), `insight: contribution — ${ans}`);
    assert.ok(/Average order value is ₦5,000/.test(ans), `insight: AOV — ${ans}`);
    assert.ok(/on track for about ₦/.test(ans), `prediction: projection — ${ans}`);
    assert.ok(/Confidence:/.test(ans), `confidence beat — ${ans}`);
    // Action is context-aware: revenue dropped → offer to explain WHY (not a generic prompt).
    assert.ok(/explain why revenue dropped/i.test(ans), `context-aware action — ${ans}`);
  });

  await ok("confidence is Low with an honest basis when the trading day just started", () => {
    const context = makeContext({
      generatedAt: "2026-07-04T02:00:00Z", // ~2 hours into the day
      range: { label: "today", from: "2026-07-04T00:00:00.000Z", to: "2026-07-04T23:59:59.999Z" },
      sales: { summary: { totalOrders: 1, totalRevenue: 3000, paidOrders: 1, averageOrderValue: 3000, previous: { totalRevenue: 2000, totalOrders: 1, revenueChangePct: 50, ordersChangePct: 0 } }, byHour: null },
    });
    const ans = routeIntent("revenue", context, []);
    assert.ok(/Confidence: Low/.test(ans), `expected Low confidence early in the day: ${ans}`);
    assert.ok(/hour/.test(ans), `basis should reference hours of trading: ${ans}`);
  });

  await ok("actions are context-aware per intent (not a repeated generic prompt)", () => {
    const invCtx = makeContext({ inventory: { quantitativeStockTracked: false, totalItems: 10, availableItems: 8, unavailableItems: 2, outOfStock: [{ name: "Suya", category: "Grill", source: "prepared" }], byCategory: {} } });
    assert.ok(/open Smart Purchasing/i.test(routeIntent("inventory", invCtx, [])), "inventory → Smart Purchasing");

    const ordCtx = makeContext({ orders: { total: 3, byStatus: { completed: 3 }, active: 1, revenueSoFar: 9000, latestOrders: [{ orderId: "o", orderNumber: 1, total: 3000, status: "preparing", createdAt: "x", serviceMode: "counter" }] } });
    assert.ok(/open today's orders/i.test(routeIntent("orders", ordCtx, [])), "orders → open orders");
  });

  await ok("no-orders answer proactively offers to drive orders (Operations Manager)", () => {
    const context = makeContext({
      orders: { total: 0, byStatus: {}, active: 0, revenueSoFar: 0, latestOrders: [] },
      business: { isOpenNow: true, subscription: { planName: "Pro", status: "active", daysRemaining: 20, graceDaysRemaining: null, isOperational: true } },
    });
    const ans = routeIntent("orders", context, []);
    assert.ok(/no new orders/i.test(ans), ans);
    assert.ok(/promotion|drive orders/i.test(ans), `should propose an action: ${ans}`);
  });

  await ok("renderAnalytical skips empty beats and never leaves dangling gaps", () => {
    assert.equal(renderAnalytical({ answer: "A", actionPrompt: "B?" }), "A B?");
    assert.equal(renderAnalytical({ answer: "Only answer." }), "Only answer.");
  });

  // --- End-to-end through askAssistant (deterministic mode, no LLM) ---
  {
    const db = seedDb();
    const dbHandle = db as unknown as FirebaseFirestore.Firestore;
    const common = { db: dbHandle, now, provider: null, role: "owner" as const };

    const revenue = await askAssistant("grills", "What is my revenue this week?", { ...common, requestId: "ir-1" });
    const orders = await askAssistant("grills", "Is there any new order?", { ...common, requestId: "ir-2" });
    const tax = await askAssistant("grills", "Is there any tax for me to do?", { ...common, requestId: "ir-3" });

    await ok("all three run in deterministic mode", () => {
      assert.equal(revenue.mode, "deterministic");
      assert.equal(orders.mode, "deterministic");
      assert.equal(tax.mode, "deterministic");
    });

    await ok("the three answers are all DIFFERENT (no shared weekly-revenue fallback)", () => {
      assert.notEqual(revenue.answer, orders.answer);
      assert.notEqual(revenue.answer, tax.answer);
      assert.notEqual(orders.answer, tax.answer);
    });

    await ok("revenue answer is about revenue this week", () => {
      assert.equal(revenue.range.label, "week");
      assert.ok(/made ₦/.test(revenue.answer), revenue.answer);
    });

    await ok("orders answer is about today's orders (not a revenue summary)", () => {
      assert.ok(/order/i.test(orders.answer), orders.answer);
      assert.ok(!/made ₦\d/.test(orders.answer), `orders answer must not be the revenue summary: ${orders.answer}`);
    });

    await ok("tax answer explicitly says tax isn't tracked (not a revenue summary)", () => {
      assert.ok(/doesn't track tax/i.test(tax.answer), tax.answer);
      assert.ok(!tax.answer.includes("₦"), `tax answer must not contain a money figure: ${tax.answer}`);
    });

    await ok("routing writes ONLY ai_usage (no core-collection writes)", () => {
      assert.deepEqual(db.writtenCollections(), ["ai_usage"]);
    });
  }

  console.log(`\n✅ ALL ${passed} INTENT-ROUTER CHECKS PASSED\n`);
}

main().catch((err) => {
  console.error("\n❌ INTENT-ROUTER TEST FAILED\n", err);
  process.exit(1);
});
