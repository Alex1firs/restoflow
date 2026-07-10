// Unit tests for the Live Orders UI helpers (Slice 2).
// Run: npx tsx "app/super-admin/orders/__tests__/orders-ui-lib.test.ts"

import assert from "node:assert/strict";
import { buildOrdersQuery, dayRangeMs, filterRowsByOrderId, formatAmount, formatWhen } from "../orders-ui-lib";

let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`  ✓ ${name}`); };

console.log("super-admin/orders/orders-ui-lib");

test("buildOrdersQuery: omits empty values, includes set ones", () => {
  assert.equal(buildOrdersQuery({}), "");
  assert.equal(buildOrdersQuery({ restaurantId: "grills-capitol" }), "restaurantId=grills-capitol");
  const q = buildOrdersQuery({ status: "pending", paymentStatus: "paid", limit: 50, cursor: 123 });
  assert.ok(q.includes("status=pending") && q.includes("paymentStatus=paid") && q.includes("limit=50") && q.includes("cursor=123"));
  // blank phone is dropped
  assert.equal(buildOrdersQuery({ phone: "   " }), "");
  assert.equal(buildOrdersQuery({ phone: "08000000001" }), "phone=08000000001");
});

test("dayRangeMs: yyyy-mm-dd → inclusive UTC range; blanks → null", () => {
  const { fromMs, toMs } = dayRangeMs("2026-07-09", "2026-07-09");
  assert.equal(fromMs, Date.parse("2026-07-09T00:00:00.000Z"));
  assert.equal(toMs, Date.parse("2026-07-09T23:59:59.999Z"));
  assert.deepEqual(dayRangeMs("", ""), { fromMs: null, toMs: null });
  assert.equal(dayRangeMs("bad", "").fromMs, null);
});

test("filterRowsByOrderId: exact match; blank → unchanged", () => {
  const rows = [{ orderId: "A" }, { orderId: "B" }];
  assert.deepEqual(filterRowsByOrderId(rows, "B"), [{ orderId: "B" }]);
  assert.deepEqual(filterRowsByOrderId(rows, " A "), [{ orderId: "A" }]);
  assert.deepEqual(filterRowsByOrderId(rows, ""), rows);
  assert.deepEqual(filterRowsByOrderId(rows, "Z"), []);
});

test("formatAmount: naira or em dash", () => {
  assert.equal(formatAmount(null), "—");
  assert.ok(formatAmount(4500).startsWith("₦"));
});

test("formatWhen: null → em dash; number → non-empty label", () => {
  assert.equal(formatWhen(null), "—");
  assert.ok(formatWhen(1783629528207).length > 0);
});

console.log(`\n${passed} checks passed`);
