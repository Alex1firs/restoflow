// Unit tests for order-tagging logic (Slice 4). Proves the 5 required behaviors.
// Run: npx tsx lib/campaigns/__tests__/tagging.test.ts

import assert from "node:assert/strict";
import { resolveCampaignTag, pendingCampaignId, campaignPatch } from "../tagging";
import type { Campaign } from "../types";

let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`  ✓ ${name}`); };

const DAY = 86_400_000;
const NOW = 1_760_000_000_000;

const active: Campaign = {
  id: "camp1", name: "Order 5", description: "", status: "active",
  startAtMs: NOW - 5 * DAY, endAtMs: NOW + 5 * DAY,
  rule: { type: "order_count", threshold: 5 }, prize: "Cooker", entryPoints: ["landing", "discover"],
  bannerImageUrl: null, bannerMobileImageUrl: null, bannerAlt: "", bannerCtaLabel: "", bannerCtaHref: null, bannerEnabled: false,
  createdAtMs: NOW - 10 * DAY, updatedAtMs: NOW - 10 * DAY, createdBy: "sa",
};

console.log("campaigns/tagging");

// Proof 1: a campaign order stores campaignId.
test("[1] active campaign → order is tagged with its id", () => {
  const tag = resolveCampaignTag(active, NOW);
  assert.equal(tag, "camp1");
  const order = { restaurantId: "r", total: 5000, items: [{ id: "d", quantity: 1 }], ...campaignPatch(tag) };
  assert.equal(order.campaignId, "camp1");
});

// Proof 2: a non-campaign order remains unchanged (no campaignId key at all).
test("[2] no campaign → order has NO campaignId field", () => {
  const tag = resolveCampaignTag(null, NOW);
  assert.equal(tag, null);
  const patch = campaignPatch(tag);
  assert.deepEqual(patch, {});
  const order = { restaurantId: "r", total: 5000, ...patch };
  assert.equal("campaignId" in order, false);
});

// Proof 3: invalid / inactive / expired campaign does not block; order continues untagged.
test("[3] inactive/expired/draft campaign → null tag (order proceeds untagged)", () => {
  assert.equal(resolveCampaignTag({ ...active, status: "draft" }, NOW), null);
  assert.equal(resolveCampaignTag({ ...active, status: "ended" }, NOW), null);
  assert.equal(resolveCampaignTag({ ...active, endAtMs: NOW - DAY }, NOW), null);   // expired window
  assert.equal(resolveCampaignTag({ ...active, startAtMs: NOW + DAY }, NOW), null); // not started
  // an order built with a null tag still has all its normal fields
  const order = { restaurantId: "r", total: 5000, ...campaignPatch(resolveCampaignTag(null, NOW)) };
  assert.equal(order.restaurantId, "r");
  assert.equal(order.total, 5000);
});

// Proof 4: pending payment carries campaignId into the final paid order.
test("[4] pending_payments campaignId is copied onto the final order", () => {
  const pending = { restaurantId: "r", total: 5000, items: [], campaignId: "camp1" };
  const carried = pendingCampaignId(pending);
  assert.equal(carried, "camp1");
  const finalOrder = { restaurantId: pending.restaurantId, total: pending.total, paymentStatus: "paid", ...campaignPatch(carried) };
  assert.equal(finalOrder.campaignId, "camp1");
  // legacy pending (pre-Slice-4, no campaignId) → no field
  assert.equal(pendingCampaignId({ restaurantId: "r", total: 5000 }), null);
  assert.equal("campaignId" in { ...campaignPatch(pendingCampaignId({})) }, false);
});

// Proof 5: order totals / payment amounts are unchanged by tagging.
test("[5] tagging never alters totals/items/amounts", () => {
  const base = { itemsTotal: 4500, deliveryFee: 500, total: 5000, items: [{ id: "d", quantity: 3 }] };
  const tagged = { ...base, ...campaignPatch("camp1") };
  const untagged = { ...base, ...campaignPatch(null) };
  for (const o of [tagged, untagged]) {
    assert.equal(o.itemsTotal, 4500);
    assert.equal(o.deliveryFee, 500);
    assert.equal(o.total, 5000);
    assert.deepEqual(o.items, [{ id: "d", quantity: 3 }]);
  }
  assert.equal(tagged.total, untagged.total); // identical money regardless of tag
});

console.log(`\n${passed} checks passed`);
