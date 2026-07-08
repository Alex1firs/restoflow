// Unit tests for pure campaign logic (Slice 1).
// Run: npx tsx lib/campaigns/__tests__/campaigns.test.ts

import assert from "node:assert/strict";
import { normalizePhone, maskPhone, isCampaignActive, isQualifyingOrder, tallyParticipants, toPublicCampaign, hasRenderableBanner, resolveBannerHref } from "../logic";
import type { Campaign, CampaignOrder } from "../types";

let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`  ✓ ${name}`); };

const DAY = 86_400_000;
const NOW = 1_760_000_000_000;

const campaign: Campaign = {
  id: "camp1",
  name: "Order 5, win a cooker",
  description: "",
  status: "active",
  startAtMs: NOW - 10 * DAY,
  endAtMs: NOW + 10 * DAY,
  rule: { type: "order_count", threshold: 5 },
  prize: "Electric cooker",
  entryPoints: ["landing", "discover"],
  bannerImageUrl: null,
  bannerMobileImageUrl: null,
  bannerAlt: "",
  bannerCtaLabel: "",
  bannerCtaHref: null,
  bannerEnabled: false,
  createdAtMs: NOW - 20 * DAY,
  updatedAtMs: NOW - 20 * DAY,
  createdBy: "super-admin",
};

const order = (over: Partial<CampaignOrder>): CampaignOrder => ({
  orderId: "o", campaignId: "camp1", phone: "08031234567", paymentStatus: "paid", status: "accepted", createdAtMs: NOW, ...over,
});

console.log("campaigns/logic");

// ── normalizePhone ──
test("normalizePhone: all Nigerian forms converge to one 234 key", () => {
  const k = "2348031234567";
  assert.equal(normalizePhone("08031234567"), k);
  assert.equal(normalizePhone("2348031234567"), k);
  assert.equal(normalizePhone("+234 803 123 4567"), k);
  assert.equal(normalizePhone("8031234567"), k);        // bare 10-digit
  assert.equal(normalizePhone("0803-123-4567"), k);     // punctuation
  assert.equal(normalizePhone(""), "");
  assert.equal(normalizePhone(null), "");
});

// ── maskPhone ──
test("maskPhone: reveals a little head + last 3, hides the middle", () => {
  assert.equal(maskPhone("2348031234567"), "2348••••567");
  assert.equal(maskPhone(""), "");
  assert.equal(maskPhone("12"), "••");
});

// ── isCampaignActive ──
test("isCampaignActive: status + window gate for NEW attributions", () => {
  assert.equal(isCampaignActive(campaign, NOW), true);
  assert.equal(isCampaignActive({ ...campaign, status: "draft" }, NOW), false);
  assert.equal(isCampaignActive({ ...campaign, status: "ended" }, NOW), false);
  assert.equal(isCampaignActive({ ...campaign, startAtMs: NOW + DAY }, NOW), false); // not started
  assert.equal(isCampaignActive({ ...campaign, endAtMs: NOW - DAY }, NOW), false);   // ended by window
  assert.equal(isCampaignActive({ ...campaign, startAtMs: null, endAtMs: null }, NOW), true);
});

// ── isQualifyingOrder (money-truth + window + per-order tag) ──
test("isQualifyingOrder: only paid, non-rejected, tagged, in-window orders count", () => {
  assert.equal(isQualifyingOrder(order({}), campaign), true);
  assert.equal(isQualifyingOrder(order({ campaignId: "other" }), campaign), false);   // different campaign
  assert.equal(isQualifyingOrder(order({ campaignId: null }), campaign), false);       // untagged
  assert.equal(isQualifyingOrder(order({ paymentStatus: "pending" }), campaign), false); // unpaid
  assert.equal(isQualifyingOrder(order({ paymentStatus: "unpaid" }), campaign), false);  // cash not yet marked
  assert.equal(isQualifyingOrder(order({ status: "rejected" }), campaign), false);        // rejected
  assert.equal(isQualifyingOrder(order({ createdAtMs: NOW - 20 * DAY }), campaign), false); // before window
  assert.equal(isQualifyingOrder(order({ createdAtMs: NOW + 20 * DAY }), campaign), false); // after window
});

