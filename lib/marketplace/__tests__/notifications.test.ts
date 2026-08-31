// Notification ownership: exactly one sender per audience, no duplicates.
// Run: npx tsx lib/marketplace/__tests__/notifications.test.ts

import assert from "node:assert/strict";
import { DELIVERY_STATES, type DeliveryState } from "../../delivery/contract";
import {
  NOTIFICATION_OWNER, dispatcherMustStaySilent, customerMessage, restaurantMessage,
  shouldPushForDelivery, customerEventForRestaurantState, CUSTOMER_PUSH_STATES,
  type CustomerEvent,
} from "../notifications";

let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`  ✓ ${name}`); };
console.log("marketplace/notifications");

test("[1] ownership: RestoFlow owns the customer and the restaurant, Dispatcher the rider", () => {
  assert.equal(NOTIFICATION_OWNER.customer, "restoflow");
  assert.equal(NOTIFICATION_OWNER.restaurant, "restoflow");
  assert.equal(NOTIFICATION_OWNER.rider, "dispatcher");
});

test("[2] THE DUPLICATE GUARD: Dispatcher stays silent on marketplace jobs", () => {
  assert.equal(dispatcherMustStaySilent({ partner: "restoflow_marketplace" }), true);
  // …and keeps notifying for its own merchants, which is its job.
  assert.equal(dispatcherMustStaySilent({ partner: "woocommerce" }), false);
  assert.equal(dispatcherMustStaySilent({ partner: null }), false);
  assert.equal(dispatcherMustStaySilent({}), false);
  assert.equal(dispatcherMustStaySilent({ isExternal: true }), false, "isExternal alone is not enough — WooCommerce is external too");
});

const msg = (event: CustomerEvent, over = {}) => customerMessage({
  event, orderId: "o1", orderCode: "RF-ABC123", restaurantName: "Trisha's Kitchen", ...over,
});

test("[3] every customer event produces a title and a body", () => {
  const events: CustomerEvent[] = [
    "payment_successful", "restaurant_accepted", "preparing", "courier_assigned",
    "courier_to_restaurant", "courier_at_restaurant", "picked_up", "on_the_way",
    "arriving", "delivered", "delivery_issue", "order_rejected", "refund_issued",
  ];
  for (const e of events) {
    const m = msg(e);
    assert.ok(m.title.length > 0, e);
    assert.ok(m.body.length > 0, e);
    assert.equal(m.data.type, e);
  }
});

test("[4] delivery copy comes from ONE source — the tracking screen's own words", () => {
  const push = msg("picked_up", { driverFirstName: "Kelechi" });
  assert.match(push.title, /picked up/i);
  // The same function the tracking screen calls, so the two can never diverge.
  const onTheWay = msg("on_the_way", { driverFirstName: "Kelechi" });
  assert.match(onTheWay.title, /on the way/i);
});

test("[5] the push payload carries NO personal information", () => {
  const m = msg("courier_assigned", { driverFirstName: "Kelechi" });
  assert.deepEqual(Object.keys(m.data).sort(), ["orderCode", "orderId", "type"]);
  const s = JSON.stringify(m.data);
  for (const leak of ["phone", "address", "+234", "email", "customerId"]) {
    assert.equal(s.includes(leak), false, leak);
  }
});

test("[6] only a short list of states is worth waking a phone for", () => {
  assert.equal(shouldPushForDelivery("DRIVER_ASSIGNED"), true);
  assert.equal(shouldPushForDelivery("PICKED_UP"), true);
  assert.equal(shouldPushForDelivery("ARRIVING"), true);
  assert.equal(shouldPushForDelivery("DELIVERED"), true);
  assert.equal(shouldPushForDelivery("DRIVER_TO_PICKUP"), false);
  assert.equal(shouldPushForDelivery("SEARCHING_FOR_DRIVER"), false);
  assert.equal(shouldPushForDelivery("REASSIGNING"), false, "reassignment is not the customer's problem to be woken for");
  assert.ok(CUSTOMER_PUSH_STATES.length < DELIVERY_STATES.length / 2, "a push for every transition trains people to ignore them");
});

test("[7] a rejection is urgent and promises the refund", () => {
  const m = msg("order_rejected");
  assert.equal(m.urgent, true);
  assert.match(m.body, /refund/i);
});

test("[8] a delivery issue never exposes the operational reason", () => {
  const m = msg("delivery_issue");
  const text = `${m.title} ${m.body}`;
  for (const internal of ["CUSTOMER_UNREACHABLE", "DELIVERY_FAILED", "returned_to_sender", "deliveryBoy"]) {
    assert.equal(text.includes(internal), false, internal);
  }
});

test("[9] no customer message leaks an internal state name", () => {
  const events: CustomerEvent[] = ["courier_assigned", "picked_up", "on_the_way", "arriving", "delivered"];
  for (const e of events) {
    const m = msg(e);
    const text = `${m.title} ${m.body}`;
    for (const state of DELIVERY_STATES as readonly string[]) {
      assert.equal(text.includes(state), false, `${e} leaked ${state}`);
    }
  }
});

test("[10] THE RESTAURANT SEES ITS OWN SUBTOTAL, never the customer's total", () => {
  const m = restaurantMessage({
    event: "new_marketplace_order", orderCode: "RF-ABC123",
    itemsSummary: "1× Jollof", restaurantSubtotalMinor: 1_000_000, // ₦10,000
  });
  assert.match(m.text, /₦10,000/);
  assert.equal(m.text.includes("12,000"), false, "the marked-up price must not reach the kitchen");
  assert.equal(m.text.includes("14,000"), false);
});

test("[11] a new marketplace order is unmistakable and urgent", () => {
  const m = restaurantMessage({
    event: "new_marketplace_order", orderCode: "RF-1", itemsSummary: "2× Suya", restaurantSubtotalMinor: 500_000,
  });
  assert.equal(m.urgent, true);
  assert.match(m.text, /NEW ONLINE ORDER/);
  assert.match(m.text, /RestoFlow Marketplace/);
  assert.match(m.text, /PAID/);
  assert.match(m.text, /Delivery/);
});

test("[12] courier-timing alerts exist so hot food is not left on a pass", () => {
  for (const event of ["courier_assigned", "courier_arriving", "courier_at_restaurant"] as const) {
    const m = restaurantMessage({
      event, orderCode: "RF-1", itemsSummary: "", restaurantSubtotalMinor: 0, driverFirstName: "Kelechi",
    });
    assert.match(m.text, /Kelechi/);
  }
  assert.equal(restaurantMessage({
    event: "courier_at_restaurant", orderCode: "RF-1", itemsSummary: "", restaurantSubtotalMinor: 0,
  }).urgent, true);
});

test("[13] restaurant-state changes map to at most one customer event", () => {
  assert.equal(customerEventForRestaurantState("accepted"), "restaurant_accepted");
  assert.equal(customerEventForRestaurantState("preparing"), "preparing");
  assert.equal(customerEventForRestaurantState("rejected"), "order_rejected");
  // `placed` and `ready` are covered by payment and delivery events — telling
  // the customer twice about one thing is the failure this table prevents.
  assert.equal(customerEventForRestaurantState("placed"), null);
  assert.equal(customerEventForRestaurantState("ready"), null);
});

test("[14] every delivery state that pushes has customer copy", () => {
  for (const s of CUSTOMER_PUSH_STATES) {
    const m = customerMessage({
      event: "on_the_way", orderId: "o", orderCode: "RF-1",
      restaurantName: "T", deliveryState: s as DeliveryState,
    });
    assert.ok(m.title.length > 0, s);
  }
});

console.log(`\n${passed} checks passed\n`);
