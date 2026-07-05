import "server-only";
import type { RangeInput, SlowMovingItems, ToolResult } from "../types";
import { IntelligenceContext, isRevenueOrder, makeResult, resolveRange, round2 } from "./_shared";

/**
 * Menu items that sold little or nothing in the window. Joins the live menu
 * (`menu_items`) against sales aggregated from paid orders, so items with zero
 * sales surface even though they never appear in the orders stream.
 */
export async function getSlowMovingItems(
  ctx: IntelligenceContext,
  input?: RangeInput & { threshold?: number; limit?: number }
): Promise<ToolResult<SlowMovingItems>> {
  const range = resolveRange(input, ctx.now());
  const threshold = input?.threshold ?? 2; // "slow" = <= this many units sold
  const limit = input?.limit ?? 20;

  const [orders, menu] = await Promise.all([ctx.getOrders(range.from, range.to), ctx.getMenuItems()]);

  const sold: Record<string, { quantity: number; revenue: number }> = {};
  for (const o of orders) {
    if (!isRevenueOrder(o)) continue;
    for (const item of o.items) {
      if (!item.name) continue;
      if (!sold[item.name]) sold[item.name] = { quantity: 0, revenue: 0 };
      sold[item.name].quantity += item.quantity;
      sold[item.name].revenue = round2(sold[item.name].revenue + item.price * item.quantity);
    }
  }

  const neverSold: string[] = [];
  const rows = menu.map((m) => {
    const name = (m.name as string) ?? "";
    const s = sold[name] ?? { quantity: 0, revenue: 0 };
    if (s.quantity === 0) neverSold.push(name);
    return {
      name,
      category: (m.category as string) ?? "Uncategorised",
      price: (m.price as number) ?? 0,
      quantity: s.quantity,
      revenue: s.revenue,
    };
  });

  const items = rows
    .filter((r) => r.quantity <= threshold)
    .sort((a, b) => a.quantity - b.quantity)
    .slice(0, limit);

  return makeResult(ctx, "getSlowMovingItems", { items, neverSold }, {
    range,
    meta: {
      recordCount: menu.length,
      notes: menu.length === 0 ? ["No menu_items found for this restaurant."] : undefined,
    },
  });
}