// ── tallyParticipants ──
test("tallyParticipants: groups by normalized phone, flags qualified at threshold", () => {
  const A = "08031234567", Aalt = "2348031234567"; // same person, different format
  const B = "08069998888";
  const orders: CampaignOrder[] = [
    ...Array.from({ length: 4 }, (_, i) => order({ orderId: `a${i}`, phone: A, customerName: "Ada", createdAtMs: NOW - i * 1000 })),
    order({ orderId: "a4", phone: Aalt, customerName: "Ada A.", createdAtMs: NOW + 500 }), // 5th, latest → name wins
    order({ orderId: "b0", phone: B, customerName: "Bola" }),
    order({ orderId: "x0", phone: A, campaignId: "other" }),        // other campaign — ignored
    order({ orderId: "x1", phone: B, paymentStatus: "pending" }),   // unpaid — ignored
  ];
  const parts = tallyParticipants(orders, campaign);
  assert.equal(parts.length, 2);
  const ada = parts.find((p) => p.phoneKey === "2348031234567")!;
  assert.equal(ada.count, 5);                 // 4 + 1 across both phone formats
  assert.equal(ada.qualified, true);          // 5 >= 5
  assert.equal(ada.name, "Ada A.");           // most-recent name
  assert.equal(ada.maskedPhone, "2348••••567");
  const bola = parts.find((p) => p.name === "Bola")!;
  assert.equal(bola.count, 1);
  assert.equal(bola.qualified, false);
  // sorted by count desc
  assert.deepEqual(parts.map((p) => p.count), [5, 1]);
});

test("tallyParticipants: skips rows with unkeyable phone", () => {
  const parts = tallyParticipants([order({ phone: "" }), order({ phone: "   " })], campaign);
  assert.equal(parts.length, 0);
});

test("toPublicCampaign: exposes ONLY whitelisted fields (no createdBy/audit leak)", () => {
  const pub = toPublicCampaign(campaign);
  assert.deepEqual(
    Object.keys(pub).sort(),
    ["description", "entryPoints", "id", "name", "prize", "threshold", "bannerImageUrl", "bannerMobileImageUrl", "bannerAlt", "bannerCtaLabel", "bannerCtaHref"].sort(),
  );
  assert.equal(pub.threshold, 5);
  const blob = JSON.stringify(pub);
  for (const secret of ["super-admin", "createdBy", "createdAt", "updatedAt", "status"]) {
    assert.ok(!blob.includes(secret), `must not leak ${secret}`);
  }
});

// ── banner projection & visibility ──
test("hasRenderableBanner: needs both bannerEnabled AND a non-empty image url", () => {
  assert.equal(hasRenderableBanner({ bannerEnabled: false, bannerImageUrl: null }), false);
  assert.equal(hasRenderableBanner({ bannerEnabled: true, bannerImageUrl: null }), false);
  assert.equal(hasRenderableBanner({ bannerEnabled: true, bannerImageUrl: "   " }), false);
  assert.equal(hasRenderableBanner({ bannerEnabled: false, bannerImageUrl: "x.png" }), false);
  assert.equal(hasRenderableBanner({ bannerEnabled: true, bannerImageUrl: "x.png" }), true);
});

test("toPublicCampaign: banner fields blanked when not renderable", () => {
  const pub = toPublicCampaign({ ...campaign, bannerEnabled: false, bannerImageUrl: "x.png", bannerAlt: "hi", bannerCtaLabel: "Go", bannerCtaHref: "/y" });
  assert.equal(pub.bannerImageUrl, null);
  assert.equal(pub.bannerMobileImageUrl, null);
  assert.equal(pub.bannerAlt, "");
  assert.equal(pub.bannerCtaLabel, "");
  assert.equal(pub.bannerCtaHref, null);
});

test("toPublicCampaign: renderable banner passes fields through; alt falls back to name", () => {
  const pub = toPublicCampaign({ ...campaign, bannerEnabled: true, bannerImageUrl: "banner.png", bannerMobileImageUrl: "m.png", bannerAlt: "", bannerCtaLabel: "See promo", bannerCtaHref: null });
  assert.equal(pub.bannerImageUrl, "banner.png");
  assert.equal(pub.bannerMobileImageUrl, "m.png");
  assert.equal(pub.bannerAlt, campaign.name); // empty alt → campaign name
  assert.equal(pub.bannerCtaLabel, "See promo");
  assert.equal(pub.bannerCtaHref, null);
});

test("resolveBannerHref: default → /discover?camp=<id>", () => {
  assert.equal(resolveBannerHref("camp1", null), "/discover?camp=camp1");
  assert.equal(resolveBannerHref("camp1", ""), "/discover?camp=camp1");
  assert.equal(resolveBannerHref("a b", null), "/discover?camp=a%20b");
});

test("resolveBannerHref: explicit override always keeps a camp tag", () => {
  assert.equal(resolveBannerHref("camp1", "/r/tricias-kitchen"), "/r/tricias-kitchen?camp=camp1");
  assert.equal(resolveBannerHref("camp1", "/r/tricias-kitchen?cs=Lagos"), "/r/tricias-kitchen?cs=Lagos&camp=camp1");
  assert.equal(resolveBannerHref("camp1", "/r/x#menu"), "/r/x?camp=camp1#menu");
  // already carries camp → left untouched
  assert.equal(resolveBannerHref("camp1", "/discover?camp=other"), "/discover?camp=other");
});

console.log(`\n${passed} checks passed`);
