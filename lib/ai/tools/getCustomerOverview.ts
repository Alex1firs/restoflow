import "server-only";
import type { CustomerOverview, RangeInput, ToolResult } from "../types";
import { customerRef } from "../guardrails";
import { IntelligenceContext, isRevenueOrder, makeResult, resolveRange, round2 } from "./_shared";

/**
 * Customer base overview for a window: distinct customers, new vs returning,
 * repeat rate, and top customers — all keyed by a MASKED, non-reversible
 * customer reference (never a raw phone number). Also folds in loyalty stats.
 *
 * "Returning" = the customer placed an order before this window's `from`.
 */
export async function getCustomerOverview(
  ctx: IntelligenceContext,
  input?: RangeInput
): Promise<ToolResult<CustomerOverview>> {
  const range = resolveRange(input, ctx.now());

  // Look back further than the window to classify new vs returning.
  const lookbackFrom = new Date(range.from.getTime() - 180 * 86_400_000); // ~6 months
  const [history, restaurant, loyaltyCustomers] = await Promise.all([
    ctx.getOrders(lookbackFrom, range.to),
    ctx.getRestaurant(),
    ctx.getLoyaltyCustomers(),
  ]);

  const inWindow = history.filter((o) => o.createdAt >= range.from && o.createdAt <= range.to);

  // First-seen timestamp per masked customer, across the whole lookback.
  const firstSeen = new Map<string, number>();
  for (const o of history) {
    const ref = customerRef(o.phone, o.customerName);
    const t = o.createdAt.getTime();
    if (!firstSeen.has(ref) || t < firstSeen.get(ref)!) firstSeen.set(ref, t);
  }

  const perCustomer = new Map<string, { orders: number; spend: number }>();
  for (const o of inWindow) {
    const ref = customerRef(o.phone, o.customerName);
    const agg = perCustomer.get(ref) ?? { orders: 0, spend: 0 };
    agg.orders += 1;
    if (isRevenueOrder(o)) agg.spend = round2(agg.spend + o.total);
    perCustomer.set(ref, agg);
  }

  let newCustomers = 0;
  let returningCustomers = 0;
  for (const ref of perCustomer.keys()) {
    const first = firstSeen.get(ref) ?? range.from.getTime();
    if (first >= range.from.getTime()) newCustomers += 1;
    else returningCustomers += 1;
  }

  const totalCustomers = perCustomer.size;
  const topCustomers = [...perCustomer.entries()]
    .map(([ref, v]) => ({ customerRef: ref, orders: v.orders, spend: v.spend }))
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 10);

  const loyaltyEnabled = !!(restaurant?.loyalty as { enabled?: boolean } | undefined)?.enabled;
  const unredeemed = loyaltyCustomers.reduce((s, c) => s + ((c.unredeemedRewards as number) ?? 0), 0);

  const data: CustomerOverview = {
    totalCustomers,
    returningCustomers,
    newCustomers,
    repeatRate: totalCustomers > 0 ? round2(returningCustomers / totalCustomers) : 0,
    topCustomers,
    loyalty: {
      enabled: loyaltyEnabled,
      members: loyaltyCustomers.length,
      unredeemedRewards: unredeemed,
    },
  };

  return makeResult(ctx, "getCustomerOverview", data, {
    range,
    meta: { recordCount: inWindow.length, notes: ["Customers are identified by masked references; no raw PII is returned."] },
  });
}
