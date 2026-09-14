/**
 * RestoFlow Connect — per-partner configuration.
 *
 * ── A third relationship, not a third identity system ────────────────────────
 * A Connect partner is an existing RestoFlow tenant with one more capability
 * switched on. It may have no menu, no storefront and no marketplace listing —
 * it receives its orders on WhatsApp, Instagram, the phone or its own site, and
 * uses RestoFlow only for logistics. So this mirrors `marketplace` rather than
 * inventing a parallel restaurant record: same `restaurants` document, same
 * auth, same isolation, one more settings block.
 *
 * Deliberately NOT `server-only`: this module reads no environment variable and
 * holds no secret. It is pure settings parsing, and making it testable is worth
 * more than an annotation that buys nothing. The modules that do hold secrets
 * keep theirs.
 */

/** Basis points. 1000 = 10%. */
export type Bps = number;

export const CONNECT_STATES = [
  "off",          // not a Connect partner
  "onboarding",   // opted in, not yet approved
  "active",       // may request deliveries
  "suspended",    // platform-side stop
] as const;
export type ConnectState = (typeof CONNECT_STATES)[number];

/**
 * How the partner pays RestoFlow.
 *
 * V1 is prepaid only. `invoiced` exists in the type so the eventual Enterprise
 * credit terms have a name to land on, and is rejected everywhere today — a
 * value that parses but is not honoured is worse than one that does not parse.
 */
export type ConnectBillingMode = "prepaid" | "invoiced";

export type ConnectSettings = {
  state: ConnectState;
  /** True only when approved AND a margin is configured. See `connectEnabled`. */
  enabled: boolean;
  /** RestoFlow's logistics margin over the Dispatcher cost. */
  marginBps: Bps | null;
  billingMode: ConnectBillingMode;
  /** Set when the margin is a labelled non-commercial value. */
  marginIsTest: boolean;
  approvedAt: number | null;
  approvedBy: string | null;
  /** Free-text display name for the pickup, when it differs from the tenant name. */
  pickupName: string | null;
  defaultPickupInstructions: string | null;
};

export const CONNECT_OFF: ConnectSettings = {
  state: "off", enabled: false, marginBps: null, billingMode: "prepaid",
  marginIsTest: false, approvedAt: null, approvedBy: null,
  pickupName: null, defaultPickupInstructions: null,
};

/**
 * Read a restaurant's Connect settings.
 *
 * Absent, malformed or half-written all resolve to off. Anything less careful
 * would let a partially migrated document start requesting couriers that
 * somebody has to pay for.
 */
export function readConnectSettings(
  restaurant: Record<string, unknown> | null | undefined
): ConnectSettings {
  const c = (restaurant?.connect ?? null) as Record<string, unknown> | null;
  if (!c || typeof c !== "object" || Array.isArray(c)) return CONNECT_OFF;

  const state = (CONNECT_STATES as readonly string[]).includes(String(c.state))
    ? (c.state as ConnectState)
    : "off";

  const marginBps =
    typeof c.marginBps === "number" && Number.isFinite(c.marginBps) && c.marginBps >= 0
      ? Math.round(c.marginBps)
      : null;

  // Only "prepaid" is honoured in V1. An unknown or aspirational value reads as
  // prepaid rather than enabling terms nobody has agreed to.
  const billingMode: ConnectBillingMode = c.billingMode === "invoiced" ? "invoiced" : "prepaid";

  return {
    state,
    // Two independent conditions, same reasoning as the marketplace's two
    // switches: approval alone does not activate a partner, and a margin alone
    // does not either.
    enabled: state === "active" && marginBps !== null,
    marginBps,
    billingMode,
    marginIsTest: c.marginIsTest === true,
    approvedAt: typeof c.approvedAt === "number" ? c.approvedAt : null,
    approvedBy: typeof c.approvedBy === "string" ? c.approvedBy : null,
    pickupName: typeof c.pickupName === "string" && c.pickupName.trim() ? c.pickupName.trim() : null,
    defaultPickupInstructions:
      typeof c.defaultPickupInstructions === "string" && c.defaultPickupInstructions.trim()
        ? c.defaultPickupInstructions.trim()
        : null,
  };
}

export type ConnectReadiness = { ok: true } | { ok: false; reason: string };

/**
 * Whether this partner may request a courier right now.
 *
 * ── Why a test margin cannot reach production ────────────────────────────────
 * Staging runs a labelled 10% margin so the accounting and the UI can be
 * verified against real numbers. That value must never become a commercial rate
 * by being forgotten: in production a partner flagged `marginIsTest` is refused
 * outright, so activating Connect for a real partner requires somebody to enter
 * a real margin rather than inheriting whatever staging happened to have.
 */
export function connectReadiness(
  settings: ConnectSettings,
  env: { isProduction: boolean }
): ConnectReadiness {
  if (settings.state === "off") return { ok: false, reason: "connect_not_enabled" };
  if (settings.state === "onboarding") return { ok: false, reason: "connect_not_approved" };
  if (settings.state === "suspended") return { ok: false, reason: "connect_suspended" };
  if (settings.marginBps === null) return { ok: false, reason: "connect_margin_not_configured" };
  if (settings.billingMode !== "prepaid") return { ok: false, reason: "connect_billing_mode_unsupported" };
  if (env.isProduction && settings.marginIsTest) {
    return { ok: false, reason: "connect_margin_is_test_value" };
  }
  return { ok: true };
}
