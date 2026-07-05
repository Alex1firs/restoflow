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
// Analytical answer structure
// ---------------------------------------------------------------------------
// Every analytical handler builds the SAME five beats so answers feel consistent
// and manager-grade — analysis, not just reporting:
//   answer         — the direct response to the question
//   insight        — what the number means / why it matters
//   prediction     — what's likely next if the trend continues
//   recommendation — what the owner should consider doing
//   actionPrompt   — offer to act ("Would you like …?")
// Empty beats are skipped, so a data-poor day still reads naturally.

export interface AnalyticalAnswer {
  answer: string;
  insight?: string;
  prediction?: string;
  recommendation?: string;
  actionPrompt?: string;
}

/** Render the five beats into flowing manager prose (safe for both chat and TTS). */
export function renderAnalytical(a: AnalyticalAnswer): string {
  return [a.answer, a.insight, a.prediction, a.recommendation, a.actionPrompt].filter(Boolean).join(" ").trim();
}

function naira(n: number): string {
  return `₦${Math.round(n).toLocaleString("en-NG")}`;
}

/**
 * Honest pace projection: extrapolate a window's running total to the whole window
 * using the elapsed fraction (now vs from→to). Returns null when the window is
 * essentially complete (no signal) or barely started (extrapolation would be wild),
 * or when we can't parse the clock — never fabricates.
 */
function paceProject(context: RestaurantContext, runningTotal: number): number | null {
  const from = Date.parse(context.range.from);
  const to = Date.parse(context.range.to);
  const nowMs = Date.parse(context.generatedAt);
  if (!Number.isFinite(from) || !Number.isFinite(to) || !Number.isFinite(nowMs) || to <= from) return null;
  const frac = (nowMs - from) / (to - from);
  // Trailing week/month windows sit ~0.9+ elapsed (only today is partial), so the
  // ceiling must stay high to still project them; past windows (frac ≥ 1) are excluded.
  if (frac < 0.15 || frac > 0.98) return null; // too early → wild; complete/past → no added signal
  return Math.round(runningTotal / frac / 100) * 100; // nearest ₦100
}

/** The recommendation + action beats, drawn from intent-relevant deterministic insights. */
function recommendationBeat(intent: AssistantIntent, insights: Insight[], improveWhat: string): Pick<AnalyticalAnswer, "recommendation" | "actionPrompt"> {
  const codes = new Set(INTENT_INSIGHT_CODES[intent]);
  const relevant = insights.filter((i) => codes.has(i.code) && i.suggestedAction).slice(0, 1);
  const out: Pick<AnalyticalAnswer, "recommendation" | "actionPrompt"> = {};
  if (relevant.length > 0) out.recommendation = `${relevant[0].title} — ${relevant[0].suggestedAction}.`;
  // Offer the recommendation set whenever the engine surfaced anything actionable.
  const anyActionable = insights.some((i) => i.suggestedAction && (i.type === "opportunity" || i.type === "warning" || i.type === "anomaly"));
  if (anyActionable) out.actionPrompt = `Would you like recommendations to improve ${improveWhat}?`;
  return out;
}

// ---------------------------------------------------------------------------
// Handlers — one focused, structured answer per intent
// ---------------------------------------------------------------------------

function answerRevenue(context: RestaurantContext, insights: Insight[]): string {
  const label = context.range.label;
  const s = context.sales.summary;

  if (!s || s.totalOrders === 0) {
    // No completed sales — stay useful and action-oriented rather than blunt.
    const a: AnalyticalAnswer = { answer: `You have no completed sales for ${label} yet.` };
    const b = context.business;
    if (context.orders && context.orders.revenueSoFar > 0) {
      a.insight = `That said, ${naira(context.orders.revenueSoFar)} is already collected on today's live orders.`;
    } else if (context.orders) {
      a.insight = b?.isOpenNow ? `You're open, but no paid orders have come in yet.` : `The restaurant isn't marked open right now.`;
    }
    a.actionPrompt = b?.isOpenNow ? `Would you like ideas to drive orders today?` : undefined;
    return renderAnalytical(a);
  }

  // Answer — the direct figure.
  const a: AnalyticalAnswer = {
    answer: `For ${label}, you've made ${naira(s.totalRevenue)} from ${s.paidOrders} completed order${s.paidOrders === 1 ? "" : "s"}.`,
  };

  // Insight — trend, top-item contribution, and AOV.
  const insightBits: string[] = [];
  if (s.previous.revenueChangePct != null) {
    const dir = s.previous.revenueChangePct >= 0 ? "up" : "down";
    insightBits.push(`That's ${dir} ${Math.abs(s.previous.revenueChangePct)}% versus the previous ${label} (${naira(s.previous.totalRevenue)}).`);
  }
  const top = context.menu.topItems?.items?.[0];
  if (top && top.revenue > 0 && s.totalRevenue > 0) {
    const share = Math.round((top.revenue / s.totalRevenue) * 100);
    if (share > 0) insightBits.push(`${top.name} drove ${share}% of it.`);
  }
  insightBits.push(`Average order value is ${naira(s.averageOrderValue)}.`);
  a.insight = insightBits.join(" ");

  // Prediction — honest pace projection.
  const projected = paceProject(context, s.totalRevenue);
  if (projected && projected > s.totalRevenue) {
    a.prediction = `At the current pace, ${label} is on track for about ${naira(projected)}.`;
  }

  // Recommendation + Action.
  Object.assign(a, recommendationBeat("revenue", insights, "it"));
  return renderAnalytical(a);
}

