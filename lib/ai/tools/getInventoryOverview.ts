import "server-only";
import type { InventoryOverview, ToolResult } from "../types";
import { IntelligenceContext, makeResult } from "./_shared";

/**
 * Inventory availability health.
 *
 * IMPORTANT: RestoFlow has NO quantitative stock model — menu and prepared items
 * only carry an `available` boolean. This tool therefore reports availability
 * (in-stock vs marked-unavailable) rather than quantities, and flags the gap via
 * `quantitativeStockTracked: false`. Forecasting / Smart Purchasing (later
 * sprints) should introduce a stock-levels model to build on this.
 */
export async function getInventoryOverview(ctx: IntelligenceContext): Promise<ToolResult<InventoryOverview>> {
  const [menu, prepared] = await Promise.all([ctx.getMenuItems(), ctx.getPreparedItems()]);

  const rows: { name: string; category: string; available: boolean; source: "menu" | "prepared" }[] = [
    ...menu.map((m) => ({
      name: (m.name as string) ?? "",
      category: (m.category as string) ?? "Uncategorised",
      available: (m.available as boolean) ?? true,
      source: "menu" as const,
    })),
    ...prepared.map((p) => ({
      name: (p.name as string) ?? "",
      category: (p.category as string) ?? "Uncategorised",
      available: (p.available as boolean) ?? true,
      source: "prepared" as const,
    })),
  ];

  const byCategory: Record<string, { total: number; unavailable: number }> = {};
  const outOfStock: InventoryOverview["outOfStock"] = [];
  let availableItems = 0;

  for (const r of rows) {
    const cat = r.category;
    if (!byCategory[cat]) byCategory[cat] = { total: 0, unavailable: 0 };
    byCategory[cat].total += 1;
    if (r.available) {
      availableItems += 1;
    } else {
      byCategory[cat].unavailable += 1;
      outOfStock.push({ name: r.name, category: r.category, source: r.source });
    }
  }

  const data: InventoryOverview = {
    quantitativeStockTracked: false,
    totalItems: rows.length,
    availableItems,
    unavailableItems: rows.length - availableItems,
    outOfStock,
    byCategory,
  };

  return makeResult(ctx, "getInventoryOverview", data, {
    meta: {
      recordCount: rows.length,
      notes: [
        "No quantitative stock tracking exists in RestoFlow; availability is a boolean. Quantities are not modelled.",
      ],
    },
  });
}
