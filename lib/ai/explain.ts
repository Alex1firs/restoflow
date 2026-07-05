import "server-only";
import { narrate } from "./narration";
import { writeUsageRecord } from "./usage";
import { createIntelligenceContext } from "./tools/_shared";
import type { IntelligenceContext } from "./tools/_shared";
import { ASSISTANT_NAME } from "./branding";
import {
  getRevenueSummary,
  getTodayOrders,
  getTopSellingItems,
  getInventoryOverview,
  getKitchenPerformance,
  getCustomerOverview,
  getStaffPerformance,
  getSalesByHour,
  getMenuAnalytics,
} from "./tools";
import type { AiProvider } from "./provider";
import type { RangeInput, RangeLabel, ToolResult, UserRole } from "./types";

/**
 * Explain Dashboard architecture
 * ==============================
 * Lets ANY dashboard widget expose an "Explain" action. The reusable contract:
 *
 *   client card  ──POST /api/admin/ai/explain { widget, range?, clientData? }──▶
 *      explainWidget(slug, widget)
 *        → re-fetch the widget's AUTHORITATIVE data via the tool layer (NOT the
 *          client's numbers — the client snapshot is only a hint we reconcile to)
 *        → narrate in plain business language (or deterministic fallback)
 *        → persist usage to ai_usage
 *
 * Adding "Explain" to a new card = add one entry to WIDGET_REGISTRY + drop the
 * <ExplainButton widget="..." /> component onto the card. No new endpoint, no new
 * grounding code. This is the reusable scaffold (Sprint requirement); individual
 * cards adopt it incrementally.
 */

export type WidgetType =
  | "revenue"
  | "todayOrders"
  | "topItems"
  | "inventory"
  | "kitchen"
  | "customers"
  | "staff"
  | "salesByHour"
  | "menu";

interface WidgetDescriptor {
  label: string;
  defaultRange: RangeLabel;
  /** Fetch the widget's authoritative data through the trusted tool layer. */
  run: (ctx: IntelligenceContext, range: RangeInput) => Promise<ToolResult<unknown>>;
  /** Deterministic one-liner used when no LLM is available. */
  fallback: (data: unknown) => string;
}

function naira(n: number): string {
  return `₦${Math.round(n).toLocaleString("en-NG")}`;
}

export const WIDGET_REGISTRY: Record<WidgetType, WidgetDescriptor> = {
  revenue: {
    label: "Revenue",
    defaultRange: "today",
    run: (ctx, r) => getRevenueSummary(ctx, r),
    fallback: (d) => {
      const s = d as { totalRevenue: number; paidOrders: number; previous: { revenueChangePct: number | null } };
      const trend = s.previous.revenueChangePct != null ? ` (${s.previous.revenueChangePct >= 0 ? "+" : ""}${s.previous.revenueChangePct}% vs previous)` : "";
      return `${naira(s.totalRevenue)} from ${s.paidOrders} paid orders${trend}.`;
    },
  },
  todayOrders: {
    label: "Today's Orders",
    defaultRange: "today",
    run: (ctx) => getTodayOrders(ctx),
    fallback: (d) => {
      const o = d as { total: number; active: number; revenueSoFar: number };
      return `${o.total} orders today, ${o.active} still active, ${naira(o.revenueSoFar)} collected so far.`;
    },
  },
  topItems: {
    label: "Top Selling Items",
    defaultRange: "week",
    run: (ctx, r) => getTopSellingItems(ctx, r),
    fallback: (d) => {
      const t = d as { items: { name: string; quantity: number }[] };
      const top = t.items[0];
      return top ? `Best seller: ${top.name} (${top.quantity} sold).` : `No sales recorded.`;
    },
  },
  inventory: {
    label: "Inventory Health",
    defaultRange: "today",
    run: (ctx) => getInventoryOverview(ctx),
    fallback: (d) => {
      const inv = d as { availableItems: number; totalItems: number; unavailableItems: number };
      return `${inv.availableItems} of ${inv.totalItems} items available; ${inv.unavailableItems} unavailable.`;
    },
  },
  kitchen: {
    label: "Kitchen Performance",
    defaultRange: "today",
    run: (ctx, r) => getKitchenPerformance(ctx, r),
    fallback: (d) => {
      const k = d as { avgReadyMinutes: number | null; ordersMeasured: number };
      return k.avgReadyMinutes != null ? `Average prep time ${k.avgReadyMinutes} min across ${k.ordersMeasured} orders.` : `Not enough timed orders to measure prep time.`;
    },
  },
  customers: {
    label: "Customer Retention",
    defaultRange: "month",
    run: (ctx, r) => getCustomerOverview(ctx, r),
    fallback: (d) => {
      const c = d as { totalCustomers: number; returningCustomers: number; repeatRate: number };
      return `${c.totalCustomers} customers, ${c.returningCustomers} returning (${Math.round(c.repeatRate * 100)}% repeat rate).`;
    },
  },
  staff: {
    label: "Staff Performance",
    defaultRange: "week",
    run: (ctx, r) => getStaffPerformance(ctx, r),
    fallback: (d) => {
      const s = d as { perStaff: { staffRef: string; revenue: number }[] };
      const top = s.perStaff[0];
      return top ? `Top performer: ${top.staffRef} (${naira(top.revenue)}).` : `No staff-attributed orders.`;
    },
  },
  salesByHour: {
    label: "Sales by Hour",
    defaultRange: "week",
    run: (ctx, r) => getSalesByHour(ctx, r),
    fallback: (d) => {
      const h = d as { peakHour: number | null };
      return h.peakHour != null ? `Busiest hour is around ${h.peakHour}:00.` : `Not enough data to find a peak hour.`;
    },
  },
  menu: {
    label: "Menu",
    defaultRange: "today",
    run: (ctx) => getMenuAnalytics(ctx),
    fallback: (d) => {
      const m = d as { totalItems: number; categories: number; priceStats: { average: number } };
      return `${m.totalItems} items across ${m.categories} categories, average price ${naira(m.priceStats.average)}.`;
    },
  },
};

