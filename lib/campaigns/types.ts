// Promo/campaign data model (Slice 1). Pure types — no Firestore, no React.
// Campaigns live in an Admin-SDK-only `campaigns` collection; orders carry an
// additive nullable `campaignId` tag. Nothing here is projected into public
// discovery docs (PII-free guarantee preserved).

export type CampaignStatus = "draft" | "active" | "ended";
export type CampaignEntryPoint = "landing" | "discover";

/** v1 rule: qualify after N qualifying orders. */
export type CampaignRule = { type: "order_count"; threshold: number };

export type Campaign = {
  id: string;
  name: string;
  description: string;
  status: CampaignStatus;
  /** Counting window (inclusive). null = open-ended on that side. */
  startAtMs: number | null;
  endAtMs: number | null;
  rule: CampaignRule;
  prize: string;
  /** Which entry points may attribute an order to this campaign. */
  entryPoints: CampaignEntryPoint[];
  /**
   * Optional promo banner (marketing asset — NOT PII). Rendered on public
   * entry points for active campaigns when `bannerEnabled` and a URL exist.
   * All optional/additive; absence = no banner (current behaviour preserved).
   */
  bannerImageUrl: string | null;
  bannerMobileImageUrl: string | null;
  bannerAlt: string;
  bannerCtaLabel: string;
  /** Explicit click destination; when null the UI defaults to /discover?camp=<id>. */
  bannerCtaHref: string | null;
  bannerEnabled: boolean;
  createdAtMs: number;
  updatedAtMs: number;
  createdBy: string;
};

/**
 * Minimal order shape the counter reasons about. Sourced from the existing
 * `orders` collection (Admin SDK) — a superset doc is fine; only these matter.
 */
export type CampaignOrder = {
  orderId: string;
  campaignId: string | null;
  phone: string;
  customerName?: string;
  paymentStatus?: string; // "paid" qualifies
  status?: string;        // "rejected" disqualifies
  createdAtMs: number;
};

/**
 * PII-free public projection of a campaign — the ONLY shape exposed to
 * unauthenticated clients (landing / discover / storefront). No participant,
 * phone, or internal audit fields.
 */
export type PublicCampaign = {
  id: string;
  name: string;
  description: string;
  prize: string;
  threshold: number;
  entryPoints: CampaignEntryPoint[];
  /**
   * Public banner fields. Present only when the banner is meant to render
   * (see `toPublicCampaign`): `bannerEnabled` true AND a `bannerImageUrl` set.
   * When there is no renderable banner, `bannerImageUrl` is null.
   */
  bannerImageUrl: string | null;
  bannerMobileImageUrl: string | null;
  bannerAlt: string;
  bannerCtaLabel: string;
  bannerCtaHref: string | null;
};

/**
 * A derived (read-only) participant tally for a campaign. Produced ONLY by
 * super-admin-gated code paths (campaign detail page/API) — never projected to
 * any public/customer surface. `fullPhone` is included so a super-admin can
 * contact winners manually; `maskedPhone` is kept for any masked display.
 */
export type CampaignParticipant = {
  phoneKey: string;      // normalized phone (grouping key)
  fullPhone: string;     // complete number — SUPER-ADMIN ONLY (winner contact)
  maskedPhone: string;   // masked form (privacy-safe display)
  name: string;          // most-recent customer name seen
  count: number;         // qualifying orders
  qualified: boolean;    // count >= threshold
  lastOrderAtMs: number;
};
