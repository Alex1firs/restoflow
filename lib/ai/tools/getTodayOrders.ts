import "server-only";
import type { TodayOrders, ToolResult } from "../types";
import { IntelligenceContext, isRevenueOrder, makeResult, resolveRange, round2 } from "./_shared";

const ACTIVE_STATUSES = new Set(["pending", "preparing", "ready", "scheduled"]);

/**
 * A live snapshot of today's orders: counts by status, active (in-flight)
 * orders, revenue so far, and the most recent tickets.
 */
export async function getTodayOrders(ctx: IntelligenceContext): Promise<ToolResult<TodayOrders>> {
  const range = resolveRange({ range: "today" }, ctx.now());
  const orders = await ctx.getOrders(range.from, range.to);

  const byStatus: Record<string, number> = {};
  for (const o of orders) {
    const key = o.status || "unknown";
    byStatus[key] = (byStatus[key] ?? 0) + 1;
  }

  const active = orders.filter((o) => ACTIVE_STATUSES.has(o.status)).length;
  const revenueSoFar = round2(orders.filter(isRevenueOrder).reduce((s, o) => s + o.total, 0));

  const latestOrders = orders
    .slice(0, 10)
    .map((o) => ({
      orderId: o.orderId,
      orderNumber: o.orderNumber,
      total: o.total,
      status: o.status,
      createdAt: o.createdAt.toISOString(),
      serviceMode: o.serviceMode,
    }));

  const data: TodayOrders = {
    total: orders.length,
    byStatus,
    active,
    revenueSoFar,
    latestOrders,
  };

  return makeResult(ctx, "getTodayOrders", data, { range, meta: { recordCount: orders.length } });
}
