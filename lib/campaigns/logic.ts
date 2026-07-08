// Pure campaign logic (Slice 1): phone normalization, window/active checks,
// qualifying-order test, and read-only participant tallying. No Firestore, no
// React, no writes — unit-testable with tsx.

import type { Campaign, CampaignOrder, CampaignParticipant, PublicCampaign } from "./types";

/**
 * True when a campaign has a renderable promo banner: explicitly enabled AND a
 * primary image URL present. Status/window are enforced separately (only active,
 * in-window campaigns reach the public projection), so this is purely about the
 * banner asset itself.
 */
export function hasRenderableBanner(c: Pick<Campaign, "bannerEnabled" | "bannerImageUrl">): boolean {
  return Boolean(c.bannerEnabled) && Boolean(c.bannerImageUrl && c.bannerImageUrl.trim());
}

/**
 * Resolve where a campaign banner click should go. Defaults to the discovery
 * entry point carrying the campaign tag (`/discover?camp=<id>`) so attribution
 * is never lost. An explicit `bannerCtaHref` overrides the path, but the `camp`
 * tag is still guaranteed to be present on the resulting URL.
 */
export function resolveBannerHref(
  id: string,
  bannerCtaHref: string | null | undefined,
): string {
  const camp = encodeURIComponent(id);
  const override = (bannerCtaHref ?? "").trim();
  if (!override) return `/discover?camp=${camp}`;
  if (/[?&]camp=/.test(override)) return override; // already carries a camp tag
  const [base, hash = ""] = override.split("#");
  const withCamp = `${base}${base.includes("?") ? "&" : "?"}camp=${camp}`;
  return hash ? `${withCamp}#${hash}` : withCamp;
}

/** Whitelist a campaign down to its PII-free public shape (structural guarantee). */
export function toPublicCampaign(c: Campaign): PublicCampaign {
  const showBanner = hasRenderableBanner(c);
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    prize: c.prize,
    threshold: c.rule.threshold,
    entryPoints: c.entryPoints,
    bannerImageUrl: showBanner ? c.bannerImageUrl : null,
    bannerMobileImageUrl: showBanner ? c.bannerMobileImageUrl : null,
    bannerAlt: showBanner ? (c.bannerAlt || c.name) : "",
    bannerCtaLabel: showBanner ? c.bannerCtaLabel : "",
    bannerCtaHref: showBanner ? c.bannerCtaHref : null,
  };
}

/**
 * Canonicalize a Nigerian phone number to a stable grouping key ("234…").
 * Handles 0803…, 234…, +234…, and bare 10-digit (8…) forms. Returns "" when
 * there aren't enough digits to key on.
 */
export function normalizePhone(raw: string | null | undefined): string {
  const d = (raw ?? "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("234") && d.length === 13) return d;
  if (d.startsWith("0") && d.length === 11) return `234${d.slice(1)}`;
  if (d.length === 10) return `234${d}`; // no leading 0
  return d; // best-effort: keep digits so at least consistent inputs group
}

/** Display mask — reveal a little head + last 3, hide the middle. */
export function maskPhone(canonical: string | null | undefined): string {
  const d = (canonical ?? "").replace(/\D/g, "");
  if (!d) return "";
  if (d.length <= 4) return "•".repeat(d.length);
  const head = d.slice(0, Math.min(4, d.length - 3));
  const tail = d.slice(-3);
  return `${head}••••${tail}`;
}

/** Whether a campaign is live for attributing NEW orders (link-time gate). */
export function isCampaignActive(campaign: Pick<Campaign, "status" | "startAtMs" | "endAtMs">, nowMs: number): boolean {
  if (campaign.status !== "active") return false;
  if (campaign.startAtMs != null && nowMs < campaign.startAtMs) return false;
  if (campaign.endAtMs != null && nowMs > campaign.endAtMs) return false;
  return true;
}

/**
 * Whether an order counts toward a campaign. Money-truth + window, independent
 * of the campaign's live status (an ended campaign still counts orders that
 * fell inside its window). Per-order attribution only (D1/D4).
 */
export function isQualifyingOrder(
  order: CampaignOrder,
  campaign: Pick<Campaign, "id" | "startAtMs" | "endAtMs">,
): boolean {
  if (order.campaignId !== campaign.id) return false;
  if (order.paymentStatus !== "paid") return false;      // D2: cash/POD count only once marked paid
  if (order.status === "rejected") return false;
  if (campaign.startAtMs != null && order.createdAtMs < campaign.startAtMs) return false;
  if (campaign.endAtMs != null && order.createdAtMs > campaign.endAtMs) return false;
  return true;
}

/**
 * Tally qualifying orders per normalized phone (read-only). Refunded/rejected
 * or out-of-window orders simply don't count, so the result self-corrects on
 * each recompute. Sorted by count desc, then most-recent order.
 */
export function tallyParticipants(orders: CampaignOrder[], campaign: Campaign): CampaignParticipant[] {
  const byPhone = new Map<string, { name: string; count: number; lastOrderAtMs: number }>();

  for (const o of orders) {
    if (!isQualifyingOrder(o, campaign)) continue;
    const key = normalizePhone(o.phone);
    if (!key) continue;
    const cur = byPhone.get(key) ?? { name: "", count: 0, lastOrderAtMs: 0 };
    cur.count += 1;
    if (o.createdAtMs >= cur.lastOrderAtMs) {
      cur.lastOrderAtMs = o.createdAtMs;
      cur.name = (o.customerName ?? "").trim() || cur.name;
    }
    byPhone.set(key, cur);
  }

  const threshold = campaign.rule.threshold;
  const out: CampaignParticipant[] = [];
  for (const [phoneKey, v] of byPhone) {
    out.push({
      phoneKey,
      maskedPhone: maskPhone(phoneKey),
      name: v.name,
      count: v.count,
      qualified: v.count >= threshold,
      lastOrderAtMs: v.lastOrderAtMs,
    });
  }
  out.sort((a, b) => b.count - a.count || b.lastOrderAtMs - a.lastOrderAtMs);
  return out;
}