function answerOrders(context: RestaurantContext, insights: Insight[]): string {
  const o = context.orders;

  if (!o) return renderAnalytical({ answer: `I don't have today's live order feed available right now.` });

  if (o.total === 0) {
    const open = context.business?.isOpenNow;
    const a: AnalyticalAnswer = {
      answer: `No new orders have come in yet today.`,
      insight: open ? `You're open and ready — the kitchen is idle.` : `The restaurant isn't marked open right now.`,
    };
    if (open) a.actionPrompt = `Would you like ideas to bring orders in — say, a lunch promotion to recent customers?`;
    return renderAnalytical(a);
  }

  const a: AnalyticalAnswer = {
    answer: `You've had ${o.total} order${o.total === 1 ? "" : "s"} today, with ${naira(o.revenueSoFar)} collected so far.`,
  };
  const insightBits: string[] = [];
  if (o.active > 0) insightBits.push(`${o.active} ${o.active === 1 ? "is" : "are"} still in progress (pending, preparing, or ready).`);
  const latest = o.latestOrders?.[0];
  if (latest) insightBits.push(`The most recent is ${naira(latest.total)} (${latest.status}, ${latest.serviceMode}).`);
  if (insightBits.length) a.insight = insightBits.join(" ");

  // Prediction — project today's order count to end of day.
  const projected = paceProject(context, o.total);
  if (projected && projected > o.total) a.prediction = `At this pace you'll finish the day around ${projected} orders.`;

  Object.assign(a, recommendationBeat("orders", insights, "today"));
  return renderAnalytical(a);
}

function answerTax(): string {
  // Tax filing / VAT tracking is NOT modelled in RestoFlow — say so explicitly and
  // do NOT substitute an unrelated business summary (e.g. revenue) in its place.
  return renderAnalytical({
    answer: `RestoFlow doesn't track tax, VAT, or filing obligations yet, so I don't have any tax records, amounts owed, or due dates to show you.`,
    insight: `That would need a dedicated bookkeeping or tax tool — I can't calculate or file it from here.`,
  });
}

function answerInventory(context: RestaurantContext, insights: Insight[]): string {
  const inv = context.inventory;
  if (!inv) return renderAnalytical({ answer: `I don't have inventory availability data available right now.` });

  if (inv.unavailableItems === 0) {
    return renderAnalytical({
      answer: `Everything's available — all ${inv.totalItems} item${inv.totalItems === 1 ? "" : "s"} are marked in stock.`,
      insight: `(RestoFlow tracks availability, not stock counts, so this reflects what's switched on — not quantities on hand.)`,
    });
  }

  const names = inv.outOfStock.slice(0, 5).map((i) => i.name).join(", ");
  const a: AnalyticalAnswer = {
    answer: `${inv.unavailableItems} of ${inv.totalItems} item${inv.totalItems === 1 ? "" : "s"} ${inv.unavailableItems === 1 ? "is" : "are"} currently marked unavailable${names ? `: ${names}` : ""}.`,
    insight: `Each unavailable item is a dish customers can't order right now. (RestoFlow tracks availability, not quantities.)`,
  };
  Object.assign(a, recommendationBeat("inventory", insights, "availability"));
  if (!a.actionPrompt) a.actionPrompt = `Would you like to review these on the Smart Purchasing card?`;
  return renderAnalytical(a);
}

