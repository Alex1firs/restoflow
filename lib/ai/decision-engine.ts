import type { ConfidenceLevel, DecisionReport, Insight, InsightType } from "./types";
import type { RestaurantContext } from "./context";

/** An insight before the standardised confidence band is stamped on. */
type RawInsight = Omit<Insight, "confidenceLevel">;

/**
 * Map a numeric confidence (0..1) to a user-friendly band. Thresholds are the
 * single source of truth for how scores read to non-technical restaurant staff.
 */
export function confidenceToLevel(score: number): ConfidenceLevel {
  if (score >= 0.85) return "Very High";
  if (score >= 0.7) return "High";
  if (score >= 0.5) return "Medium";
  return "Low";
}

/**
 * Decision Engine
 * ===============
 * Deterministic business rules over the assembled RestaurantContext. This module
 * uses NO LLM and does NO natural-language generation — every `reason` and
 * `suggestedAction` is a template filled from the numbers. It classifies signals
 * into: anomaly | trend | opportunity | warning | highlight, each with a
 * heuristic confidence score.
 *
 * Later phases (Daily Brief, Recommendations) can feed these structured insights
 * to an LLM for narration, but the *judgement* stays here — auditable and
 * testable — rather than in a prompt.
 */

// ---------------------------------------------------------------------------
// Tunable thresholds (single source of truth for every rule)
// ---------------------------------------------------------------------------

