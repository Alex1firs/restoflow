// Unit tests for the pure pre-checkout location matcher (G4).
// Run: npx tsx lib/__tests__/location-match.test.ts

import assert from "node:assert/strict";
import { classifyLocation, sameState } from "../location-match";

let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`  ✓ ${name}`); };

console.log("location-match");

test("sameState: case/space-insensitive; null-safe", () => {
  assert.equal(sameState("Anambra", "anambra"), true);
  assert.equal(sameState("  Lagos ", "Lagos"), true);
  assert.equal(sameState("Lagos", "Anambra"), false);
  assert.equal(sameState(null, "Lagos"), false);
  assert.equal(sameState(undefined, undefined), true); // both empty
});

test("no customer state → nothing shown (direct visit / no selection)", () => {
  const n = classifyLocation({ customerState: null, restaurantState: "Lagos" });
  assert.equal(n.kind, "no-customer-state");
  assert.equal(n.show, false);
  // even if restaurant also unknown, still silent
  assert.equal(classifyLocation({ customerState: "", restaurantState: null }).show, false);
});

test("same state → silent (D4)", () => {
  const n = classifyLocation({ customerState: "Anambra", restaurantState: "anambra" });
  assert.equal(n.kind, "same");
  assert.equal(n.show, false);
  assert.equal(n.title, "");
});

test("different state → out-of-area warning names both states", () => {
  const n = classifyLocation({ customerState: "Anambra", restaurantState: "Lagos" });
  assert.equal(n.kind, "different");
  assert.equal(n.show, true);
  assert.match(n.title, /Lagos/);
  assert.match(n.title, /Anambra/);
  assert.match(n.body, /pickup/);
});

test("restaurant unknown + customer has state → soft note (D5)", () => {
  const n = classifyLocation({ customerState: "Anambra", restaurantState: null });
  assert.equal(n.kind, "restaurant-unknown");
  assert.equal(n.show, true);
  assert.match(n.body, /Anambra/);
});

test("restaurant unknown but NO customer state → still silent (direct-visit rule)", () => {
  const n = classifyLocation({ customerState: null, restaurantState: null });
  assert.equal(n.kind, "no-customer-state");
  assert.equal(n.show, false);
});

console.log(`\n${passed} checks passed`);