function answerPurchasing(context: RestaurantContext): string {
  // Purchasing plans live in the Smart Purchasing engine (forecast-driven), not in
  // the assistant context — point there rather than inventing quantities here.
  const a: AnalyticalAnswer = {
    answer: `I don't generate purchasing plans from this chat — those come from your forecast on the Smart Purchasing card, which suggests what to buy and prep.`,
  };
  const inv = context.inventory;
  if (inv && inv.unavailableItems > 0) {
    const names = inv.outOfStock.slice(0, 5).map((i) => i.name).join(", ");
    a.insight = `In the meantime, ${inv.unavailableItems} item${inv.unavailableItems === 1 ? " is" : "s are"} out and may be worth restocking${names ? `: ${names}` : ""}.`;
  }
  a.actionPrompt = `Would you like me to open the Smart Purchasing plan?`;
  return renderAnalytical(a);
}

function answerRecommendations(insights: Insight[]): string {
  // Recommendations = the deterministic insights that carry a suggested action.
  const actionable = insights.filter((i) => i.suggestedAction && (i.type === "opportunity" || i.type === "warning" || i.type === "anomaly")).slice(0, 3);
  if (actionable.length === 0) {
    return renderAnalytical({
      answer: `Nothing urgent stands out right now — no anomalies or opportunities in the current data.`,
      insight: `That usually means the business is steady. Keep an eye on your best sellers and repeat-customer rate.`,
    });
  }
  const lines = actionable.map((i) => `${i.title} — ${i.suggestedAction}`);
  return renderAnalytical({
    answer: `Here's what I'd act on: ${lines.join("; ")}.`,
    actionPrompt: `Would you like me to open the Recommendations to approve any of these?`,
  });
}

function answerKitchen(context: RestaurantContext, insights: Insight[]): string {
  const k = context.reports.kitchen;
  if (!k || k.ordersMeasured === 0) {
    return renderAnalytical({ answer: `I don't have enough timed orders to measure kitchen speed for ${context.range.label} yet.` });
  }

  const a: AnalyticalAnswer = { answer: "" };
  if (k.avgReadyMinutes != null) a.answer = `The kitchen is averaging ${k.avgReadyMinutes} min from order to ready across ${k.ordersMeasured} order${k.ordersMeasured === 1 ? "" : "s"}.`;
  else if (k.avgPrepMinutes != null) a.answer = `The kitchen is averaging ${k.avgPrepMinutes} min to start prep across ${k.ordersMeasured} order${k.ordersMeasured === 1 ? "" : "s"}.`;
  else a.answer = `I have ${k.ordersMeasured} timed order${k.ordersMeasured === 1 ? "" : "s"} but no usable prep timings.`;
  if (k.slowestReadyMinutes != null) a.insight = `The slowest ticket took ${k.slowestReadyMinutes} min.`;
  Object.assign(a, recommendationBeat("kitchen", insights, "kitchen speed"));
  return renderAnalytical(a);
}

function answerStaff(context: RestaurantContext): string {
  const st = context.staff;
  if (!st || st.staffCount === 0) {
    return renderAnalytical({ answer: `I don't have staff performance data for ${context.range.label} — orders may not be attributed to individual staff.` });
  }
  const sorted = [...st.perStaff].sort((a, b) => b.revenue - a.revenue);
  const top = sorted[0];
  const a: AnalyticalAnswer = { answer: `${st.staffCount} staff member${st.staffCount === 1 ? "" : "s"} handled orders in ${context.range.label}.` };
  if (top && top.orders > 0) {
    a.insight = `${top.staffRef} leads with ${top.orders} order${top.orders === 1 ? "" : "s"} (${naira(top.revenue)}, avg ${naira(top.averageOrderValue)}).`;
  }
  return renderAnalytical(a);
}

function answerCustomers(context: RestaurantContext, insights: Insight[]): string {
  const c = context.customers;
  if (!c || c.totalCustomers === 0) {
    return renderAnalytical({ answer: `I don't have customer data for ${context.range.label} yet.` });
  }
  const repeatPct = Math.round(c.repeatRate * 100);
  const a: AnalyticalAnswer = {
    answer: `${c.totalCustomers} customer${c.totalCustomers === 1 ? "" : "s"} ordered in ${context.range.label} — ${c.newCustomers} new and ${c.returningCustomers} returning.`,
    insight: `Your repeat rate is ${repeatPct}%${c.loyalty?.enabled ? `, with ${c.loyalty.members} loyalty member${c.loyalty.members === 1 ? "" : "s"}` : ""}.`,
  };
  Object.assign(a, recommendationBeat("customers", insights, "repeat orders"));
  return renderAnalytical(a);
}

