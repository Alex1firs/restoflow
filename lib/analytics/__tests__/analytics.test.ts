// Unit tests for storefront analytics schema, validator, and aggregation.
// Run: npm run test:analytics   (or: npx tsx lib/analytics/__tests__/analytics.test.ts)
//
// Only the pure, framework-agnostic module (events.ts) is exercised here — the
// Firestore I/O in rollup.ts imports "server-only"/firebase-admin and is covered
// by manual/integration testing (see PHASE 2 report).

import assert from "node:assert/strict";
import {
  validateIngestPayload,
  aggregateEvents,
  lagosDateKey,
  EVENT_COUNTER,
  CLIENT_EVENT_TYPES,
  SERVER_EVENT_TYPES,
  type CleanEvent,
} from "../events";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log("analytics: validator");

test("accepts a valid client batch and normalizes fields", () => {
  const r = validateIngestPayload({
    slug: "food-kapitol",
    events: [
      { type: "storefront_visit" },
      { type: "menu_item_view", itemId: "abc" },
      { type: "add_to_cart", itemId: "abc" },
      { type: "fulfillment_selected", fulfillment: "delivery" },
      { type: "payment_method_selected", method: "online" },
    ],
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.data.slug, "food-kapitol");
    assert.equal(r.data.events.length, 5);
  }
});

test("REJECTS server-only event types from a client (anti-forgery)", () => {
  const r = validateIngestPayload({
    slug: "grills",
    events: [{ type: "payment_successful" }, { type: "order_submitted" }, { type: "payment_initialized" }],
  });
  // All events are server-only → none survive → whole payload rejected.
  assert.equal(r.ok, false);
});

test("keeps valid events, drops invalid ones in the same batch", () => {
  const r = validateIngestPayload({
    slug: "grills",
    events: [{ type: "add_to_cart", itemId: "x" }, { type: "payment_successful" }, { type: "bogus" }, { type: "cart_opened" }],
  });
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.data.events.map((e) => e.type), ["add_to_cart", "cart_opened"]);
});

test("STRIPS PII — name/phone/address/email/sessionId never survive", () => {
  const r = validateIngestPayload({
    slug: "grills",
    events: [{
      type: "checkout_started",
      customerName: "Ada Obi", phone: "08030000000", address: "12 Main St",
      email: "a@b.com", sessionId: "sess-123", itemId: "keep-me",
    }],
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    const ev = r.data.events[0];
    assert.deepEqual(Object.keys(ev).sort(), ["itemId", "type"]);
    assert.equal(JSON.stringify(ev).includes("Ada"), false);
    assert.equal(JSON.stringify(ev).includes("0803"), false);
    assert.equal(JSON.stringify(ev).includes("Main St"), false);
    assert.equal(JSON.stringify(ev).includes("a@b.com"), false);
    assert.equal(JSON.stringify(ev).includes("sess-123"), false);
  }
});

test("rejects bad slug (path chars) and empty batches", () => {
  assert.equal(validateIngestPayload({ slug: "../etc/passwd", events: [{ type: "cart_opened" }] }).ok, false);
  assert.equal(validateIngestPayload({ slug: "a/b", events: [{ type: "cart_opened" }] }).ok, false);
  assert.equal(validateIngestPayload({ slug: "grills", events: [] }).ok, false);
  assert.equal(validateIngestPayload({ events: [{ type: "cart_opened" }] }).ok, false);
  assert.equal(validateIngestPayload(null).ok, false);
});

test("caps batch at 50 events", () => {
  const many = Array.from({ length: 200 }, () => ({ type: "menu_item_view", itemId: "a" }));
  const r = validateIngestPayload({ slug: "grills", events: many });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.data.events.length, 50);
});

test("drops invalid enum values (unknown fulfillment/method)", () => {
  const r = validateIngestPayload({
    slug: "grills",
    events: [{ type: "fulfillment_selected", fulfillment: "teleport", method: "crypto" }],
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.data.events[0].fulfillment, undefined);
    assert.equal(r.data.events[0].method, undefined);
  }
});

console.log("analytics: aggregation");

test("aggregateEvents folds counters, item maps, and breakdowns", () => {
  const events: CleanEvent[] = [
    { type: "storefront_visit" },
    { type: "menu_item_view", itemId: "a" },
    { type: "menu_item_view", itemId: "a" },
    { type: "menu_item_view", itemId: "b" },
    { type: "add_to_cart", itemId: "a" },
    { type: "fulfillment_selected", fulfillment: "pickup" },
    { type: "payment_method_selected", method: "cash" },
    { type: "order_submitted", method: "cash" },
  ];
  const d = aggregateEvents(events);
  assert.equal(d.counters.visits, 1);
  assert.equal(d.counters.menu_item_views, 3);
  assert.equal(d.counters.add_to_cart, 1);
  assert.equal(d.counters.order_submitted, 1);
  assert.deepEqual(d.itemViews, { a: 2, b: 1 });
  assert.deepEqual(d.itemAdds, { a: 1 });
  assert.deepEqual(d.fulfillmentCounts, { pickup: 1 });
  assert.deepEqual(d.methodCounts, { cash: 2 }); // payment_method_selected + order_submitted
});

test("abandoned-checkout inputs are both present in the counter model", () => {
  // v1 approximation: abandoned = checkout_started - order_submitted (aggregate)
  const d = aggregateEvents([
    { type: "checkout_started" }, { type: "checkout_started" }, { type: "checkout_started" },
    { type: "order_submitted", method: "online" },
  ]);
  const abandoned = (d.counters.checkout_started ?? 0) - (d.counters.order_submitted ?? 0);
  assert.equal(abandoned, 2);
});

test("every event type maps to a counter field", () => {
  for (const t of [...CLIENT_EVENT_TYPES, ...SERVER_EVENT_TYPES]) {
    assert.equal(typeof EVENT_COUNTER[t], "string");
  }
});

test("lagosDateKey returns a YYYY-MM-DD string", () => {
  const key = lagosDateKey(new Date("2026-07-07T09:00:00Z"));
  assert.match(key, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(key, "2026-07-07");
});

console.log(`\n${passed} checks passed`);
