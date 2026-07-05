import "server-only";
import type { RangeInput, RevenueSummary, ToolResult } from "../types";
import {
  IntelligenceContext,
  isRevenueOrder,
  makeResult,
  pctChange,
  resolveRange,
  round2,
} from "./_shared";

/**
 * Revenue & order totals for a window, with a comparison to the immediately
 * preceding equivalent window. Mirrors the revenue-recognition rules used by
 * the production Reports route (`paid` && not `rejected`).
 */
export async function getRevenueSummary(
  ctx: IntelligenceContext,
  input?: RangeInput
): Promise<ToolResult<RevenueSummary>> {
  const range = resolveRange(input, ctx.now());

  // One query covers both windows (prevFrom .. to), then we partition.
  const all = await ctx.getOrders(range.prevFrom, range.to);
  const current = all.filter((o) => o.createdAt >= range.from && o.createdAt <= range.to);
  const previous = all.filter((o) => o.createdAt >= range.prevFrom && o.createdAt <= range.prevTo);

  const paid = current.filter(isRevenueOrder);
  const totalRevenue = round2(paid.reduce((s, o) => s + o.total, 0));
  const paidOrders = paid.length;
  const totalOrders = current.length;
  const completed = current.filter((o) => o.status === "completed").length;
  const cancelled = current.filter((o) => o.status === "rejected").length;
  const cancelledTotal = round2(current.filter((o) => o.status === "rejected").reduce((s, o) => s + o.total, 0));

  const byPaymentMethod: Record<string, { orders: number; revenue: number }> = {};
  for (const o of paid) {
    const key = o.paymentMethod || "unknown";
    if (!byPaymentMethod[key]) byPaymentMethod[key] = { orders: 0, revenue: 0 };
    byPaymentMethod[key].orders += 1;
    byPaymentMethod[key].revenue = round2(byPaymentMethod[key].revenue + o.total);
  }

  const byChannel = {
    online: round2(paid.filter((o) => o.orderSource !== "counter").reduce((s, o) => s + o.total, 0)),
    counter: round2(paid.filter((o) => o.orderSource === "counter").reduce((s, o) => s + o.total, 0)),
    dineIn: round2(paid.filter((o) => o.serviceMode === "dine_in").reduce((s, o) => s + o.total, 0)),
  };

  const unpaidTotal = round2(
    current
      .filter((o) => (o.paymentStatus === "unpaid" || o.paymentStatus === "part_paid") && o.status !== "rejected")
      .reduce((s, o) => s + o.total, 0)
  );

  const prevPaid = previous.filter(isRevenueOrder);
  const prevRevenue = round2(prevPaid.reduce((s, o) => s + o.total, 0));

  const data: RevenueSummary = {
    totalRevenue,
    totalOrders,
    paidOrders,
    averageOrderValue: paidOrders > 0 ? round2(totalRevenue / paidOrders) : 0,
    completed,
    cancelled,
    cancelledTotal,
    cancellationRate: totalOrders > 0 ? round2(cancelled / totalOrders) : 0,
    byPaymentMethod,
    byChannel,
    unpaidTotal,
    previous: {
      totalRevenue: prevRevenue,
      totalOrders: previous.length,
      revenueChangePct: pctChange(totalRevenue, prevRevenue),
      ordersChangePct: pctChange(totalOrders, previous.length),
    },
  };

  return makeResult(ctx, "getRevenueSummary", data, {
    range,
    meta: { recordCount: all.length },
  });
}
