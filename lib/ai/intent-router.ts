/**
 * Deterministic Intent Router
 * ===========================
 * Classifies a restaurant owner's question into ONE intent, then routes it to a
 * dedicated answer handler. This runs BEFORE any response generation so the
 * assistant never falls back to "here's your weekly revenue" for an unrelated
 * question (e.g. "Is there any tax for me to do?").
 *
 * Design:
 *  - Pure and side-effect-free: takes the already-assembled RestaurantContext +
 *    deterministic insights, returns a string. No Firestore, no LLM, no server-only.
 *  - Priority-ordered keyword detection (most specific intent wins).
 *  - Each handler surfaces ONLY the "worth attention" insights relevant to its
 *    intent — a kitchen answer never tacks on a revenue anomaly.
 *  - Intents whose data isn't part of the assistant context (tax, purchasing)
 *    say so explicitly instead of returning an unrelated summary.
 *
 * The vocabulary layer (`vocabulary.ts`) maps words → entities for grounding/tool
 * selection; THIS module maps a question → a single answer route. They are
 * complementary: entities can be many per question, the routed intent is exactly one.
 */

import type { RestaurantContext } from "./context";
import type { Insight } from "./types";

export type AssistantIntent =
  | "revenue"
  | "orders"
  | "tax"
  | "inventory"
  | "purchasing"
  | "recommendations"
  | "kitchen"
  | "staff"
  | "customers"
  | "subscription"
  | "menu"
  | "reports"
  | "unknown";

/**
 * Priority-ordered intent patterns. The FIRST match wins, so more specific /
 * narrower intents (tax, subscription) are listed before broad ones (revenue,
 * reports). Order is load-bearing — do not sort alphabetically.
 */
