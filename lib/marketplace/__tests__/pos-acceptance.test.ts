/**
 * The restaurant's Accept, on the screen the restaurant actually uses.
 *
 * A marketplace order is not a row with a `status` column: accepting one books
 * a courier and rejecting one refunds a customer. These are structural
 * assertions over the real client, because the screen needs a browser and
 * Firestore — but what a unit test CAN pin down is that marketplace orders do
 * not take the counter path, and that counter orders still do.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

let passed = 0;
const test = (n: string, f: () => void) => { f(); passed++; console.log(`  ✓ ${n}`); };
console.log("marketplace/pos-acceptance");

const ROOT = join(__dirname, "..", "..", "..");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const UI = strip(readFileSync(join(ROOT, "app/admin/[slug]/orders/AdminOrdersClient.tsx"), "utf8"));
const ROUTE = strip(readFileSync(join(ROOT, "app/api/admin/marketplace/orders/[orderId]/route.ts"), "utf8"));

test("[1] accepting a marketplace order goes through the marketplace machine", () => {
  // The bug this prevents: PATCHing `status` moves the card on screen, leaves
  // fulfillment.restaurantState at `placed`, and never requests a rider.
  assert.match(UI, /marketplaceAction\(orderId, "accept"\)/);
  assert.match(UI, /api\/admin\/marketplace\/orders/);
});

test("[2] counter orders still take the path they always have", () => {
  // POS ordering must not change. The legacy status PATCH is still there,
  // reached whenever the order is not a marketplace one.
  assert.match(UI, /api\/orders\/\$\{orderId\}\/status/);
  assert.match(UI, /isMarketplace\(orderId\)/);
});

test("[3] a marketplace rejection cannot be filed without a reason", () => {
  // It refunds real money; "rejected, no reason given" is not good enough.
  assert.match(UI, /A reason is required to reject a marketplace order/);
  assert.match(ROUTE, /A reason is required to reject an order/);
});

test("[4] Accept requests the courier before it says the kitchen has started", () => {
  const accept = UI.indexOf('marketplaceAction(orderId, "accept")');
  const preparing = UI.indexOf('marketplaceAction(orderId, "preparing")');
  assert.ok(accept > -1 && preparing > accept,
    "accept must be sent first — it is the transition that books the rider");
});

test("[5] the acceptance route is the only handoff trigger", () => {
  assert.match(ROUTE, /requestDeliveryForOrder/);
  const accepted = ROUTE.indexOf('result.to === "accepted"');
  assert.ok(accepted > -1 && ROUTE.indexOf("requestDeliveryForOrder", accepted) > accepted);
});

console.log(`\n${passed} checks passed\n`);
