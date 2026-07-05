import "server-only";
import type { RangeInput, RecentTransactions, ToolResult } from "../types";
import { customerRef } from "../guardrails";
import { IntelligenceContext, makeResult, resolveRange } from "./_shared";

/**
 * The most recent order transactions (amount, method, status) with MASKED
 * customer references. Defaults to the last 25 orders in the window.
 */
export async function getRecentTransactions(
  ctx: IntelligenceContext,
  input?: RangeInput & { limit?: number }
): Promise<ToolResult<RecentTransactions>> {
  // Default to a trailing week if no range given — recent activity, not just today.
  const range = resolveRange(input ?? { range: "week" }, ctx.now());
  const limit = input?.limit ?? 25;
  const orders = await ctx.getOrders(range.from, range.to);

  const transactions = orders.slice(0, limit).map((o) => ({
    orderId: o.orderId,
    orderNumber: o.orderNumber,
    amount: o.total,
    paymentMethod: o.paymentMethod,
    paymentStatus: o.paymentStatus,
    customerRef: customerRef(o.phone, o.customerName),
    createdAt: o.createdAt.toISOString(),
    status: o.status,
  }));

  return makeResult(ctx, "getRecentTransactions", { transactions }, {
    range,
    meta: { recordCount: orders.length, sampled: orders.length > limit },
  });
}
