import "server-only";
import type { RangeInput, SalesByHour, ToolResult } from "../types";
import { IntelligenceContext, isRevenueOrder, lagosHour, makeResult, resolveRange, round2 } from "./_shared";

/**
 * Sales distribution across the 24 hours of the day (Africa/Lagos local time),
 * aggregated over the window. Surfaces peak order-count and peak-revenue hours
 * for staffing / prep planning.
 */
export async function getSalesByHour(
  ctx: IntelligenceContext,
  input?: RangeInput
): Promise<ToolResult<SalesByHour>> {
  // Default to a trailing week so hour-of-day patterns have enough signal.
  const range = resolveRange(input ?? { range: "week" }, ctx.now());
  const orders = await ctx.getOrders(range.from, range.to);

  const buckets = Array.from({ length: 24 }, (_, hour) => ({ hour, orders: 0, revenue: 0 }));

  for (const o of orders) {
    const h = lagosHour(o.createdAt);
    buckets[h].orders += 1;
    if (isRevenueOrder(o)) buckets[h].revenue = round2(buckets[h].revenue + o.total);
  }

  let peakHour: number | null = null;
  let peakRevenueHour: number | null = null;
  let maxOrders = 0;
  let maxRevenue = 0;
  for (const b of buckets) {
    if (b.orders > maxOrders) {
      maxOrders = b.orders;
      peakHour = b.hour;
    }
    if (b.revenue > maxRevenue) {
      maxRevenue = b.revenue;
      peakRevenueHour = b.hour;
    }
  }

  return makeResult(ctx, "getSalesByHour", { hours: buckets, peakHour, peakRevenueHour }, {
    range,
    meta: { recordCount: orders.length },
  });
}
