import "server-only";
import type { RestaurantSettings, ToolResult } from "../types";
import { SENSITIVE_SETTING_KEYS } from "../guardrails";
import { IntelligenceContext, makeResult } from "./_shared";

/**
 * Operational settings relevant to AI reasoning (fees, minimums, channels,
 * payment methods, alerting). Sensitive keys (PINs, subaccount codes, tokens)
 * are explicitly EXCLUDED and the omitted keys are reported for transparency.
 */
export async function getRestaurantSettings(ctx: IntelligenceContext): Promise<ToolResult<RestaurantSettings>> {
  const r = (await ctx.getRestaurant()) ?? {};

  const omittedSensitiveKeys = Object.keys(r).filter((k) => SENSITIVE_SETTING_KEYS.has(k));

  const zones = Array.isArray(r.deliveryZones)
    ? (r.deliveryZones as Array<Record<string, unknown>>).map((z) => ({
        name: (z.name as string) ?? "",
        fee: (z.fee as number) ?? 0,
      }))
    : [];

  const data: RestaurantSettings = {
    deliveryFee: (r.deliveryFee as number) ?? 0,
    minimumOrder: (r.minimumOrder as number) ?? 0,
    deliveryEnabled: (r.deliveryEnabled as boolean) ?? false,
    pickupEnabled: (r.pickupEnabled as boolean) ?? false,
    dineInEnabled: (r.dineInEnabled as boolean) ?? false,
    payments: {
      // Online card payment is available once a Paystack subaccount is configured.
      online: !!(r.paystackSubaccountCode as string | undefined),
      payOnDelivery: (r.payOnDeliveryEnabled as boolean) ?? false,
      whatsappCheckout: (r.whatsappCheckoutEnabled as boolean) ?? false,
    },
    alertPreference: (r.alertPreference as string) ?? "telegram",
    hidePrices: (r.hidePrices as boolean) ?? false,
    deliveryZones: zones,
    omittedSensitiveKeys,
  };

  return makeResult(ctx, "getRestaurantSettings", data, {
    meta: { notes: [`Excluded ${omittedSensitiveKeys.length} sensitive setting key(s) from output.`] },
  });
}