const INTENT_PATTERNS: { intent: AssistantIntent; pattern: RegExp }[] = [
  { intent: "tax", pattern: /\b(tax|taxes|taxation|vat|wht|withholding|firs|levy|levies|duty|remit|remittance|paye)\b/ },
  { intent: "subscription", pattern: /\b(subscription|subscribe|renew|renewal|billing|expir\w*|upgrade|downgrade|account status|plan\s+(status|renew|expir|end)\w*)\b/ },
  { intent: "purchasing", pattern: /\b(purchas\w*|re-?order\w*|restock\w*|procure\w*|supplier\w*|shopping list|what should i buy|buy more|need to buy|prep\s+(plan|list))\b/ },
  { intent: "recommendations", pattern: /\b(recommend\w*|suggest\w*|advice|advise|what should i do|how (can|do|should) i (improve|grow|do better)|opportunit\w*|any tips?)\b/ },
  { intent: "kitchen", pattern: /\b(kitchen|prep time|preparation|cooking|how fast|turnaround|ready time|back of house|prep\b)\b/ },
  { intent: "inventory", pattern: /\b(inventory|stock|out of stock|sold out|availability|available|unavailable|supplies|ingredient\w*)\b/ },
  { intent: "staff", pattern: /\b(staff|employee\w*|waiter\w*|waitress\w*|server\w*|cashier\w*|\bteam\b|worker\w*|attendant\w*)\b/ },
  { intent: "customers", pattern: /\b(customer\w*|guest\w*|diner\w*|patron\w*|loyalty|repeat|returning|regulars?|clients?)\b/ },
  { intent: "orders", pattern: /\b(orders?|tickets?|dockets?|chits?|new order|any order|how many order\w*)\b/ },
  { intent: "menu", pattern: /\b(menu|dishes?|best ?sell\w*|top (item|seller)\w*|slow mover\w*|dead stock|items?|meals?|\bfood\b)\b/ },
  { intent: "revenue", pattern: /\b(revenue|sales|takings|turnover|income|profit|earn\w*|made|make|money|how much did (i|we|you)|\baov\b|average order value|gross|gmv)\b/ },
  { intent: "reports", pattern: /\b(report\w*|summary|overview|dashboard|recap|snapshot|how (are|is|are we|is business|are things) \w*doing|how'?s business)\b/ },
];

/** Which deterministic insight codes are relevant to each intent's "worth attention" line. */
const INTENT_INSIGHT_CODES: Record<AssistantIntent, string[]> = {
  revenue: ["REVENUE_DROP", "REVENUE_SURGE", "NO_SALES_TODAY", "HIGH_CANCELLATION", "UNPAID_ORDERS", "PEAK_HOUR"],
  orders: ["NO_SALES_TODAY", "HIGH_CANCELLATION", "UNPAID_ORDERS", "PEAK_HOUR"],
  inventory: ["ITEMS_UNAVAILABLE", "MENU_LARGELY_UNAVAILABLE"],
  purchasing: ["ITEMS_UNAVAILABLE", "MENU_LARGELY_UNAVAILABLE", "SLOW_MOVERS"],
  kitchen: ["KITCHEN_SLOW"],
  customers: ["LOW_REPEAT_RATE", "LOYALTY_DISABLED", "UNREDEEMED_REWARDS"],
  subscription: ["SUBSCRIPTION_GRACE", "SUBSCRIPTION_EXPIRING"],
  menu: ["TOP_SELLER", "SLOW_MOVERS"],
  staff: [],
  recommendations: [],
  reports: [],
  tax: [],
  unknown: [],
};

/**
 * Classify a free-text question into exactly one intent. Deterministic — the same
 * question always routes the same way, regardless of whether an LLM is available.
 */
export function detectIntent(question: string): AssistantIntent {
  const q = ` ${question.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim()} `;
  for (const { intent, pattern } of INTENT_PATTERNS) {
    if (pattern.test(q)) return intent;
  }
  return "unknown";
}

/** Route a detected intent to its dedicated deterministic handler. */
export function routeIntent(intent: AssistantIntent, context: RestaurantContext, insights: Insight[]): string {
  switch (intent) {
    case "revenue": return answerRevenue(context, insights);
    case "orders": return answerOrders(context, insights);
    case "tax": return answerTax();
    case "inventory": return answerInventory(context, insights);
    case "purchasing": return answerPurchasing(context);
    case "recommendations": return answerRecommendations(insights);
    case "kitchen": return answerKitchen(context, insights);
    case "staff": return answerStaff(context);
    case "customers": return answerCustomers(context, insights);
    case "subscription": return answerSubscription(context, insights);
    case "menu": return answerMenu(context, insights);
    case "reports": return answerReports(context, insights);
    case "unknown": return answerUnknown();
  }
}

/** Detect intent AND answer it — the single entry point used by the assistant. */
export function answerByIntent(question: string, context: RestaurantContext, insights: Insight[]): string {
  return routeIntent(detectIntent(question), context, insights);
}

// ---------------------------------------------------------------------------
// Handlers — one focused answer per intent
// ---------------------------------------------------------------------------

function naira(n: number): string {
  return `₦${Math.round(n).toLocaleString("en-NG")}`;
}

/** The "worth attention" tail — ONLY insights whose code is relevant to this intent. */
function attention(intent: AssistantIntent, insights: Insight[]): string {
  const codes = new Set(INTENT_INSIGHT_CODES[intent]);
  const relevant = insights.filter((i) => codes.has(i.code)).slice(0, 2);
  if (relevant.length === 0) return "";
  return ` Worth attention: ${relevant.map((i) => i.title).join("; ")}.`;
}

function answerRevenue(context: RestaurantContext, insights: Insight[]): string {
  const label = context.range.label;
  const s = context.sales.summary;
  const parts: string[] = [];

  if (s && s.totalOrders > 0) {
    parts.push(
      `For ${label}, you made ${naira(s.totalRevenue)} from ${s.paidOrders} paid order${s.paidOrders === 1 ? "" : "s"} — that's an average of ${naira(s.averageOrderValue)} per order.`
    );
    if (s.previous.revenueChangePct != null) {
      const dir = s.previous.revenueChangePct >= 0 ? "up" : "down";
      parts.push(`That's ${dir} ${Math.abs(s.previous.revenueChangePct)}% versus the previous period (${naira(s.previous.totalRevenue)}).`);
    }
  } else if (context.orders && context.orders.revenueSoFar > 0) {
    parts.push(`No completed sales are logged for ${label} yet, but you've collected ${naira(context.orders.revenueSoFar)} so far today.`);
  } else {
    parts.push(`I couldn't find any completed sales for ${label}.`);
    const b = context.business;
    if (context.orders) parts.push(b?.isOpenNow ? `You're open, but no paid orders have come in yet.` : `The restaurant isn't marked open right now.`);
  }
  return (parts.join(" ") + attention("revenue", insights)).trim();
}

function answerOrders(context: RestaurantContext, insights: Insight[]): string {
  const o = context.orders;
  const parts: string[] = [];

  if (!o) {
    parts.push(`I don't have today's live order feed available right now.`);
  } else if (o.total === 0) {
    const open = context.business?.isOpenNow;
    parts.push(open ? `No new orders yet today — you're open and ready.` : `No orders today, and the restaurant isn't marked open.`);
  } else {
    parts.push(`You've had ${o.total} order${o.total === 1 ? "" : "s"} today, ${naira(o.revenueSoFar)} collected so far.`);
    if (o.active > 0) parts.push(`${o.active} ${o.active === 1 ? "is" : "are"} still in progress (pending, preparing, or ready).`);
    const latest = o.latestOrders?.[0];
    if (latest) parts.push(`The most recent is ${naira(latest.total)} (${latest.status}, ${latest.serviceMode}).`);
  }
  return (parts.join(" ") + attention("orders", insights)).trim();
}

function answerTax(): string {
  // Tax filing / VAT tracking is NOT modelled in RestoFlow — say so explicitly and
  // do NOT substitute an unrelated business summary (e.g. revenue) in its place.
  return [
    `RestoFlow doesn't track tax, VAT, or filing obligations yet, so I don't have any tax records, amounts owed, or due dates to show you.`,
    `That would need a dedicated bookkeeping or tax tool — I can't calculate or file it from here.`,
  ].join(" ");
}

function answerInventory(context: RestaurantContext, insights: Insight[]): string {
  const inv = context.inventory;
  const parts: string[] = [];

  if (!inv) {
    parts.push(`I don't have inventory availability data available right now.`);
  } else if (inv.unavailableItems === 0) {
    parts.push(`Everything's available — all ${inv.totalItems} item${inv.totalItems === 1 ? "" : "s"} are marked in stock.`);
    parts.push(`(RestoFlow tracks availability, not stock counts.)`);
  } else {
    const names = inv.outOfStock.slice(0, 5).map((i) => i.name).join(", ");
    parts.push(`${inv.unavailableItems} of ${inv.totalItems} item${inv.totalItems === 1 ? "" : "s"} are currently marked unavailable${names ? `: ${names}` : ""}.`);
    parts.push(`(RestoFlow tracks availability, not quantities.)`);
  }
  return (parts.join(" ") + attention("inventory", insights)).trim();
}

function answerPurchasing(context: RestaurantContext): string {
  // Purchasing plans live in the Smart Purchasing engine (forecast-driven), not in
  // the assistant context — point there rather than inventing quantities here.
  const parts = [
    `I don't generate purchasing plans from this chat — those come from your forecast on the Smart Purchasing card, which suggests what to buy and prep.`,
  ];
  const inv = context.inventory;
  if (inv && inv.unavailableItems > 0) {
    const names = inv.outOfStock.slice(0, 5).map((i) => i.name).join(", ");
    parts.push(`In the meantime, ${inv.unavailableItems} item${inv.unavailableItems === 1 ? " is" : "s are"} out and may be worth restocking${names ? `: ${names}` : ""}.`);
  }
  return parts.join(" ");
}

function answerRecommendations(insights: Insight[]): string {
  // Recommendations = the deterministic insights that carry a suggested action.
  const actionable = insights.filter((i) => i.suggestedAction && (i.type === "opportunity" || i.type === "warning" || i.type === "anomaly")).slice(0, 3);
  if (actionable.length === 0) {
    return `Nothing urgent stands out right now — no anomalies or opportunities in the current data. Keep an eye on your best sellers and repeat-customer rate.`;
  }
  const lines = actionable.map((i) => `${i.title} — ${i.suggestedAction}`);
  return `Here's what I'd act on: ${lines.join("; ")}.`;
}

function answerKitchen(context: RestaurantContext, insights: Insight[]): string {
  const k = context.reports.kitchen;
  const parts: string[] = [];

  if (!k || k.ordersMeasured === 0) {
    parts.push(`I don't have enough timed orders to measure kitchen speed for ${context.range.label} yet.`);
  } else {
    if (k.avgReadyMinutes != null) parts.push(`Kitchen is averaging ${k.avgReadyMinutes} min from order to ready across ${k.ordersMeasured} order${k.ordersMeasured === 1 ? "" : "s"}.`);
    else if (k.avgPrepMinutes != null) parts.push(`Kitchen is averaging ${k.avgPrepMinutes} min to start prep across ${k.ordersMeasured} order${k.ordersMeasured === 1 ? "" : "s"}.`);
    if (k.slowestReadyMinutes != null) parts.push(`The slowest ticket took ${k.slowestReadyMinutes} min.`);
  }
  return (parts.join(" ") + attention("kitchen", insights)).trim();
}

function answerStaff(context: RestaurantContext): string {
  const st = context.staff;
  if (!st || st.staffCount === 0) {
    return `I don't have staff performance data for ${context.range.label} — orders may not be attributed to individual staff.`;
  }
  const top = [...st.perStaff].sort((a, b) => b.revenue - a.revenue)[0];
  const parts = [`${st.staffCount} staff member${st.staffCount === 1 ? "" : "s"} handled orders in ${context.range.label}.`];
  if (top && top.orders > 0) parts.push(`${top.staffRef} leads with ${top.orders} order${top.orders === 1 ? "" : "s"} (${naira(top.revenue)}).`);
  return parts.join(" ");
}

function answerCustomers(context: RestaurantContext, insights: Insight[]): string {
  const c = context.customers;
  const parts: string[] = [];

  if (!c || c.totalCustomers === 0) {
    parts.push(`I don't have customer data for ${context.range.label} yet.`);
  } else {
    parts.push(`${c.totalCustomers} customer${c.totalCustomers === 1 ? "" : "s"} in ${context.range.label} — ${c.newCustomers} new and ${c.returningCustomers} returning (${Math.round(c.repeatRate * 100)}% repeat rate).`);
    if (c.loyalty?.enabled) parts.push(`Loyalty has ${c.loyalty.members} member${c.loyalty.members === 1 ? "" : "s"}.`);
  }
  return (parts.join(" ") + attention("customers", insights)).trim();
}

function answerSubscription(context: RestaurantContext, insights: Insight[]): string {
  const sub = context.business?.subscription;
  if (!sub) return `I don't have your subscription details available right now.`;
  const parts = [`Your ${sub.planName} plan is ${sub.status}.`];
  if (sub.daysRemaining != null) parts.push(`It renews in ${sub.daysRemaining} day${sub.daysRemaining === 1 ? "" : "s"}.`);
  if (sub.graceDaysRemaining != null && sub.graceDaysRemaining > 0) parts.push(`You're in a grace period with ${sub.graceDaysRemaining} day${sub.graceDaysRemaining === 1 ? "" : "s"} left.`);
  return (parts.join(" ") + attention("subscription", insights)).trim();
}

function answerMenu(context: RestaurantContext, insights: Insight[]): string {
  const top = context.menu.topItems?.items ?? [];
  const parts: string[] = [];

  if (top.length > 0 && top[0].quantity > 0) {
    const leader = top[0];
    parts.push(`${leader.name} is your best seller for ${context.range.label} with ${leader.quantity} sold (${naira(leader.revenue)}).`);
    const runnerUp = top[1];
    if (runnerUp && runnerUp.quantity > 0) parts.push(`${runnerUp.name} follows with ${runnerUp.quantity}.`);
  } else {
    parts.push(`I don't have enough sales in ${context.range.label} to rank your menu items yet.`);
  }
  const neverSold = context.menu.slowItems?.neverSold ?? [];
  if (neverSold.length > 0) parts.push(`${neverSold.length} item${neverSold.length === 1 ? " has" : "s have"} had no sales in this window.`);
  return (parts.join(" ") + attention("menu", insights)).trim();
}

function answerReports(context: RestaurantContext, insights: Insight[]): string {
  const label = context.range.label;
  const s = context.sales.summary;
  const parts: string[] = [];

  if (s && s.totalOrders > 0) {
    parts.push(`For ${label}: ${naira(s.totalRevenue)} from ${s.paidOrders} paid order${s.paidOrders === 1 ? "" : "s"} (avg ${naira(s.averageOrderValue)}).`);
    const top = context.menu.topItems?.items?.[0];
    if (top && top.quantity > 0) parts.push(`${top.name} is leading with ${top.quantity} sold.`);
  } else if (context.orders && context.orders.total > 0) {
    parts.push(`So far ${label}: ${context.orders.total} order${context.orders.total === 1 ? "" : "s"}, ${naira(context.orders.revenueSoFar)} collected.`);
  } else {
    parts.push(`It's quiet for ${label} — no completed sales logged yet.`);
  }
  const notable = insights.filter((i) => i.type === "warning" || i.type === "anomaly").slice(0, 2);
  if (notable.length > 0) parts.push(`Worth a look: ${notable.map((i) => i.title).join("; ")}.`);
  return parts.join(" ").trim();
}

function answerUnknown(): string {
  return [
    `I'm not sure which part of the business you're asking about.`,
    `I can help with revenue and sales, orders, your menu and best sellers, inventory availability, kitchen speed, staff, customers and loyalty, recommendations, and your subscription.`,
    `Try asking, for example, "How's revenue this week?" or "Any new orders?"`,
  ].join(" ");
}
