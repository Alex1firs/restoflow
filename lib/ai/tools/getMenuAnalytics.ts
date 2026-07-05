import "server-only";
import type { MenuAnalytics, ToolResult } from "../types";
import { IntelligenceContext, makeResult, round2 } from "./_shared";

/**
 * Structural analytics of the live customer menu (`menu_items`): item count,
 * category spread, price distribution, and availability. Pricing/availability
 * only — no sales data (see getTopSellingItems / getSlowMovingItems for that).
 */
export async function getMenuAnalytics(ctx: IntelligenceContext): Promise<ToolResult<MenuAnalytics>> {
  const menu = await ctx.getMenuItems();

  const prices: number[] = [];
  const byCategory: Record<string, { items: number; priceSum: number }> = {};
  let unavailableCount = 0;

  for (const m of menu) {
    const price = (m.price as number) ?? 0;
    const category = (m.category as string) ?? "Uncategorised";
    prices.push(price);
    if (!byCategory[category]) byCategory[category] = { items: 0, priceSum: 0 };
    byCategory[category].items += 1;
    byCategory[category].priceSum += price;
    if ((m.available as boolean) === false) unavailableCount += 1;
  }

  const byCategoryOut: MenuAnalytics["byCategory"] = {};
  for (const [cat, v] of Object.entries(byCategory)) {
    byCategoryOut[cat] = { items: v.items, averagePrice: v.items > 0 ? round2(v.priceSum / v.items) : 0 };
  }

  const data: MenuAnalytics = {
    totalItems: menu.length,
    categories: Object.keys(byCategory).length,
    priceStats: {
      min: prices.length ? Math.min(...prices) : 0,
      max: prices.length ? Math.max(...prices) : 0,
      average: prices.length ? round2(prices.reduce((s, p) => s + p, 0) / prices.length) : 0,
    },
    byCategory: byCategoryOut,
    unavailableCount,
  };

  return makeResult(ctx, "getMenuAnalytics", data, { meta: { recordCount: menu.length } });
}
