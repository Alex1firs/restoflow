// Unit tests for the pure logistics/trust summary.
// Run: npx tsx lib/__tests__/logistics-summary.test.ts

import assert from "node:assert/strict";
import { buildLogisticsSummary, DYNAMIC_FEE_COPY, type LogisticsInput } from "../logistics-summary";

let passed = 0;
function test(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }

const money = (n: number) => `₦${n.toLocaleString("en-NG")}`;
const base: LogisticsInput = {
  isOpen: true,
  preorderEnabled: false,
  nextOpenLabel: null,
  deliveryEnabled: true,
  pickupEnabled: true,
  dineInEnabled: false,
  deliveryFee: 0,
  deliveryZones: [],
  pickupAddress: "12 Marina Rd, Lagos",
  onlinePaymentEnabled: true,
  whatsappCheckoutEnabled: true,
  payOnDeliveryEnabled: true,
  hidePrices: false,
  serviceAreas: [],
};
const S = (over: Partial<LogisticsInput>) => buildLogisticsSummary({ ...base, ...over }, money);

console.log("logistics-summary");

// ── Open / closed ──
test("open → 'Open now'", () => {
  const s = S({ isOpen: true });
  assert.equal(s.status.open, true);
  assert.equal(s.status.label, "Open now");
  assert.equal(s.status.preorder, false);
});

test("closed + preorder → 'Closed now' + opens label + pre-order flag", () => {
  const s = S({ isOpen: false, preorderEnabled: true, nextOpenLabel: "8:30 AM" });
  assert.equal(s.status.label, "Closed now");
  assert.equal(s.status.opensLabel, "8:30 AM");
  assert.equal(s.status.preorder, true);
});

test("closed + NO preorder → no pre-order flag", () => {
  const s = S({ isOpen: false, preorderEnabled: false, nextOpenLabel: "Tomorrow 9:00 AM" });
  assert.equal(s.status.preorder, false);
  assert.equal(s.status.opensLabel, "Tomorrow 9:00 AM");
});

// ── Payments: only enabled shown ──
test("only enabled payment methods are displayed", () => {
  assert.deepEqual(S({}).payments, ["Pay online", "Cash", "WhatsApp order"]);
  assert.deepEqual(S({ whatsappCheckoutEnabled: false }).payments, ["Pay online", "Cash"]);
  assert.deepEqual(S({ onlinePaymentEnabled: false, whatsappCheckoutEnabled: false }).payments, ["Cash"]);
});

test("cash hidden when no cash-viable fulfillment (delivery-only + pay-on-delivery off)", () => {
  const s = S({ deliveryEnabled: true, pickupEnabled: false, dineInEnabled: false, payOnDeliveryEnabled: false, onlinePaymentEnabled: true, whatsappCheckoutEnabled: false });
  assert.deepEqual(s.payments, ["Pay online"]); // no "Cash"
});

test("catalog mode (hidePrices) → cash only, never online/whatsapp", () => {
  const s = S({ hidePrices: true });
  assert.deepEqual(s.payments, ["Cash"]);
});

test("no enabled methods → empty payments (nothing invented)", () => {
  const s = S({ onlinePaymentEnabled: false, whatsappCheckoutEnabled: false, pickupEnabled: false, dineInEnabled: false, deliveryEnabled: true, payOnDeliveryEnabled: false });
  assert.deepEqual(s.payments, []);
});

// ── Delivery clarity ──
test("delivery unavailable → available=false (and fee is never advertised)", () => {
  const s = S({ deliveryEnabled: false, deliveryFee: 1500 });
  assert.equal(s.delivery.available, false);
  // component won't render fee; feeKnown stays false regardless of the stray number
  assert.equal(s.delivery.feeKnown, false);
});

test("flat delivery fee > 0 → shows the real formatted fee", () => {
  const s = S({ deliveryEnabled: true, deliveryFee: 1500, deliveryZones: [] });
  assert.equal(s.delivery.feeKnown, true);
  assert.equal(s.delivery.feeLabel, "₦1,500");
});

test("per-zone pricing → dynamic fallback copy (no invented number)", () => {
  const s = S({ deliveryEnabled: true, deliveryFee: 0, deliveryZones: [{ id: "a", name: "Ikeja", fee: 1000 }, { id: "b", name: "VI", fee: 2000 }] });
  assert.equal(s.delivery.feeKnown, false);
  assert.equal(s.delivery.feeLabel, DYNAMIC_FEE_COPY);
});

test("delivery enabled but fee 0 / unset → honest fallback, never 'Free'", () => {
  const s = S({ deliveryEnabled: true, deliveryFee: 0, deliveryZones: [] });
  assert.equal(s.delivery.feeKnown, false);
  assert.equal(s.delivery.feeLabel, DYNAMIC_FEE_COPY);
  assert.ok(!/free/i.test(s.delivery.feeLabel));
});

test("areas come from zones, else serviceAreas, else empty", () => {
  assert.deepEqual(S({ deliveryZones: [{ id: "a", name: "Ikeja", fee: 500 }] }).delivery.areas, ["Ikeja"]);
  assert.deepEqual(S({ deliveryZones: [], serviceAreas: ["Yaba", "Surulere"] }).delivery.areas, ["Yaba", "Surulere"]);
  assert.deepEqual(S({ deliveryZones: [], serviceAreas: [] }).delivery.areas, []);
});

// ── Pickup clarity ──
test("pickup location shown only when pickup enabled AND address known", () => {
  assert.equal(S({ pickupEnabled: true, pickupAddress: "12 Marina Rd" }).pickup.location, "12 Marina Rd");
  assert.equal(S({ pickupEnabled: true, pickupAddress: "" }).pickup.location, null);
  assert.equal(S({ pickupEnabled: true, pickupAddress: null }).pickup.location, null);
});

test("pickup disabled → not advertised (available false, no location)", () => {
  const s = S({ pickupEnabled: false, pickupAddress: "12 Marina Rd" });
  assert.equal(s.pickup.available, false);
  assert.equal(s.pickup.location, null);
});

// ── Fulfillment label ──
test("fulfillment label lists only enabled modes", () => {
  assert.equal(S({ deliveryEnabled: true, pickupEnabled: true, dineInEnabled: true }).fulfillmentLabel, "Delivery · Pickup · Dine-in");
  assert.equal(S({ deliveryEnabled: false, pickupEnabled: true, dineInEnabled: false }).fulfillmentLabel, "Pickup");
  assert.equal(S({ deliveryEnabled: false, pickupEnabled: false, dineInEnabled: false }).fulfillmentLabel, "Ordering unavailable");
});

console.log(`\n${passed} checks passed`);
