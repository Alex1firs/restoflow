import "server-only";
import { redactPII } from "./guardrails";
import { getOperatingProfile } from "./profile";
import {
  IntelligenceContext,
  createIntelligenceContext,
  resolveRange,
  type IntelligenceContextOptions,
} from "./tools/_shared";
import {
  getBusinessProfile,
  getCustomerOverview,
  getInventoryOverview,
  getKitchenPerformance,
  getMenuAnalytics,
  getRecentTransactions,
  getRestaurantSettings,
  getRevenueSummary,
  getSalesByHour,
  getSlowMovingItems,
  getStaffPerformance,
  getTodayOrders,
  getTopSellingItems,
} from "./tools";
import type {
  BusinessProfile,
  CustomerOverview,
  InventoryOverview,
  KitchenPerformance,
  MenuAnalytics,
  RangeInput,
  RecentTransactions,
  RestaurantOperatingProfile,
  RestaurantSettings,
  RevenueSummary,
  SalesByHour,
  SlowMovingItems,
  StaffPerformance,
  TodayOrders,
  TopSellingItems,
} from "./types";

/**
 * AI Context Builder
 * ==================
 * Assembles the full, structured Restaurant Context by orchestrating the tool
 * layer. The Copilot (and every later AI feature) receives THIS object — it
 * never queries Firestore directly.
 *
 *   Restaurant Context
 *   ├── business    (identity, open state, subscription, channels)
 *   ├── settings    (fees, minimums, channels, payment methods)
 *   ├── sales       (revenue summary + by-hour)
 *   ├── orders      (today's live snapshot)
 *   ├── menu        (structure + top/slow items)
 *   ├── customers   (new/returning, repeat rate, loyalty — masked)
 *   ├── staff       (per-staff throughput & revenue)
 *   ├── inventory   (availability health)
 *   └── reports     (kitchen speed + recent transactions)
 *
 * Design notes:
 *  - Resilient: each section is computed independently; a single tool failure
 *    degrades that section to `null` and is recorded in `meta`, rather than
 *    failing the whole context.
 *  - Efficient: all tools share ONE IntelligenceContext, so overlapping order
 *    windows are fetched once (memoised) rather than per tool.
 *  - Safe: a final `redactPII` pass masks any residual PII before the context
 *    can be handed to an LLM.
 */

export interface RestaurantContext {
  generatedAt: string;
  restaurantSlug: string;
  range: { label: string; from: string; to: string };

  business: BusinessProfile | null;
  settings: RestaurantSettings | null;

  sales: {
    summary: RevenueSummary | null;
    byHour: SalesByHour | null;
  };

  orders: TodayOrders | null;

  menu: {
    analytics: MenuAnalytics | null;
    topItems: TopSellingItems | null;
    slowItems: SlowMovingItems | null;
  };

  customers: CustomerOverview | null;
  staff: StaffPerformance | null;
  inventory: InventoryOverview | null;

  /** The Restaurant Operating Profile — a restaurant-scoped input into AI decisions. */
  profile: RestaurantOperatingProfile;

  reports: {
    kitchen: KitchenPerformance | null;
    recentTransactions: RecentTransactions | null;
  };

  meta: {
    toolsRun: string[];
    toolsFailed: { tool: string; error: string }[];
    degraded: boolean;
    auditEventCount: number;
  };
}

export interface BuildContextOptions extends IntelligenceContextOptions {
  /** Reporting window for windowed tools (revenue, top/slow, staff, etc.). */
  range?: RangeInput;
  /** Inject a specific operating profile (tests); otherwise it is loaded read-only. */
  profile?: RestaurantOperatingProfile;
}

/**
 * Build the full Restaurant Context for a tenant. Accepts either a slug (a new
 * IntelligenceContext is created) or an existing context (reused, e.g. in tests
 * or when a caller already assembled tool data).
 */
export async function buildRestaurantContext(
  slugOrCtx: string | IntelligenceContext,
  options: BuildContextOptions = {}
): Promise<RestaurantContext> {
  const ctx =
    typeof slugOrCtx === "string" ? createIntelligenceContext(slugOrCtx, options) : slugOrCtx;
  const range = options.range;

  const toolsRun: string[] = [];
  const toolsFailed: { tool: string; error: string }[] = [];

  // Run a tool, recording success/failure without throwing.
  async function run<T>(name: string, fn: () => Promise<{ data: T }>): Promise<T | null> {
    try {
      const result = await fn();
      toolsRun.push(name);
      return result.data;
    } catch (err) {
      toolsFailed.push({ tool: name, error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  }

  // All sections run concurrently; the shared context memoises overlapping reads.
  const [
    business,
    settings,
    salesSummary,
    salesByHour,
    todayOrders,
    menuAnalytics,
    topItems,
    slowItems,
    customers,
    staff,
    inventory,
    kitchen,
    recentTransactions,
  ] = await Promise.all([
    run("getBusinessProfile", () => getBusinessProfile(ctx)),
    run("getRestaurantSettings", () => getRestaurantSettings(ctx)),
    run("getRevenueSummary", () => getRevenueSummary(ctx, range)),
    run("getSalesByHour", () => getSalesByHour(ctx, range)),
    run("getTodayOrders", () => getTodayOrders(ctx)),
    run("getMenuAnalytics", () => getMenuAnalytics(ctx)),
    run("getTopSellingItems", () => getTopSellingItems(ctx, range)),
    run("getSlowMovingItems", () => getSlowMovingItems(ctx, range)),
    run("getCustomerOverview", () => getCustomerOverview(ctx, range)),
    run("getStaffPerformance", () => getStaffPerformance(ctx, range)),
    run("getInventoryOverview", () => getInventoryOverview(ctx)),
    run("getKitchenPerformance", () => getKitchenPerformance(ctx, range)),
    run("getRecentTransactions", () => getRecentTransactions(ctx, range)),
  ]);

  // Determine the effective window label from any windowed tool that ran.
  const resolved = resolveEffectiveRange(ctx, range);

  // Inject the Restaurant Operating Profile — a restaurant-scoped input (read-only).
  const profile = options.profile ?? (await getOperatingProfile(ctx.scope.restaurantSlug, { db: ctx.db, now: ctx.now }));

  const context: RestaurantContext = {
    generatedAt: ctx.now().toISOString(),
    restaurantSlug: ctx.scope.restaurantSlug,
    range: resolved,
    business,
    settings,
    sales: { summary: salesSummary, byHour: salesByHour },
    orders: todayOrders,
    menu: { analytics: menuAnalytics, topItems, slowItems },
    customers,
    staff,
    inventory,
    profile,
    reports: { kitchen, recentTransactions },
    meta: {
      toolsRun,
      toolsFailed,
      degraded: toolsFailed.length > 0,
      auditEventCount: ctx.audit.drain().length,
    },
  };

  // Final safety pass — mask any residual PII before the context leaves the layer.
  return redactPII(context);
}

function resolveEffectiveRange(
  ctx: IntelligenceContext,
  range?: RangeInput
): { label: string; from: string; to: string } {
  // Reuse the same resolver the tools use, for a single source of truth.
  const r = resolveRange(range, ctx.now());
  return { label: r.label, from: r.from.toISOString(), to: r.to.toISOString() };
}
