// Unit tests for the super-admin order row mapper + filters (Slice 1).
// Run: npx tsx lib/orders/__tests__/admin-view.test.ts

import assert from "node:assert/strict";
import { toOrderRow, orderMatchesFilters, itemsSummary, toMillis } from "../admin-view";
import { toPublicCampaign } from "../../campaigns/logic";
import type { Campaign } from "../../campaigns/types";

let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`  ✓ ${name}`); };

const NOW = 1_760_000_000_000;
const ts = (ms: number) => ({ toMillis: () => ms }); // mimic Firestore Timestamp

const baseOrder = {
  restaurantId: "grills-capitol",
  customerName: "Test Validator",
  phone: "08000000001",
  items: [{ id: "m-gc-1", name: "Classic Prime Rib", price: 35.99, quantity: 2 }, { id: "m-gc-4", name: "Loaded Baked Potato", price: 6.5, quantity: 1 }],
  total: 78.48,
  paymentMethod: "cash",
  paymentStatus: "paid",
  status: "pending",
  orderNumber: 108,
  createdAt: ts(NOW),
  updatedAt: ts(NOW + 5000),
};

console.log("orders/admin-view");

// 1. full phone present for super-admin row
test("[1] maps the FULL customer phone (super-admin row)", () => {
  const row = toOrderRow("ORD_1", baseOrder);
  assert.equal(row.phone, "08000000001");
  assert.ok(!row.phone.includes("•"), "phone must not be masked");
});

// 2. restaurant name joined when available
test("[2] joins restaurant name when provided; null when not", () => {
  assert.equal(toOrderRow("ORD_1", baseOrder, "Grills Capitol").restaurantName, "Grills Capitol");
  assert.equal(toOrderRow("ORD_1", baseOrder).restaurantName, null);
  // slug/id preserved and equal
  const row = toOrderRow("ORD_1", baseOrder, "Grills Capitol");
  assert.equal(row.restaurantId, "grills-capitol");
  assert.equal(row.restaurantSlug, "grills-capitol");
});

// 3. safe item summary
test("[3] produces a safe item summary", () => {
  assert.equal(toOrderRow("ORD_1", baseOrder).itemsSummary, "2× Classic Prime Rib, 1× Loaded Baked Potato");
  assert.equal(toOrderRow("ORD_1", baseOrder).itemsCount, 3);
  // resilient to malformed items
  assert.equal(itemsSummary(undefined), "");
  assert.equal(itemsSummary([{ quantity: 2 }, { name: "X" }]), "2× item, 1× X");
});

// 4. campaignId preserved + source derived
test("[4] preserves campaignId and derives source=campaign", () => {
  const tagged = toOrderRow("ORD_1", { ...baseOrder, campaignId: "BPIJ2nbQySQR875OZOGT" });
  assert.equal(tagged.campaignId, "BPIJ2nbQySQR875OZOGT");
  assert.equal(tagged.source, "campaign");
  const untagged = toOrderRow("ORD_1", baseOrder);
  assert.equal(untagged.campaignId, null);
  assert.equal(untagged.source, null);
});

// 5. missing updatedAt handled gracefully
test("[5] handles missing updatedAt gracefully (null, no throw)", () => {
  const { updatedAt, ...noUpdated } = baseOrder; void updatedAt;
  const row = toOrderRow("ORD_1", noUpdated);
  assert.equal(row.updatedAtMs, null);
  assert.equal(row.createdAtMs, NOW);
});

// 6. orderId is canonical; orderNumber is NOT globally unique
test("[6] treats orderId as the canonical key; orderNumber may collide across restaurants", () => {
  const a = toOrderRow("ORD_A", { ...baseOrder, restaurantId: "grills-capitol", orderNumber: 108 });
  const b = toOrderRow("ORD_B", { ...baseOrder, restaurantId: "tricias-kitchen", orderNumber: 108 });
  assert.notEqual(a.orderId, b.orderId);         // distinct canonical keys
  assert.equal(a.orderNumber, b.orderNumber);     // same per-restaurant number → not unique
  const missing = toOrderRow("ORD_C", { ...baseOrder, orderNumber: undefined });
  assert.equal(missing.orderNumber, null);        // optional
});

// toMillis coercion
test("toMillis: Timestamp | number | {seconds} | missing", () => {
  assert.equal(toMillis(ts(NOW)), NOW);
  assert.equal(toMillis(NOW), NOW);
  assert.equal(toMillis({ seconds: 1000 }), 1_000_000);
  assert.equal(toMillis(undefined), null);
});

// ── filters ──
test("filters: restaurantId/status/paymentStatus/paymentMethod equality", () => {
  const row = toOrderRow("ORD_1", baseOrder);
  assert.equal(orderMatchesFilters(row, { restaurantId: "grills-capitol" }), true);
  assert.equal(orderMatchesFilters(row, { restaurantId: "other" }), false);
  assert.equal(orderMatchesFilters(row, { status: "pending" }), true);
  assert.equal(orderMatchesFilters(row, { status: "completed" }), false);
  assert.equal(orderMatchesFilters(row, { paymentStatus: "paid", paymentMethod: "cash" }), true);
  assert.equal(orderMatchesFilters(row, { paymentMethod: "online" }), false);
});

test("filters: createdAt range", () => {
  const row = toOrderRow("ORD_1", baseOrder); // createdAtMs = NOW
  assert.equal(orderMatchesFilters(row, { fromMs: NOW - 1000, toMs: NOW + 1000 }), true);
  assert.equal(orderMatchesFilters(row, { fromMs: NOW + 1 }), false);
  assert.equal(orderMatchesFilters(row, { toMs: NOW - 1 }), false);
});

test("filters: phone uses EXACT normalized match (formats converge)", () => {
  const row = toOrderRow("ORD_1", { ...baseOrder, phone: "08031234567" });
  assert.equal(orderMatchesFilters(row, { phone: "08031234567" }), true);
  assert.equal(orderMatchesFilters(row, { phone: "2348031234567" }), true);   // same number, 234 form
  assert.equal(orderMatchesFilters(row, { phone: "+234 803 123 4567" }), true); // spaced +234 form
  assert.equal(orderMatchesFilters(row, { phone: "08039999999" }), false);      // different number
});

// ── PII guard: nothing here leaks into the public campaign projection ──
test("PII guard: PublicCampaign / toPublicCampaign expose NO phone fields", () => {
  const campaign: Campaign = {
    id: "c1", name: "n", description: "", status: "active", startAtMs: null, endAtMs: null,
    rule: { type: "order_count", threshold: 2 }, prize: "", entryPoints: ["landing"],
    bannerImageUrl: null, bannerMobileImageUrl: null, bannerAlt: "", bannerCtaLabel: "", bannerCtaHref: null, bannerEnabled: false,
    createdAtMs: NOW, updatedAtMs: NOW, createdBy: "sa",
  };
  const pub = toPublicCampaign(campaign);
  for (const k of ["phone", "fullPhone", "maskedPhone", "phoneKey", "participants"]) {
    assert.ok(!(k in (pub as Record<string, unknown>)), `PublicCampaign must not include ${k}`);
  }
  assert.ok(!/\b0?\d{10,}\b/.test(JSON.stringify(pub)), "no phone-like digits in public projection");
});

console.log(`\n${passed} checks passed`);
