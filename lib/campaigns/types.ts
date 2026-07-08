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

/** A derived (read-only) participant tally for a campaign. */
export type CampaignParticipant = {
  phoneKey: string;      // normalized phone (grouping key)
  maskedPhone: string;   // for display
  name: string;          // most-recent customer name seen
  count: number;         // qualifying orders
  qualified: boolean;    // count >= threshold
  lastOrderAtMs: number;
};
