/**
 * RestoFlow Connect — Slices 1 and 2.
 *
 *   npx tsx lib/connect/__tests__/connect.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readConnectSettings, connectReadiness, CONNECT_OFF } from "../config";
import { priceConnectDelivery } from "../pricing";
import { connectEntries, connectBalance, CONNECT_ACCOUNTS } from "../ledger";
import { dispatcherMustStaySilent } from "@/lib/marketplace/notifications";

let passed = 0;
const test = (name: string, fn: () => void) => {
  try { fn(); passed++; console.log("  ✓ " + name); }
  catch (e) { console.error("  ✗ " + name + "\n    " + (e as Error).message); process.exitCode = 1; }
};
console.log("\nRestoFlow Connect — foundation + quote/request\n");

const root = join(__dirname, "..", "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const active = { connect: { state: "active", marginBps: 1000 } };

// ── Capability gate ─────────────────────────────────────────────────────────

test("[1] a restaurant with no connect block is not a Connect partner", () => {
  for (const raw of [null, undefined, {}, { connect: null }, { connect: [] }, { connect: "yes" }]) {
    assert.deepEqual(readConnectSettings(raw as never), CONNECT_OFF, JSON.stringify(raw));
  }
});

test("[2] approval alone does not activate, and a margin alone does not either", () => {
  // Same two-switch reasoning as the marketplace: neither half is sufficient.
  assert.equal(readConnectSettings({ connect: { state: "active" } }).enabled, false, "no margin");
  assert.equal(readConnectSettings({ connect: { marginBps: 1000 } }).enabled, false, "not approved");
  assert.equal(readConnectSettings(active).enabled, true);
});

test("[3] a Connect partner needs neither a marketplace listing nor a menu", () => {
  // The whole premise: orders arrive on WhatsApp. Nothing here reads
  // marketplace state, menus or a storefront.
  // Code, not prose — the comments describe orders arriving on WhatsApp, which
  // is the point rather than a dependency.
  const src = read("lib/connect/config.ts");
  for (const forbidden of ["marketplaceEnabled", "menu_items", 'collection("orders")', "readMarketplaceSettings"]) {
    assert.ok(!src.includes(forbidden), `Connect must not depend on ${forbidden}`);
  }
});

test("[4] suspended and onboarding partners cannot request couriers", () => {
  const env = { isProduction: false };
  for (const [state, reason] of [["off","connect_not_enabled"],["onboarding","connect_not_approved"],["suspended","connect_suspended"]] as const) {
    const r = connectReadiness(readConnectSettings({ connect: { state, marginBps: 1000 } }), env);
    assert.equal(r.ok, false);
    assert.equal((r as { reason: string }).reason, reason);
  }
});

// ── The margin ──────────────────────────────────────────────────────────────

test("[5] the partner price is Dispatcher cost plus the configured margin", () => {
  const p = priceConnectDelivery({ dispatcherCostMinor: 120_000, marginBps: 1000 });
  assert.equal(p.dispatcherCostMinor, 120_000);
  assert.equal(p.marginMinor, 12_000);
  assert.equal(p.partnerPriceMinor, 132_000);
});

test("[6] the margin is per-partner, never a constant in the code", () => {
  for (const [bps, expected] of [[0, 0], [500, 5_000], [1000, 10_000], [2500, 25_000]] as const) {
    assert.equal(priceConnectDelivery({ dispatcherCostMinor: 100_000, marginBps: bps }).marginMinor, expected);
  }
  const src = read("lib/connect/pricing.ts");
  assert.ok(!/\b1000\b/.test(src.replace(/10_000/g, "")), "no hardcoded bps may live in the pricing rule");
});

test("[7] the margin is computed from cost, not from the total", () => {
  // Deriving it from the total makes the margin a function of itself.
  const p = priceConnectDelivery({ dispatcherCostMinor: 100_000, marginBps: 1000 });
  assert.equal(p.marginMinor, 10_000, "10% of cost");
  assert.notEqual(p.marginMinor, Math.round(p.partnerPriceMinor * 0.1));
});

test("[8] rounding never loses or invents a kobo", () => {
  for (const cost of [1, 7, 333, 99_999, 123_457]) {
    const p = priceConnectDelivery({ dispatcherCostMinor: cost, marginBps: 1000 });
    assert.equal(p.partnerPriceMinor, p.dispatcherCostMinor + p.marginMinor, `cost ${cost}`);
    assert.ok(Number.isInteger(p.marginMinor));
  }
});

// ── Production cannot inherit the staging test margin ───────────────────────

test("[9] a test margin is refused in production and allowed on staging", () => {
  const s = readConnectSettings({ connect: { state: "active", marginBps: 1000, marginIsTest: true } });
  assert.equal(connectReadiness(s, { isProduction: false }).ok, true, "staging may use a labelled test margin");
  const prod = connectReadiness(s, { isProduction: true });
  assert.equal(prod.ok, false);
  assert.equal((prod as { reason: string }).reason, "connect_margin_is_test_value");
});

test("[10] production activation requires a real configured margin", () => {
  const noMargin = readConnectSettings({ connect: { state: "active" } });
  assert.equal(connectReadiness(noMargin, { isProduction: true }).ok, false);
});

// ── Billing ─────────────────────────────────────────────────────────────────

test("[11] V1 is prepaid, and invoiced terms are refused rather than half-honoured", () => {
  const inv = readConnectSettings({ connect: { state: "active", marginBps: 1000, billingMode: "invoiced" } });
  assert.equal(inv.billingMode, "invoiced");
  const r = connectReadiness(inv, { isProduction: false });
  assert.equal(r.ok, false);
  assert.equal((r as { reason: string }).reason, "connect_billing_mode_unsupported");
});

test("[12] an unknown billing mode reads as prepaid, never as credit", () => {
  assert.equal(readConnectSettings({ connect: { billingMode: "whatever" } }).billingMode, "prepaid");
});

// ── The ledger ──────────────────────────────────────────────────────────────

test("[13] a Connect delivery's books balance to zero", () => {
  const price = priceConnectDelivery({ dispatcherCostMinor: 120_000, marginBps: 1000 });
  const entries = connectEntries({ deliveryId: "cn_1", restaurantId: "r1", price, nowMs: 1 });
  assert.equal(connectBalance(entries), 0);
  assert.equal(entries.length, 3);
});

test("[14] the shape is delivery-only — no customer payment is invented", () => {
  // The marketplace ledger starts from money RestoFlow collected. Connect never
  // touches the customer's money, and a `customer` entry here would be a
  // movement that did not happen.
  assert.deepEqual([...CONNECT_ACCOUNTS].sort(), ["connect_revenue", "delivery_payable", "partner_receivable"]);
  const entries = connectEntries({
    deliveryId: "cn_1", restaurantId: "r1", nowMs: 1,
    price: priceConnectDelivery({ dispatcherCostMinor: 120_000, marginBps: 1000 }),
  });
  const by = Object.fromEntries(entries.map((e) => [e.account, e.amountMinor]));
  assert.equal(by.partner_receivable, 132_000, "the partner owes the full price");
  assert.equal(by.delivery_payable, -120_000, "we owe Dispatcher its cost");
  assert.equal(by.connect_revenue, -12_000, "we keep the margin");
});

test("[15] the staging 10% margin balances", () => {
  for (const cost of [85_000, 120_000, 333_333]) {
    const entries = connectEntries({
      deliveryId: "cn_x", restaurantId: "r1", nowMs: 1,
      price: priceConnectDelivery({ dispatcherCostMinor: cost, marginBps: 1000 }),
    });
    assert.equal(connectBalance(entries), 0, `cost ${cost}`);
  }
});

test("[16] ledger ids are deterministic, so a replay cannot double the books", () => {
  const price = priceConnectDelivery({ dispatcherCostMinor: 120_000, marginBps: 1000 });
  const a = connectEntries({ deliveryId: "cn_1", restaurantId: "r1", price, nowMs: 1 });
  const b = connectEntries({ deliveryId: "cn_1", restaurantId: "r1", price, nowMs: 99 });
  assert.deepEqual(a.map((x) => x.id), b.map((x) => x.id));
});

// ── Dispatcher classification and silence ───────────────────────────────────

test("[17] Dispatcher stays silent for Connect as well as the marketplace", () => {
  assert.equal(dispatcherMustStaySilent({ partner: "restoflow_connect" }), true);
  assert.equal(dispatcherMustStaySilent({ partner: "restoflow_marketplace" }), true, "unchanged");
  assert.equal(dispatcherMustStaySilent({ partner: "some_other_client" }), false);
  assert.equal(dispatcherMustStaySilent({ partner: null }), false);
});

test("[18] the service sends what Dispatcher requires, and no margin", () => {
  const src = read("lib/connect/service.ts");
  assert.match(src, /deliveryFeeMinor: existing\.quote\.dispatcherCostMinor/,
    "Dispatcher must be paid its cost — RestoFlow's margin is not its business");
  assert.ok(!/partnerPriceMinor/.test(src.slice(src.indexOf("const req: CreateDeliveryRequest"), src.indexOf("const res = await c.createDelivery"))),
    "the partner price must never cross into the Dispatcher request");
  assert.match(src, /paymentCollection: "NONE"/);
  assert.match(src, /externalOrderId: existing\.id/, "the Connect id is the idempotency anchor");
});

test("[19] a Connect delivery creates no marketplace order", () => {
  const src = read("lib/connect/service.ts") + read("lib/connect/store.ts");
  for (const forbidden of ['collection("orders")', "marketplaceState", "orderSource"]) {
    assert.ok(!src.includes(forbidden), `Connect must not touch ${forbidden}`);
  }
});

// ── Quote expiry ────────────────────────────────────────────────────────────

test("[20] an expired quote is refused rather than assumed still good", () => {
  const src = read("lib/connect/service.ts");
  assert.match(src, /expiresAtMs <= nowMs/);
  assert.match(src, /reason: "quote_expired"/);
});

test("[21] the quote expiry is the earlier of Dispatcher's and ours", () => {
  const src = read("lib/connect/service.ts");
  assert.match(src, /Math\.min\(dispatcherExpiry, nowMs \+ QUOTE_TTL_MS\)/);
});

// ── Isolation ───────────────────────────────────────────────────────────────

test("[22] reads are scoped, and a foreign id is indistinguishable from a missing one", () => {
  const src = read("lib/connect/store.ts");
  const get = src.slice(src.indexOf("async get("), src.indexOf("async getInternal("));
  assert.match(get, /if \(d\.restaurantId !== restaurantId\) return null;/);
});

test("[23] the restaurant comes from the session, never from the request", () => {
  const http = read("lib/connect/http.ts");
  assert.match(http, /user\.restaurantSlug/);
  const routes = read("app/api/admin/connect/deliveries/route.ts")
    + read("app/api/admin/connect/deliveries/[id]/request/route.ts");
  assert.ok(!/body\.restaurantId|params\.slug/.test(routes),
    "a caller-supplied restaurant would make cross-tenant access a typo away");
});

test("[24] a non-Connect restaurant cannot tell that Connect exists", () => {
  const http = read("lib/connect/http.ts");
  assert.match(http, /status: 404/, "refusal must not confirm the capability");
});

test("[25] Connect records are server-only in the rules", () => {
  const rules = read("firestore.rules");
  for (const c of ["connect_deliveries", "connect_handover", "connect_ledger_entries"]) {
    const block = rules.slice(rules.indexOf(`match /${c}/`));
    // The path segment itself contains braces ({deliveryId}), so the block body
    // starts after the FIRST "{" that opens the rule, not the first "}".
    const body = block.slice(block.indexOf("{", block.indexOf("/")), block.indexOf("allow write"));
    assert.match(body, /allow read:\s+if false;/, `${c} must not be client-readable`);
    assert.ok(!/isRestaurantMember/.test(body), `${c} must be server-only, not merely tenant-scoped`);
  }
});

test("[26] the partner is never shown the Dispatcher cost or the margin", () => {
  const src = read("app/api/admin/connect/deliveries/route.ts");
  const redact = src.slice(src.indexOf("function redact("));
  for (const leak of ["dispatcherCostMinor", "marginMinor", "marginBps"]) {
    assert.ok(!redact.includes(leak), `redacted projection leaks ${leak}`);
  }
  assert.match(redact, /priceMinor: d\.quote\.partnerPriceMinor/, "one number: what they pay");
});

test("[27] the receiving code never reaches the partner", () => {
  const src = read("app/api/admin/connect/deliveries/route.ts")
    + read("app/api/admin/connect/deliveries/[id]/request/route.ts");
  assert.ok(!src.includes("receivingCode"), "the customer's proof is not the partner's to hold");
  assert.match(src, /pickupCode/, "the pickup code IS the partner's, so staff can check the rider");
});

// ── Activation ──────────────────────────────────────────────────────────────

test("[28] activation is a super-admin act and demands a margin", () => {
  const src = read("app/api/super-admin/connect/[slug]/route.ts");
  assert.match(src, /getSuperAdminUser/);
  assert.match(src, /marginBps is required/);
  assert.ok(!/marginBps\s*\?\?\s*\d/.test(src), "there must be no default margin to fall back on");
});

console.log(`\n${passed} checks passed\n`);