export const THRESHOLDS = {
  revenueDropPct: -25, // % change vs previous window that counts as a drop
  revenueSurgePct: 25,
  highCancellationRate: 0.15,
  minOrdersForRateRules: 5,
  slowKitchenReadyMinutes: 30,
  minOrdersForKitchen: 5,
  subscriptionWarnDays: 5,
  lowRepeatRate: 0.2,
  minCustomersForRepeat: 10,
  menuUnavailableShare: 0.2, // 20% of menu marked unavailable
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Heuristic confidence: stronger signal + larger sample → higher confidence.
 * @param strength  0..1 how strongly the rule fired (e.g. how far past threshold)
 * @param sample    number of records the signal is based on
 * @param needed    sample size at which we consider the signal fully trustworthy
 */
function scoreConfidence(strength: number, sample: number, needed: number): number {
  const s = clamp(strength, 0, 1);
  const adequacy = clamp(sample / Math.max(1, needed), 0, 1);
  const raw = (0.55 + 0.4 * s) * (0.6 + 0.4 * adequacy);
  return round2(clamp(raw, 0, 0.98));
}

function fmtNaira(n: number): string {
  return `₦${Math.round(n).toLocaleString("en-NG")}`;
}

// ---------------------------------------------------------------------------
// Rules — each takes the context and returns 0..n insights
// ---------------------------------------------------------------------------

type Rule = (c: RestaurantContext) => RawInsight[];

const revenueTrendRule: Rule = (c) => {
  const s = c.sales.summary;
  if (!s || s.previous.revenueChangePct == null) return [];
  const pct = s.previous.revenueChangePct;
  const sample = s.totalOrders + s.previous.totalOrders;

  if (pct <= THRESHOLDS.revenueDropPct) {
    const strength = clamp(Math.abs(pct) / 100, 0, 1);
    return [
      {
        type: "warning",
        severity: pct <= -50 ? "high" : "medium",
        code: "REVENUE_DROP",
        title: `Revenue down ${Math.abs(pct)}% vs previous period`,
        reason: `Paid revenue was ${fmtNaira(s.totalRevenue)} this period vs ${fmtNaira(s.previous.totalRevenue)} previously (${pct}%).`,
        suggestedAction: "Review order volume, opening hours, and any recently unavailable menu items.",
        confidence: scoreConfidence(strength, sample, 20),
        metrics: { changePct: pct, current: s.totalRevenue, previous: s.previous.totalRevenue },
      },
    ];
  }
  if (pct >= THRESHOLDS.revenueSurgePct) {
    const strength = clamp(pct / 100, 0, 1);
    return [
      {
        type: "highlight",
        severity: "info",
        code: "REVENUE_SURGE",
        title: `Revenue up ${pct}% vs previous period`,
        reason: `Paid revenue rose to ${fmtNaira(s.totalRevenue)} from ${fmtNaira(s.previous.totalRevenue)} (${pct}%).`,
        suggestedAction: "Ensure stock and staffing can sustain the higher volume.",
        confidence: scoreConfidence(strength, sample, 20),
        metrics: { changePct: pct, current: s.totalRevenue, previous: s.previous.totalRevenue },
      },
    ];
  }
  return [];
};

const noSalesTodayRule: Rule = (c) => {
  const o = c.orders;
  const b = c.business;
  if (!o) return [];
  // Only meaningful when the shop is open and operational.
  if (o.total === 0 && b?.isOpenNow && b.subscription.isOperational) {
    return [
      {
        type: "anomaly",
        severity: "high",
        code: "NO_SALES_TODAY",
        title: "No orders yet today while open",
        reason: "The restaurant is currently open but has zero orders recorded today.",
        suggestedAction: "Confirm the storefront is live and reachable, and that staff can take orders.",
        confidence: 0.8,
        metrics: { ordersToday: 0 },
      },
    ];
  }
  return [];
};

const cancellationRule: Rule = (c) => {
  const s = c.sales.summary;
  if (!s || s.totalOrders < THRESHOLDS.minOrdersForRateRules) return [];
  if (s.cancellationRate >= THRESHOLDS.highCancellationRate) {
    const strength = clamp(s.cancellationRate / 0.5, 0, 1);
    return [
      {
        type: "warning",
        severity: s.cancellationRate >= 0.3 ? "high" : "medium",
        code: "HIGH_CANCELLATION",
        title: `High cancellation rate (${Math.round(s.cancellationRate * 100)}%)`,
        reason: `${s.cancelled} of ${s.totalOrders} orders were rejected/cancelled (${fmtNaira(s.cancelledTotal)} lost).`,
        suggestedAction: "Investigate stockouts, delivery-zone coverage, or payment failures driving cancellations.",
        confidence: scoreConfidence(strength, s.totalOrders, 20),
        metrics: { cancellationRate: s.cancellationRate, cancelled: s.cancelled, totalOrders: s.totalOrders },
      },
    ];
  }
  return [];
};

const topSellerRule: Rule = (c) => {
  const top = c.menu.topItems?.items?.[0];
  if (!top || top.quantity === 0) return [];
  return [
    {
      type: "highlight",
      severity: "info",
      code: "TOP_SELLER",
      title: `Top seller: ${top.name}`,
      reason: `${top.name} sold ${top.quantity} units (${fmtNaira(top.revenue)}) this period.`,
      suggestedAction: "Feature it prominently and ensure its ingredients stay in stock.",
      confidence: scoreConfidence(clamp(top.quantity / 50, 0, 1), top.orders, 10),
      metrics: { item: top.name, quantity: top.quantity, revenue: top.revenue },
    },
  ];
};

const slowMoverRule: Rule = (c) => {
  const slow = c.menu.slowItems;
  if (!slow) return [];
  const never = slow.neverSold ?? [];
  if (never.length === 0) return [];
  const preview = never.slice(0, 5).join(", ");
  return [
    {
      type: "opportunity",
      severity: "low",
      code: "SLOW_MOVERS",
      title: `${never.length} menu item(s) had no sales`,
      reason: `These items sold nothing this period: ${preview}${never.length > 5 ? ", …" : ""}.`,
      suggestedAction: "Consider promoting, repricing, bundling, or retiring these items.",
      confidence: scoreConfidence(clamp(never.length / 10, 0, 1), never.length, 5),
      metrics: { neverSoldCount: never.length },
    },
  ];
};

const kitchenSpeedRule: Rule = (c) => {
  const k = c.reports.kitchen;
  if (!k || k.avgReadyMinutes == null || k.ordersMeasured < THRESHOLDS.minOrdersForKitchen) return [];
  if (k.avgReadyMinutes > THRESHOLDS.slowKitchenReadyMinutes) {
    const strength = clamp((k.avgReadyMinutes - THRESHOLDS.slowKitchenReadyMinutes) / 30, 0, 1);
    return [
      {
        type: "warning",
        severity: k.avgReadyMinutes > 45 ? "high" : "medium",
        code: "KITCHEN_SLOW",
        title: `Average prep time is ${k.avgReadyMinutes} min`,
        reason: `Across ${k.ordersMeasured} measured orders, received→ready averaged ${k.avgReadyMinutes} min (slowest ${k.slowestReadyMinutes ?? "?"} min).`,
        suggestedAction: "Review kitchen staffing at peak hours and simplify slow-prep items.",
        confidence: scoreConfidence(strength, k.ordersMeasured, 20),
        metrics: { avgReadyMinutes: k.avgReadyMinutes, ordersMeasured: k.ordersMeasured },
      },
    ];
  }
  return [];
};

const peakHourRule: Rule = (c) => {
  const h = c.sales.byHour;
  if (!h || h.peakHour == null) return [];
  const bucket = h.hours[h.peakHour];
  if (!bucket || bucket.orders === 0) return [];
  return [
    {
      type: "trend",
      severity: "info",
      code: "PEAK_HOUR",
      title: `Busiest hour is ${formatHour(h.peakHour)}`,
      reason: `${formatHour(h.peakHour)} sees the most orders (${bucket.orders}) over the analysed window.`,
      suggestedAction: `Schedule more staff and pre-prep before ${formatHour(h.peakHour)}.`,
      confidence: scoreConfidence(0.6, bucket.orders, 20),
      metrics: { peakHour: h.peakHour, orders: bucket.orders, revenue: bucket.revenue },
    },
  ];
};

const subscriptionRule: Rule = (c) => {
  const sub = c.business?.subscription;
  if (!sub) return [];
  if (sub.status === "grace_period") {
    return [
      {
        type: "warning",
        severity: "critical",
        code: "SUBSCRIPTION_GRACE",
        title: "Subscription in grace period",
        reason: `The subscription has expired and is in its grace window (${sub.graceDaysRemaining ?? "?"} day(s) left) before service is suspended.`,
        suggestedAction: "Renew the subscription now to avoid interruption.",
        confidence: 0.98,
        metrics: { graceDaysRemaining: sub.graceDaysRemaining },
      },
    ];
  }
  if (sub.daysRemaining != null && sub.daysRemaining <= THRESHOLDS.subscriptionWarnDays) {
    return [
      {
        type: "warning",
        severity: sub.daysRemaining <= 2 ? "high" : "medium",
        code: "SUBSCRIPTION_EXPIRING",
        title: `Subscription renews in ${sub.daysRemaining} day(s)`,
        reason: `The ${sub.planName} plan ends in ${sub.daysRemaining} day(s).`,
        suggestedAction: "Confirm billing details so service continues uninterrupted.",
        confidence: 0.95,
        metrics: { daysRemaining: sub.daysRemaining },
      },
    ];
  }
  return [];
};

const outOfStockRule: Rule = (c) => {
  const inv = c.inventory;
  if (!inv || inv.outOfStock.length === 0) return [];
  const preview = inv.outOfStock.slice(0, 5).map((i) => i.name).join(", ");
  return [
    {
      type: "warning",
      severity: inv.outOfStock.length >= 5 ? "medium" : "low",
      code: "ITEMS_UNAVAILABLE",
      title: `${inv.outOfStock.length} item(s) marked unavailable`,
      reason: `Currently unavailable: ${preview}${inv.outOfStock.length > 5 ? ", …" : ""}.`,
      suggestedAction: "Restock and re-enable these items, or hide them to avoid disappointing customers.",
      confidence: 0.9,
      metrics: { unavailableItems: inv.unavailableItems, totalItems: inv.totalItems },
    },
  ];
};

const repeatRateRule: Rule = (c) => {
  const cu = c.customers;
  if (!cu || cu.totalCustomers < THRESHOLDS.minCustomersForRepeat) return [];
  if (cu.repeatRate < THRESHOLDS.lowRepeatRate) {
    const strength = clamp((THRESHOLDS.lowRepeatRate - cu.repeatRate) / THRESHOLDS.lowRepeatRate, 0, 1);
    return [
      {
        type: "opportunity",
        severity: "medium",
        code: "LOW_REPEAT_RATE",
        title: `Low repeat rate (${Math.round(cu.repeatRate * 100)}%)`,
        reason: `Only ${cu.returningCustomers} of ${cu.totalCustomers} customers this period were returning.`,
        suggestedAction: cu.loyalty?.enabled
          ? "Promote your loyalty rewards to convert first-time buyers into regulars."
          : "Enable the loyalty program to encourage repeat orders.",
        confidence: scoreConfidence(strength, cu.totalCustomers, 30),
        metrics: { repeatRate: cu.repeatRate, returning: cu.returningCustomers, total: cu.totalCustomers },
      },
    ];
  }
  return [];
};

const loyaltyRule: Rule = (c) => {
  const cu = c.customers;
  if (!cu || !cu.loyalty) return [];
  const out: RawInsight[] = [];
  if (!cu.loyalty.enabled) {
    out.push({
      type: "opportunity",
      severity: "low",
      code: "LOYALTY_DISABLED",
      title: "Loyalty program is off",
      reason: "No loyalty program is active, so repeat purchasing isn't being incentivised.",
      suggestedAction: "Turn on the punch-card loyalty program in settings.",
      confidence: 0.7,
      metrics: { members: cu.loyalty.members },
    });
  } else if (cu.loyalty.unredeemedRewards > 0) {
    out.push({
      type: "opportunity",
      severity: "info",
      code: "UNREDEEMED_REWARDS",
      title: `${cu.loyalty.unredeemedRewards} unredeemed reward(s) outstanding`,
      reason: `${cu.loyalty.unredeemedRewards} earned reward(s) across ${cu.loyalty.members} members are unredeemed — a reason for customers to return.`,
      suggestedAction: "Remind eligible customers to claim their rewards.",
      confidence: 0.75,
      metrics: { unredeemedRewards: cu.loyalty.unredeemedRewards, members: cu.loyalty.members },
    });
  }
  return out;
};

const unpaidOrdersRule: Rule = (c) => {
  const s = c.sales.summary;
  if (!s || s.unpaidTotal <= 0) return [];
  // Only flag if unpaid is material relative to paid revenue.
  const share = s.totalRevenue > 0 ? s.unpaidTotal / (s.totalRevenue + s.unpaidTotal) : 1;
  if (share < 0.1) return [];
  return [
    {
      type: "warning",
      severity: share >= 0.3 ? "medium" : "low",
      code: "UNPAID_ORDERS",
      title: `${fmtNaira(s.unpaidTotal)} in unpaid/part-paid orders`,
      reason: `Outstanding unpaid or part-paid orders total ${fmtNaira(s.unpaidTotal)} (${Math.round(share * 100)}% of billed value).`,
      suggestedAction: "Follow up on open tabs and confirm cash/transfer collections were recorded.",
      confidence: scoreConfidence(clamp(share, 0, 1), s.totalOrders, 15),
      metrics: { unpaidTotal: s.unpaidTotal, share: round2(share) },
    },
  ];
};

const menuAvailabilityRule: Rule = (c) => {
  const m = c.menu.analytics;
  if (!m || m.totalItems === 0) return [];
  const share = m.unavailableCount / m.totalItems;
  if (share < THRESHOLDS.menuUnavailableShare) return [];
  return [
    {
      type: "warning",
      severity: share >= 0.4 ? "high" : "medium",
      code: "MENU_LARGELY_UNAVAILABLE",
      title: `${Math.round(share * 100)}% of the menu is unavailable`,
      reason: `${m.unavailableCount} of ${m.totalItems} menu items are marked unavailable, shrinking what customers can order.`,
      suggestedAction: "Re-enable items you can fulfil; a thin menu reduces conversion.",
      confidence: scoreConfidence(clamp(share, 0, 1), m.totalItems, 20),
      metrics: { unavailableCount: m.unavailableCount, totalItems: m.totalItems },
    },
  ];
};

const RULES: Rule[] = [
  revenueTrendRule,
  noSalesTodayRule,
  cancellationRule,
  topSellerRule,
  slowMoverRule,
  kitchenSpeedRule,
  peakHourRule,
  subscriptionRule,
  outOfStockRule,
  repeatRateRule,
  loyaltyRule,
  unpaidOrdersRule,
  menuAvailabilityRule,
];

// ---------------------------------------------------------------------------
// Severity ordering for ranking
// ---------------------------------------------------------------------------

const SEVERITY_RANK: Record<Insight["severity"], number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

function formatHour(hour: number): string {
  const h = ((hour + 11) % 12) + 1;
  const suffix = hour < 12 ? "am" : "pm";
  return `${h}${suffix}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Runs every rule over the context and returns a ranked DecisionReport.
 * Insights are sorted by severity, then confidence (both descending).
 */
export function runDecisionEngine(context: RestaurantContext): DecisionReport {
  const raw: RawInsight[] = [];
  for (const rule of RULES) {
    try {
      raw.push(...rule(context));
    } catch {
      // A single malformed section must never break the whole engine.
    }
  }

  // Stamp the standardised, user-friendly confidence band on every insight.
  const insights: Insight[] = raw.map((i) => ({ ...i, confidenceLevel: confidenceToLevel(i.confidence) }));

  insights.sort((a, b) => {
    const sev = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (sev !== 0) return sev;
    return b.confidence - a.confidence;
  });

  const counts = { anomaly: 0, trend: 0, opportunity: 0, warning: 0, highlight: 0 } as Record<
    InsightType,
    number
  >;
  for (const i of insights) counts[i.type] += 1;

  return {
    generatedAt: context.generatedAt,
    restaurantSlug: context.restaurantSlug,
    insights,
    counts,
  };
}
