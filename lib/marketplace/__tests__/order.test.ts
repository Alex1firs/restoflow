// The marketplace order: POS separation, the state machine, legacy compatibility.
// Run: npx tsx lib/marketplace/__tests__/order.test.ts

import assert from "node:assert/strict";
import { buildSnapshot, type PricingConfig } from "../pricing";
import {
  buildMarketplaceOrder, makeOrderCode, legacyStatusFor, transitionRestaurant,
  customerMayCancel, RESTAURANT_STATES, ORDER_SOURCE,
  type RestaurantState, type MarketplaceOrderItem,
} from "../order";

let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`  ✓ ${name}`); };
console.log("marketplace/order");

const T0 = 1_756_000_000_000;
const config: PricingConfig = {
  platformDefault: { type: "percent", bps: 2000 },
  restaurantDefault: null, roundToMinor: 5000, rulesVersion: 1,
};
const snapshot = buildSnapshot({
  lines: [{ dishId: "d1", name: "Jollof", quantity: 1, basePriceMinor: 1_000_000 }],
  config, deliveryFeeMinor: 200_000, deliveryCostMinor: 160_000, quoteId: "QT-1", nowMs: T0,
});
const items: MarketplaceOrderItem[] = [
  { dishId: "d1", menuItemId: "d1", name: "Jollof", quantity: 1, options: [], note: "" },
];

const order = () => buildMarketplaceOrder({
  marketplaceOrderCode: "RF-ABC123", restaurantName: "Trisha's Kitchen", restaurantId: "trishas", customerId: "cust-1",
  customerFirstName: "Amaka", customerPhone: "+2348111111111",
  deliveryAddress: "2 Mobolaji Bank", note: "extra pepper",
  deliveryLocation: { lat: 6.4474, lng: 3.4736 },
  items, pricing: snapshot, paymentReference: "pay_ref_1",
  prepMins: 25, correlationId: "corr-1", nowMs: T0,
});

test("[1] a marketplace order is unmistakably marked at the source", () => {
  assert.equal(order().orderSource, ORDER_SOURCE);
  assert.equal(order().orderSource, "marketplace");
});

test("[2] POS SEPARATION: no cashier numbering, no POS idempotency keys", () => {
  const o = order() as unknown as Record<string, unknown>;
  for (const forbidden of ["orderNumber", "localOrderId", "staffId", "staffName", "serviceMode", "tableLabel", "waiterName", "pricingMode", "auditLog"]) {
    assert.equal(forbidden in o, false, `marketplace orders must not carry ${forbidden}`);
  }
});