export function isWidgetType(x: string): x is WidgetType {
  return x in WIDGET_REGISTRY;
}

export interface ExplainResult {
  widget: WidgetType;
  label: string;
  explanation: string;
  mode: "ai" | "deterministic";
  degraded: boolean;
  provider: string | null;
  range: { label: RangeLabel; from: string; to: string } | null;
  data: unknown;
  usage: { tokensUsed: number; costUsd: number } | null;
  generatedAt: string;
}

export interface ExplainWidgetOptions {
  role?: UserRole;
  now?: () => Date;
  db?: FirebaseFirestore.Firestore;
  provider?: AiProvider | null;
  range?: RangeInput;
  /** The value the client currently displays — reconciled against, never trusted as source. */
  clientData?: unknown;
  requestId?: string;
}

/** Explain a dashboard widget in plain business language, grounded in fresh tool data. */
export async function explainWidget(
  slug: string,
  widget: WidgetType,
  opts: ExplainWidgetOptions = {}
): Promise<ExplainResult> {
  const descriptor = WIDGET_REGISTRY[widget];
  if (!descriptor) throw new Error(`Unknown widget: ${widget}`);

  const ctx = createIntelligenceContext(slug, {
    feature: "explain",
    role: opts.role,
    now: opts.now,
    db: opts.db,
    requestId: opts.requestId,
  });

  const range: RangeInput = opts.range ?? { range: descriptor.defaultRange };
  const result = await descriptor.run(ctx, range);

  const grounding = {
    widget: descriptor.label,
    timePeriod: result.range ?? null,
    authoritativeData: result.data,
    displayedByClient: opts.clientData ?? null,
  };

  const narration = await narrate(ctx, {
    system: explainSystemPrompt(),
    userPrompt: `Explain the "${descriptor.label}" dashboard widget to the owner.\n\nData (your ONLY source):\n${JSON.stringify(grounding)}`,
    deterministic: () => `${descriptor.label}: ${descriptor.fallback(result.data)} (AI narration unavailable — direct summary.)`,
    provider: opts.provider,
    maxTokens: 400,
  });

  await writeUsageRecord(ctx, {
    status: "ok",
    note: `explain widget=${widget} mode=${narration.mode}`,
  });

  return {
    widget,
    label: descriptor.label,
    explanation: narration.text,
    mode: narration.mode,
    degraded: narration.degraded,
    provider: narration.provider,
    range: result.range ?? null,
    data: result.data,
    usage: narration.usage,
    generatedAt: ctx.now().toISOString(),
  };
}

function explainSystemPrompt(): string {
  return [
    `You are ${ASSISTANT_NAME}. Explain a single dashboard metric to a busy restaurant owner in Nigeria.`,
    `Rules:`,
    `- Use ONLY the "authoritativeData" provided. Never invent numbers.`,
    `- If "displayedByClient" differs from "authoritativeData", trust authoritativeData.`,
    `- Say what the metric shows, whether it looks healthy or concerning, and one practical next step.`,
    `- All money is Nigerian Naira (₦). 2-4 sentences, plain language, no JSON or code.`,
  ].join("\n");
}
