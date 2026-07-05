import "server-only";
import type { BusinessProfile, ToolResult } from "../types";
import { getSubscriptionInfo } from "../../subscription";
import { checkIsOpen, type OpeningHours } from "../../restaurant-utils";
import { IntelligenceContext, makeResult } from "./_shared";

/**
 * The restaurant's own business profile: identity, live open/closed state,
 * enabled ordering channels, subscription posture, and loyalty status.
 * (This is the tenant's own business info, not customer PII.)
 */
export async function getBusinessProfile(ctx: IntelligenceContext): Promise<ToolResult<BusinessProfile>> {
  const r = await ctx.getRestaurant();

  if (!r) {
    // Should not happen for an authenticated tenant, but fail safe.
    const empty: BusinessProfile = {
      name: "",
      slug: ctx.scope.restaurantSlug,
      address: "",
      phone: "",
      status: "unknown",
      subscription: { status: "unknown", planName: "", daysRemaining: null, graceDaysRemaining: null, isOperational: false },
      isOpenNow: false,
      channels: { delivery: false, pickup: false, dineIn: false },
      loyaltyEnabled: false,
    };
    return makeResult(ctx, "getBusinessProfile", empty, { meta: { notes: ["Restaurant document not found."] } });
  }

  const sub = await getSubscriptionInfo(r);
  const isOpenNow = checkIsOpen(r.openingHours as OpeningHours | undefined);

  const data: BusinessProfile = {
    name: (r.name as string) ?? "",
    slug: ctx.scope.restaurantSlug,
    address: (r.address as string) ?? "",
    phone: (r.phone as string) ?? "",
    status: (r.status as string) ?? "unknown",
    subscription: {
      status: sub.status,
      planName: sub.planName,
      daysRemaining: sub.daysRemaining,
      graceDaysRemaining: sub.graceDaysRemaining,
      isOperational: sub.isOperational,
    },
    isOpenNow,
    channels: {
      delivery: (r.deliveryEnabled as boolean) ?? false,
      pickup: (r.pickupEnabled as boolean) ?? false,
      dineIn: (r.dineInEnabled as boolean) ?? false,
    },
    loyaltyEnabled: !!(r.loyalty as { enabled?: boolean } | undefined)?.enabled,
  };

  return makeResult(ctx, "getBusinessProfile", data, {});
}