test("[3] the customer code is not sequential and cannot be enumerated", () => {
  const codes = new Set<string>();
  for (let i = 0; i < 500; i++) codes.add(makeOrderCode());
  assert.ok(codes.size > 490, "codes must not collide in practice");
  for (const c of codes) {
    assert.match(c, /^RF-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    // Ambiguous glyphs are excluded so a code can be read aloud.
    assert.equal(/[IO01]/.test(c.slice(3)), false);
  }
});

test("[4] LEGACY COMPATIBILITY: every field an existing screen reads is present", () => {
  const o = order();
  for (const field of ["restaurantId", "items", "itemsTotal", "deliveryFee", "total",
                       "paymentMethod", "paymentStatus", "status", "deliveryType",
                       "orderType", "customerName", "phone", "address", "note", "createdAt"]) {
    assert.ok(field in o, `missing legacy field ${field}`);
  }
});

test("[5] the legacy naira mirrors agree with the minor-unit truth", () => {
  const o = order();
  assert.equal(o.itemsTotal, 12_000);
  assert.equal(o.deliveryFee, 2_000);
  assert.equal(o.total, 14_000);
  assert.equal(o.pricing.totalChargedMinor, 1_400_000);
});

test("[6] an order exists ONLY after payment is verified", () => {
  const o = order();
  assert.equal(o.payment.state, "paid");
  assert.equal(o.paymentStatus, "paid");
  assert.equal(o.payment.reference, "pay_ref_1");
  assert.equal(o.payment.verifiedAt, T0);
});

test("[7] the price snapshot is embedded whole, not summarised", () => {
  const o = order();
  assert.equal(o.pricing.restaurantSubtotalMinor, 1_000_000);
  assert.equal(o.pricing.markupTotalMinor, 200_000);
  assert.equal(o.pricing.lines.length, 1);
  assert.equal(o.pricing.lines[0].markupApplied.source, "platform");
});

test("[8] the restaurant sees its OWN subtotal, never the customer's", () => {
  const o = order();
  assert.equal(o.pricing.restaurantPayableMinor, 1_000_000);
  assert.notEqual(o.pricing.restaurantPayableMinor, o.pricing.customerSubtotalMinor);
});

test("[9] legacy `status` is derived for every marketplace state", () => {
  for (const s of RESTAURANT_STATES) {
    const legacy = legacyStatusFor(s);
    assert.ok(["pending", "preparing", "ready", "completed", "rejected"].includes(legacy), `${s} → ${legacy}`);
  }
  assert.equal(legacyStatusFor("placed"), "pending");
  assert.equal(legacyStatusFor("preparing"), "preparing");
  assert.equal(legacyStatusFor("ready"), "ready");
  assert.equal(legacyStatusFor("rejected"), "rejected");
});

test("[10] the happy path transitions cleanly", () => {
  const path: RestaurantState[] = ["placed", "accepted", "preparing", "ready"];
  for (let i = 1; i < path.length; i++) {
    const r = transitionRestaurant(path[i - 1], path[i]);
    assert.equal(r.ok, true, `${path[i - 1]} → ${path[i]}`);
  }
});

test("[11] an illegal transition is REFUSED, not silently ignored", () => {
  assert.equal(transitionRestaurant("placed", "ready").ok, false);
  assert.equal(transitionRestaurant("ready", "preparing").ok, false);
  assert.equal(transitionRestaurant("rejected", "accepted").ok, false);
  assert.equal(transitionRestaurant("cancelled", "preparing").ok, false);
  const r = transitionRestaurant("placed", "ready");
  assert.match((r as { reason: string }).reason, /cannot move a placed order to ready/);
});

test("[12] a repeated transition is IDEMPOTENT — a double-tapped Accept works", () => {
  const r = transitionRestaurant("accepted", "accepted");
  assert.equal(r.ok, true);
  assert.equal((r as { next: string }).next, "accepted");
});

test("[13] terminal states are terminal", () => {
  for (const terminal of ["ready", "rejected", "cancelled"] as const) {
    for (const to of RESTAURANT_STATES) {
      if (to === terminal) continue;
      assert.equal(transitionRestaurant(terminal, to).ok, false, `${terminal} → ${to}`);
    }
  }
});

test("[14] a customer may cancel only before the restaurant accepts", () => {
  assert.equal(customerMayCancel("placed"), true);
  assert.equal(customerMayCancel("accepted"), false);
  assert.equal(customerMayCancel("preparing"), false);
  assert.equal(customerMayCancel("ready"), false);
});

test("[15] the order carries its correlation id for cross-system tracing", () => {
  const o = order();
  assert.equal(o.correlationId, "corr-1");
  assert.equal(o.pricing.quoteId, "QT-1");
});

test("[16] history is append-only from creation", () => {
  const o = order();
  assert.equal(o.fulfillment.history.length, 1);
  assert.equal(o.fulfillment.history[0].state, "placed");
  assert.equal(o.fulfillment.prepMins, 25);
  assert.equal(o.fulfillment.acceptedAt, null);
});

test("[17] refund and settlement start in their honest initial states", () => {
  const o = order();
  assert.equal(o.refund.state, "none");
  assert.equal(o.refund.totalMinor, 0);
  assert.equal(o.settlement.state, "unsettled");
  assert.equal(o.settlement.settlementId, null);
});

test("[18] only the customer's FIRST name is stored on the order document", () => {
  const o = order();
  assert.equal(o.customerName, "Amaka");
  assert.equal(o.customerName.includes(" "), false);
});

console.log(`\n${passed} checks passed\n`);
