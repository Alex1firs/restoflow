import "server-only";
import type { RangeInput, StaffPerformance, ToolResult } from "../types";
import { IntelligenceContext, isRevenueOrder, makeResult, resolveRange, round2 } from "./_shared";

/**
 * Per-staff order throughput and revenue for a window, attributed via the
 * `staffName`/`staffId` recorded on orders (POS & settlement). Staff roster is
 * cross-referenced from `users` so staff with zero orders still appear.
 */
export async function getStaffPerformance(
  ctx: IntelligenceContext,
  input?: RangeInput
): Promise<ToolResult<StaffPerformance>> {
  const range = resolveRange(input, ctx.now());
  const [orders, users] = await Promise.all([ctx.getOrders(range.from, range.to), ctx.getUsers()]);

  const perStaff = new Map<string, { orders: number; revenue: number }>();

  // Seed with the roster (display names) so idle staff are visible.
  for (const u of users) {
    const name = (u.displayName as string) || (u.email as string) || u.id;
    if (name) perStaff.set(name, { orders: 0, revenue: 0 });
  }

  for (const o of orders) {
    const ref = o.staffName || o.settledByStaffName || o.waiterName;
    if (!ref) continue;
    const agg = perStaff.get(ref) ?? { orders: 0, revenue: 0 };
    agg.orders += 1;
    if (isRevenueOrder(o)) agg.revenue = round2(agg.revenue + o.total);
    perStaff.set(ref, agg);
  }

  const rows = [...perStaff.entries()]
    .map(([staffRef, v]) => ({
      staffRef,
      orders: v.orders,
      revenue: v.revenue,
      averageOrderValue: v.orders > 0 ? round2(v.revenue / v.orders) : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  return makeResult(ctx, "getStaffPerformance", { staffCount: users.length, perStaff: rows }, {
    range,
    meta: { recordCount: orders.length },
  });
}
