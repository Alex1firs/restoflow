/**
 * Marketplace participation and pricing configuration.
 *
 * ── The default that matters ─────────────────────────────────────────────────
 * A restaurant with no `marketplace` map is `internal_only`. That single
 * default is what guarantees no existing restaurant — Trisha's Kitchen, The
 * Steam Menu, or any other — is ever made publicly orderable by this work.
 * Listing requires an explicit super-admin activation AND an explicit
 * restaurant opt-in; neither is implied by anything already in the database.
 *
 * Pure: reads a raw restaurant document and answers questions about it. No
 * firebase, no writes.
 */

import type { MarkupRule, PricingConfig } from "./pricing";
import { DEFAULT_ROUND_TO } from "./pricing";

export const MARKETPLACE_STATES = [
  "internal_only",   // the default, and where every existing restaurant sits
  "onboarding",      // opted in, not yet approved
  "active",          // live and orderable
  "paused",          // temporarily not accepting (the restaurant's own switch)
  "unavailable",     // out of hours, or paused until a timestamp
  "suspended",       // platform-side stop
] as const;
export type MarketplaceState = (typeof MARKETPLACE_STATES)[number];

export type MarketplaceSettings = {
  state: MarketplaceState;
  marketplaceEnabled: boolean;
  publicName: string | null;
  prepTimeMins: { min: number; max: number };
  minOrderMinor: number | null;
  deliveryRadiusKm: number | null;
  pricing: { markup: MarkupRule; roundToMinor: number };
  unavailableUntil: number | null;
  approvedAt: number | null;
  approvedBy: string | null;
};

/** Used when the platform has no configured default of its own. */
export const PLATFORM_FALLBACK_MARKUP: MarkupRule = { type: "percent", bps: 1500 };

/**
 * Read a restaurant's marketplace settings.
 *
 * Absent, malformed, or partially written all resolve to `internal_only` with
 * the marketplace off. Anything less careful would let a half-migrated document
 * put a restaurant in front of customers.
 */
export function readMarketplaceSettings(restaurant: Record<string, unknown> | null | undefined): MarketplaceSettings {
  const off: MarketplaceSettings = {
    state: "internal_only", marketplaceEnabled: false, publicName: null,
    prepTimeMins: { min: 20, max: 40 }, minOrderMinor: null, deliveryRadiusKm: null,
    pricing: { markup: { type: "none" }, roundToMinor: DEFAULT_ROUND_TO },
    unavailableUntil: null, approvedAt: null, approvedBy: null,
  };

  const m = (restaurant?.marketplace ?? null) as Record<string, unknown> | null;
  if (!m || typeof m !== "object") return off;

  const state = (MARKETPLACE_STATES as readonly string[]).includes(String(m.state))
    ? (m.state as MarketplaceState)
    : "internal_only";

  // Both switches are required. A super-admin approval alone does not list a
  // restaurant, and neither does a restaurant opting in without approval.
  const enabled = state === "active" && m.marketplaceEnabled === true;

  const prep = (m.prepTimeMins ?? {}) as { min?: unknown; max?: unknown };

  return {
    state,
    marketplaceEnabled: enabled,
    publicName: typeof m.publicName === "string" && m.publicName.trim() ? m.publicName.trim() : null,
    prepTimeMins: {
      min: typeof prep.min === "number" && prep.min > 0 ? prep.min : 20,
      max: typeof prep.max === "number" && prep.max > 0 ? prep.max : 40,
    },
    minOrderMinor: typeof m.minOrderMinor === "number" ? m.minOrderMinor : null,
    deliveryRadiusKm: typeof m.deliveryRadiusKm === "number" ? m.deliveryRadiusKm : null,
    pricing: {
      markup: readMarkup((m.pricing as Record<string, unknown> | undefined)?.markup),
      roundToMinor: typeof (m.pricing as Record<string, unknown> | undefined)?.roundToMinor === "number"
        ? ((m.pricing as Record<string, number>).roundToMinor)
        : DEFAULT_ROUND_TO,
    },
    unavailableUntil: typeof m.unavailableUntil === "number" ? m.unavailableUntil : null,
    approvedAt: typeof m.approvedAt === "number" ? m.approvedAt : null,
    approvedBy: typeof m.approvedBy === "string" ? m.approvedBy : null,
  };
}

/** An unrecognised or malformed rule is `none`, never a guessed percentage. */
export function readMarkup(raw: unknown): MarkupRule {
  const r = (raw ?? {}) as Record<string, unknown>;
  switch (r.type) {
    case "percent":
      return typeof r.bps === "number" && r.bps >= 0 ? { type: "percent", bps: Math.round(r.bps) } : { type: "none" };
    case "fixed":
      return typeof r.amountMinor === "number" && r.amountMinor >= 0
        ? { type: "fixed", amountMinor: Math.round(r.amountMinor) } : { type: "none" };
    case "absolute":
      return typeof r.amountMinor === "number" && r.amountMinor >= 0
        ? { type: "absolute", amountMinor: Math.round(r.amountMinor) } : { type: "none" };
    case "none":
      return { type: "none" };
    default:
      return { type: "none" };
  }
}

/** Whether a customer may place an order with this restaurant right now. */
export function isOrderable(settings: MarketplaceSettings, nowMs: number): { ok: boolean; reason: string | null } {
  if (!settings.marketplaceEnabled) return { ok: false, reason: "not_listed" };
  if (settings.state === "paused") return { ok: false, reason: "paused" };
  if (settings.state === "suspended") return { ok: false, reason: "suspended" };
  if (settings.unavailableUntil && settings.unavailableUntil > nowMs) {
    return { ok: false, reason: "temporarily_unavailable" };
  }
  return { ok: true, reason: null };
}

/** Compose the pricing config for one restaurant from the platform default down. */
export function pricingConfigFor(args: {
  settings: MarketplaceSettings;
  platformDefault?: MarkupRule;
  rulesVersion?: number;
}): PricingConfig {
  const restaurantMarkup = args.settings.pricing.markup;
  return {
    platformDefault: args.platformDefault ?? PLATFORM_FALLBACK_MARKUP,
    // `none` is a deliberate restaurant choice and must be honoured, so it is
    // passed through rather than treated as "unset".
    restaurantDefault: restaurantMarkup,
    roundToMinor: args.settings.pricing.roundToMinor,
    rulesVersion: args.rulesVersion ?? 1,
  };
}

// ── Global switches ─────────────────────────────────────────────────────────

export type MarketplaceFlags = {
  /** Master switch. Off means the marketplace does not exist. */
  enabled: boolean;
  /** Whether checkout may take real money. Separate on purpose. */
  paymentsEnabled: boolean;
  /** Whether an accepted order may request a courier. */
  deliveryEnabled: boolean;
};

/**
 * `Record<string, string | undefined>` rather than `NodeJS.ProcessEnv`: this
 * reads three keys and nothing else, and the narrower type lets a test pass a
 * plain object without pretending to be a whole environment.
 */
export function readFlags(env: Record<string, string | undefined> = process.env): MarketplaceFlags {
  return {
    enabled: env.MARKETPLACE_ENABLED === "true",
    // Nested deliberately: payments cannot be on while the marketplace is off.
    paymentsEnabled: env.MARKETPLACE_ENABLED === "true" && env.MARKETPLACE_PAYMENTS_ENABLED === "true",
    deliveryEnabled: env.MARKETPLACE_ENABLED === "true" && env.DELIVERY_INTEGRATION_ENABLED === "true",
  };
}
