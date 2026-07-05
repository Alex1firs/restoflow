import "server-only";
import type { KitchenPerformance, RangeInput, ToolResult } from "../types";
import { IntelligenceContext, makeResult, resolveRange } from "./_shared";

/**
 * Kitchen speed for a window: average minutes from order received → preparing
 * and received → ready, using the same timestamp fields as the Reports route
 * (`preparingAt`, `readyAt`). Only orders that carry those timestamps count.
 */
export async function getKitchenPerformance(
  ctx: IntelligenceContext,
  input?: RangeInput
): Promise<ToolResult<KitchenPerformance>> {
  const range = resolveRange(input, ctx.now());
  const orders = await ctx.getOrders(range.from, range.to);

  let totalPrepMs = 0;
  let prepSamples = 0;
  let totalReadyMs = 0;
  let readySamples = 0;
  let slowestReadyMs = 0;

  for (const o of orders) {
    if (o.preparingAt && o.createdAt) {
      const ms = o.preparingAt.getTime() - o.createdAt.getTime();
      if (ms > 0) {
        totalPrepMs += ms;
        prepSamples += 1;
      }
    }
    if (o.readyAt && o.createdAt) {
      const ms = o.readyAt.getTime() - o.createdAt.getTime();
      if (ms > 0) {
        totalReadyMs += ms;
        readySamples += 1;
        if (ms > slowestReadyMs) slowestReadyMs = ms;
      }
    }
  }

  const data: KitchenPerformance = {
    avgPrepMinutes: prepSamples > 0 ? Math.round(totalPrepMs / prepSamples / 60000) : null,
    avgReadyMinutes: readySamples > 0 ? Math.round(totalReadyMs / readySamples / 60000) : null,
    ordersMeasured: readySamples,
    slowestReadyMinutes: slowestReadyMs > 0 ? Math.round(slowestReadyMs / 60000) : null,
    byStation: null, // per-station timing not tracked on orders; reserved for future use.
  };

  return makeResult(ctx, "getKitchenPerformance", data, {
    range,
    meta: {
      recordCount: orders.length,
      notes: readySamples === 0 ? ["No orders in window carry prep/ready timestamps."] : undefined,
    },
  });
}