function answerSubscription(context: RestaurantContext, insights: Insight[]): string {
  const sub = context.business?.subscription;
  if (!sub) return renderAnalytical({ answer: `I don't have your subscription details available right now.` });
  const a: AnalyticalAnswer = { answer: `Your ${sub.planName} plan is ${sub.status}.` };
  const bits: string[] = [];
  if (sub.daysRemaining != null) bits.push(`It renews in ${sub.daysRemaining} day${sub.daysRemaining === 1 ? "" : "s"}.`);
  if (sub.graceDaysRemaining != null && sub.graceDaysRemaining > 0) bits.push(`You're in a grace period with ${sub.graceDaysRemaining} day${sub.graceDaysRemaining === 1 ? "" : "s"} left.`);
  if (bits.length) a.insight = bits.join(" ");
  Object.assign(a, recommendationBeat("subscription", insights, "your account"));
  return renderAnalytical(a);
}

function answerMenu(context: RestaurantContext, insights: Insight[]): string {
  const top = context.menu.topItems?.items ?? [];
  if (!(top.length > 0 && top[0].quantity > 0)) {
    return renderAnalytical({ answer: `I don't have enough sales in ${context.range.label} to rank your menu items yet.` });
  }
  const leader = top[0];
  const a: AnalyticalAnswer = {
    answer: `${leader.name} is your best seller for ${context.range.label} with ${leader.quantity} sold (${naira(leader.revenue)}).`,
  };
  const bits: string[] = [];
  const total = context.sales.summary?.totalRevenue ?? 0;
  if (total > 0 && leader.revenue > 0) {
    const share = Math.round((leader.revenue / total) * 100);
    if (share > 0) bits.push(`That's ${share}% of revenue.`);
  }
  const runnerUp = top[1];
  if (runnerUp && runnerUp.quantity > 0) bits.push(`${runnerUp.name} follows with ${runnerUp.quantity} sold.`);
  const neverSold = context.menu.slowItems?.neverSold ?? [];
  if (neverSold.length > 0) bits.push(`${neverSold.length} item${neverSold.length === 1 ? " has" : "s have"} had no sales in this window.`);
  if (bits.length) a.insight = bits.join(" ");
  Object.assign(a, recommendationBeat("menu", insights, "your menu mix"));
  return renderAnalytical(a);
}

function answerReports(context: RestaurantContext, insights: Insight[]): string {
  const label = context.range.label;
  const s = context.sales.summary;

  if (s && s.totalOrders > 0) {
    const a: AnalyticalAnswer = {
      answer: `For ${label}: ${naira(s.totalRevenue)} from ${s.paidOrders} completed order${s.paidOrders === 1 ? "" : "s"} (avg ${naira(s.averageOrderValue)}).`,
    };
    const bits: string[] = [];
    if (s.previous.revenueChangePct != null) {
      const dir = s.previous.revenueChangePct >= 0 ? "up" : "down";
      bits.push(`That's ${dir} ${Math.abs(s.previous.revenueChangePct)}% versus the previous ${label}.`);
    }
    const top = context.menu.topItems?.items?.[0];
    if (top && top.quantity > 0) bits.push(`${top.name} is leading with ${top.quantity} sold.`);
    if (bits.length) a.insight = bits.join(" ");
    const projected = paceProject(context, s.totalRevenue);
    if (projected && projected > s.totalRevenue) a.prediction = `At the current pace, ${label} is on track for about ${naira(projected)}.`;
    const notable = insights.filter((i) => i.type === "warning" || i.type === "anomaly").slice(0, 1)[0];
    if (notable) a.recommendation = `${notable.title}${notable.suggestedAction ? ` — ${notable.suggestedAction}.` : "."}`;
    a.actionPrompt = `What would you like to do first — recommendations, orders, or the forecast?`;
    return renderAnalytical(a);
  }

  if (context.orders && context.orders.total > 0) {
    return renderAnalytical({
      answer: `So far ${label}: ${context.orders.total} order${context.orders.total === 1 ? "" : "s"}, ${naira(context.orders.revenueSoFar)} collected.`,
      actionPrompt: `What would you like to look at first?`,
    });
  }

  return renderAnalytical({
    answer: `It's quiet for ${label} — no completed sales logged yet.`,
    actionPrompt: context.business?.isOpenNow ? `Would you like ideas to drive orders today?` : undefined,
  });
}

function answerUnknown(): string {
  return renderAnalytical({
    answer: `I'm not sure which part of the business you're asking about.`,
    insight: `I can help with revenue and sales, orders, your menu and best sellers, inventory availability, kitchen speed, staff, customers and loyalty, recommendations, and your subscription.`,
    actionPrompt: `Try asking, for example, "How's revenue this week?" or "Any new orders?"`,
  });
}
