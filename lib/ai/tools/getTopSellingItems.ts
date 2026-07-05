import "server-only";
import type { ItemSales, RangeInput, TopSellingItems, ToolResult } from "../types";
import { IntelligenceContext, isRevenueOrder, makeResult, resolveRange, round2 } from "./_shared";

/**
 * Best-selling menu items by quantity over a window, aggregated from paid order
 * line-items (matching the Reports "Best Sellers" logic).
 */
export async function getTopSellingItems(
  ctx: IntelligenceContext,
  input?: RangeInput & { limit?: number }
): Promise<ToolResult<TopSellingItems>> {
  const range = resolveRange(input, ctx.now());
  const limit = input?.limit ?? 10;
  const orders = await ctx.getOrders(range.from, range.to);

  const counts: Record<string, ItemSales> = {};
  let totalItemsSold = 0;

  for (const o of orders) {
    if (!isRevenueOrder(o)) continue;
    for (const item of o.items) {
      if (!item.name) continue;
      if (!counts[item.name]) counts[item.name] = { name: item.name, quantity: 0, revenue: 0, orders: 0 };
      counts[item.name].quantity += item.quantity;
      counts[item.name].revenue = round2(counts[item.name].revenue + item.price * item.quantity);
      counts[item.name].orders += 1;
      totalItemsSold += item.quantity;
    }
  }

  const items = Object.values(counts)
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, limit);

  return makeResult(ctx, "getTopSellingItems", { items, totalItemsSold }, {
    range,
    meta: { recordCount: orders.length },
  });
}
