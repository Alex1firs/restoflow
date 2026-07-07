// Unit tests for the menuItemId → dishId seam (Sprint 2.5b / option ③).
// Proves the forward-compatible resolver preference AND that existing behavior
// (online orders, legacy orders, POS orders) is unchanged.
// Run: npx tsx lib/discovery/__tests__/order-line-dishid.test.ts

import assert from "node:assert/strict";
import { orderLineToDishId } from "../firestore-store";

let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`  ✓ ${name}`); };

console.log("discovery/order-line-dishid");

test("prefers menuItemId when present", () => {
  assert.deepEqual(orderLineToDishId({ id: "cartOrPosId", menuItemId: "MENU_1", quantity: 2 }), { dishId: "MENU_1", quantity: 2 });
});

test("online orders unchanged: menuItemId === id → same dishId as before", () => {
  // Online routes now write menuItemId: item.id, so both equal the menu_items id.
  assert.deepEqual(orderLineToDishId({ id: "MENU_1", menuItemId: "MENU_1", quantity: 1 }), { dishId: "MENU_1", quantity: 1 });
});

test("legacy orders unchanged: no menuItemId field → falls back to id", () => {
  assert.deepEqual(orderLineToDishId({ id: "OLD_ID", quantity: 3 }), { dishId: "OLD_ID", quantity: 3 });
});

test("POS orders unchanged: menuItemId null → falls back to id (prepared_items id, still unmatched)", () => {
  // POS routes write menuItemId: dbItem.menuItemId ?? null; today that's null,
  // so the prepared_items id is used — exactly as before — keeping POS-only
  // items restaurant-level only (they won't match menu_items-backed discovery).
  assert.deepEqual(orderLineToDishId({ id: "PREP_9", menuItemId: null, quantity: 1 }), { dishId: "PREP_9", quantity: 1 });
});

test("POS orders WITH a future menuItemId link would map to the menu dish", () => {
  // If prepared_items ever gains a menuItemId, the seam carries it through with
  // no further discovery change.
  assert.deepEqual(orderLineToDishId({ id: "PREP_9", menuItemId: "MENU_7", quantity: 4 }), { dishId: "MENU_7", quantity: 4 });
});

test("empty menuItemId string is ignored (falls back to id)", () => {
  assert.deepEqual(orderLineToDishId({ id: "ID_1", menuItemId: "", quantity: 1 }), { dishId: "ID_1", quantity: 1 });
});

test("robust to junk: missing id / non-number quantity", () => {
  assert.deepEqual(orderLineToDishId({ quantity: "x" }), { dishId: "", quantity: 0 });
  assert.deepEqual(orderLineToDishId(null), { dishId: "", quantity: 0 });
  assert.deepEqual(orderLineToDishId({ id: 123 as unknown as string }), { dishId: "", quantity: 0 });
});

test("adding menuItemId does NOT change quantity/total math — quantity passes through untouched", () => {
  // The seam only affects dishId resolution; quantity (and hence any qty-weighted
  // popularity or totals) is identical whether or not menuItemId is present.
  const withId = orderLineToDishId({ id: "MENU_1", quantity: 5 });
  const withBoth = orderLineToDishId({ id: "MENU_1", menuItemId: "MENU_1", quantity: 5 });
  assert.equal(withId.quantity, withBoth.quantity);
  assert.equal(withId.dishId, withBoth.dishId);
});

console.log(`\n${passed} checks passed`);
