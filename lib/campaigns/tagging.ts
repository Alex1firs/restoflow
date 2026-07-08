// Pure order-tagging helpers (Slice 4). The order-write paths call these exact
// functions, so the unit tests cover the real behavior. No Firestore, no writes.
//
// Design guarantees:
//  - A tag is stored ONLY for an active campaign (money-truth deferred to counting).
//  - An untagged order gets NO campaignId field at all (byte-identical to before).
//  - Attaching a tag never touches totals/items/amounts.

import type { Campaign } from "./types";
import { isCampaignActive } from "./logic";

/** Resolve the campaignId to persist — null unless the campaign exists AND is active now. */
export function resolveCampaignTag(campaign: Campaign | null, nowMs: number): string | null {
  return campaign && isCampaignActive(campaign, nowMs) ? campaign.id : null;
}

/** Read a campaignId carried on a pending_payments doc (online path). */
export function pendingCampaignId(pending: Record<string, unknown> | null | undefined): string | null {
  const v = pending?.campaignId;
  return typeof v === "string" && v ? v : null;
}

/**
 * The additive patch to spread into an order/pending write. When there's no tag,
 * this is an EMPTY object — so a non-campaign order is unchanged (no null field,
 * no key). It never carries anything but `campaignId`, so totals/items are safe.
 */
export function campaignPatch(tag: string | null): { campaignId?: string } {
  return tag ? { campaignId: tag } : {};
}
