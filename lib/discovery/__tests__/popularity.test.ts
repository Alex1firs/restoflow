// Unit tests for the pure popularity engine (Sprint 2.3).
// Run: npx tsx lib/discovery/__tests__/popularity.test.ts

import assert from "node:assert/strict";
import {
  computePopularity,
  buildDishUpdates,
  buildRestaurantUpdates,
  POPULARITY_WINDOW_DAYS,
  type PopularityOrder,
} from "../popularity";
import { NEUTRAL_POPULARITY } from "../types";

let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`  ✓ ${name}`); };
const approx = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

const NOW = 1_760_000_000_000;
const DAY = 86_400_000;
const line = (dishId: string, quantity = 1) => ({ dishId, quantity });
const order = (
  restaurantSlug: string,
  ageDays: number,
  lines: { dishId: string; quantity: number }[],
  opts: { paymentStatus?: string; status?: string } = {},
): PopularityOrder => ({
  restaurantSlug,
  createdAtMs: NOW - ageDays * DAY,
  paymentStatus: opts.paymentStatus ?? "paid",
  status: opts.status ?? "accepted",
  lines,
});

console.log("discovery/popularity");

test("only paid + non-rejected orders count", () => {
  const orders = [
    order("k", 0, [line("A", 1)]),                                  // paid → counts
    order("k", 0, [line("A", 10)], { paymentStatus: "pending" }),   // unpaid → ignored
    order("k", 0, [line("A", 10)], { status: "rejected" }),         // rejected → ignored
  ];
  const r = computePopularity(orders, NOW);
  approx(r.dish.get("A")!.raw, 1);
  assert.equal(r.dish.get("A")!.orders, 1);
});

test("orders outside the 30-day window are excluded", () => {
  const orders = [
    order("k", 0, [line("A", 1)]),
    order("k", POPULARITY_WINDOW_DAYS + 5, [line("A", 100)]), // too old
  ];
  const r = computePopularity(orders, NOW);
  approx(r.dish.get("A")!.raw, 1);
  assert.equal(r.dish.get("A")!.orders, 1);
});

test("recency decay — an order at the half-life weighs half of a fresh one", () => {
  const r = computePopularity([order("k", 0, [line("A", 1)]), order("k", 14, [line("B", 1)])], NOW);
  approx(r.dish.get("A")!.raw, 1);
  approx(r.dish.get("B")!.raw, 0.5); // 14-day half-life
});

test("quantity-weighted lines (qty 3 counts triple)", () => {
  const r = computePopularity([order("k", 0, [line("A", 3)])], NOW);
  approx(r.dish.get("A")!.raw, 3);
});

test("zero-qty / missing-id lines are ignored", () => {
  const r = computePopularity([order("k", 0, [line("A", 0), { dishId: "", quantity: 5 }, line("B", 2)])], NOW);
  assert.equal(r.dish.has("A"), false);
  assert.equal(r.dish.has(""), false);
  approx(r.dish.get("B")!.raw, 2);
});

test("within+cross blend is food-first: a small restaurant's TOP dish beats a big restaurant's weak dish", () => {
  const orders: PopularityOrder[] = [];
  // Big restaurant R1: dish A dominant (raw 20, 5 orders), dish B weak (raw 5, 5 orders)
  for (let i = 0; i < 5; i++) orders.push(order("r1", 0, [line("A", 4)]));
  for (let i = 0; i < 5; i++) orders.push(order("r1", 0, [line("B", 1)]));
  // Small restaurant R2: dish C is its #1 (raw 4, 4 orders) — lower RAW than B
  for (let i = 0; i < 4; i++) orders.push(order("r2", 0, [line("C", 1)]));

  const r = computePopularity(orders, NOW);
  const B = r.dish.get("B")!.score;
  const C = r.dish.get("C")!.score;
  assert.ok(r.dish.get("B")!.raw > r.dish.get("C")!.raw, "B has higher raw than C");
  assert.ok(C > B, `small-restaurant top dish C (${C.toFixed(3)}) should outrank weak dish B (${B.toFixed(3)})`);
});

test("confidence blend pulls low-evidence dishes toward neutral 0.5", () => {
  // A single order → strong blended score but low confidence → near 0.5.
  const one = computePopularity([order("k", 0, [line("A", 1)])], NOW);
  const single = one.dish.get("A")!.score;
  assert.ok(single > 0.5 && single < 0.75, `1 order → nudged but near neutral (${single.toFixed(3)})`);

  // Many orders of the sole/top dish → high confidence → approaches its blended score.
  const many: PopularityOrder[] = [];
  for (let i = 0; i < 10; i++) many.push(order("k", 0, [line("A", 1)]));
  const strong = computePopularity(many, NOW).dish.get("A")!.score;
  assert.ok(strong > 0.95, `10 orders on the top dish → ~1 (${strong.toFixed(3)})`);
});

test("restaurant popularity aggregates its dishes", () => {
  const r = computePopularity([order("k", 0, [line("A", 2), line("B", 1)])], NOW);
  approx(r.restaurant.get("k")!.raw, 3);
  assert.equal(r.restaurant.get("k")!.orders, 1);
});

test("empty orders → no scores; update builders emit neutral for every doc", () => {
  const r = computePopularity([], NOW);
  assert.equal(r.dish.size, 0);
  const updates = buildDishUpdates(r, ["A", "B"]);
  assert.equal(updates.length, 2);
  for (const u of updates) {
    assert.equal(u.popularityScore, NEUTRAL_POPULARITY);
    assert.equal(u.popularityRaw, 0);
    assert.equal(u.popularityOrders, 0);
    assert.equal(u.signalsComputedAt, NOW);
  }
});

test("update builders: scored docs get computed values, unlisted docs reset to neutral", () => {
  const r = computePopularity([order("k", 0, [line("A", 5)])], NOW);
  const updates = buildDishUpdates(r, ["A", "GONE"]);
  const a = updates.find((u) => u.id === "A")!;
  const gone = updates.find((u) => u.id === "GONE")!;
  assert.ok(a.popularityRaw > 0 && a.popularityOrders === 1);
  assert.equal(gone.popularityScore, NEUTRAL_POPULARITY); // demand gone → decays to neutral
  assert.equal(gone.popularityRaw, 0);
  // restaurant builder mirrors
  const rUpdates = buildRestaurantUpdates(r, ["k", "empty"]);
  assert.ok(rUpdates.find((u) => u.id === "k")!.popularityOrders === 1);
  assert.equal(rUpdates.find((u) => u.id === "empty")!.popularityScore, NEUTRAL_POPULARITY);
});

test("no owner vanity fields are consulted — only order lines drive the score", () => {
  // (Structural: computePopularity's only input is orders. This documents intent.)
  const r = computePopularity([order("k", 0, [line("A", 1)])], NOW);
  assert.ok(r.dish.has("A"));
});

console.log(`\n${passed} checks passed`);
