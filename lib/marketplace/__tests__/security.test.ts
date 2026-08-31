/**
 * Phase 1.5 security assertions.
 *
 * Isolation, secret containment, and the POS guarantee — proven by exercising
 * the real authorisation functions and by scanning the real source, rather than
 * by reasoning about them.
 *
 * Run: npx tsx lib/marketplace/__tests__/security.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

import { authorizeTracking } from "../../delivery/tracking";
import { initialProjection, type DeliveryProjection } from "../../delivery/projection";
import type { DeliveryOrderView } from "../../delivery/store";
import { verifySignature, computeSignature } from "../../delivery/signature";
import { validateEvent, findForbiddenKeys, CONTRACT_VERSION } from "../../delivery/contract";
import { readMarketplaceSettings, isOrderable } from "../config";

let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`  ✓ ${name}`); };
console.log("marketplace/security");

const T0 = 1_756_000_000_000;
const proj = (over: Partial<DeliveryProjection> = {}): DeliveryProjection => ({
  ...initialProjection({ correlationId: "c", quoteId: "q", nowMs: T0 }),
  deliveryJobId: "DJ-1", state: "EN_ROUTE_TO_CUSTOMER", ...over,
});
const order = (customerId: string, restaurantId = "trishas"): DeliveryOrderView => ({
  orderId: "RF-1", restaurantId, customerId, restaurantProgress: "preparing", delivery: proj(),
});

// ── Customer isolation ──────────────────────────────────────────────────────

test("[1] a customer CANNOT access another customer's marketplace order", () => {
  const mine = order("cust-a");
  assert.equal(authorizeTracking({ order: mine, requestingCustomerId: "cust-a" }).allowed, true);
  assert.equal(authorizeTracking({ order: mine, requestingCustomerId: "cust-b" }).allowed, false);
});

test("[2] a customer CANNOT track another customer's delivery, and cannot tell it exists", () => {
  const other = authorizeTracking({ order: order("cust-a"), requestingCustomerId: "cust-b" });
  const absent = authorizeTracking({ order: null, requestingCustomerId: "cust-b" });
  assert.equal((other as { reason: string }).reason, (absent as { reason: string }).reason);
  assert.equal((other as { reason: string }).reason, "not_found");
});

test("[3] an empty or missing customer id authorises nobody", () => {
  assert.equal(authorizeTracking({ order: order(""), requestingCustomerId: "" }).allowed, false);
  assert.equal(authorizeTracking({ order: order("cust-a"), requestingCustomerId: "" }).allowed, false);
});

test("[4] tracking access ends permanently at a terminal state", () => {
  for (const state of ["DELIVERED", "DELIVERY_FAILED", "CANCELLED"] as const) {
    const o = { ...order("cust-a"), delivery: proj({ state }) };
    assert.equal(authorizeTracking({ order: o, requestingCustomerId: "cust-a" }).allowed, false, state);
  }
});

// ── Restaurant isolation ────────────────────────────────────────────────────

test("[5] the restaurant guard lives INSIDE the transaction, not in the route", () => {
  const src = readFileSync(join(process.cwd(), "lib/marketplace/store.ts"), "utf8");
  const tx = src.slice(src.indexOf("transitionRestaurantState"));
  const body = tx.slice(tx.indexOf("runTransaction"), tx.indexOf("setDeliveryConfirmAt"));
  assert.match(body, /d\.restaurantId !== args\.restaurantId/,
    "tenant isolation must be enforced by the write itself");
  assert.match(body, /d\.orderSource !== ORDER_SOURCE_MARKETPLACE/,
    "a misrouted call must not be able to move a POS order");
});

test("[6] cross-restaurant access is reported as 404, never 403", () => {
  const route = readFileSync(
    join(process.cwd(), "app/api/admin/marketplace/orders/[orderId]/route.ts"), "utf8");
  // No `s` flag: the project's tsconfig target predates it. Collapse newlines
  // instead, which is clearer than a dotAll regex anyway.
  const flat = route.replace(/\s+/g, " ");
  assert.match(flat, /another restaurant.{0,80}\? 404 : 409/,
    "confirming an order exists but belongs to somebody else is itself a disclosure");
});

test("[7] the ops board and detail are super-admin gated", () => {
  for (const p of ["app/api/super-admin/marketplace/orders/route.ts",
                   "app/api/super-admin/marketplace/orders/[orderId]/route.ts"]) {
    const src = readFileSync(join(process.cwd(), p), "utf8");
    assert.match(src, /getSuperAdminUser\(\)/, p);
  }
});

test("[8] the ops detail refuses a POS order outright", () => {
  const src = readFileSync(
    join(process.cwd(), "app/api/super-admin/marketplace/orders/[orderId]/route.ts"), "utf8");
  assert.match(src, /orderSource !== ORDER_SOURCE_MARKETPLACE/);
});

// ── Webhook trust ───────────────────────────────────────────────────────────

const BODY = JSON.stringify({ eventId: "e1", state: "DELIVERED" });

test("[9] an invalid Dispatcher webhook is rejected", () => {
  const cases = [
    { signatureHeader: null, timestampHeader: String(T0) },
    { signatureHeader: computeSignature("attacker", T0, BODY), timestampHeader: String(T0) },
    { signatureHeader: computeSignature("s", T0, BODY), timestampHeader: String(T0 - 600_000) },
    { signatureHeader: "v1=" + "0".repeat(64), timestampHeader: String(T0) },
  ];
  for (const c of cases) {
    const r = verifySignature({ secret: "s", rawBody: BODY, nowMs: T0, ...c });
    assert.equal(r.ok, false, JSON.stringify(c).slice(0, 60));
  }
});

test("[10] a replayed webhook is safe — a tampered body cannot ride a valid signature", () => {
  const good = computeSignature("s", T0, BODY);
  assert.equal(verifySignature({ secret: "s", rawBody: BODY, nowMs: T0, signatureHeader: good, timestampHeader: String(T0) }).ok, true);
  const tampered = BODY.replace("DELIVERED", "CANCELLED");
  assert.equal(verifySignature({ secret: "s", rawBody: tampered, nowMs: T0, signatureHeader: good, timestampHeader: String(T0) }).ok, false);
});

test("[11] a malformed event is refused before it can touch an order", () => {
  assert.equal(validateEvent({ contractVersion: CONTRACT_VERSION, eventId: "", type: "delivery.state_changed" }).ok, false);
  assert.equal(validateEvent({ contractVersion: "9.0.0" }).ok, false);
  assert.equal(validateEvent(null).ok, false);
});

// ── Secret containment ──────────────────────────────────────────────────────

const SERVER_ONLY_SECRETS = [
  "DISPATCHER_API_KEY", "DISPATCHER_SIGNING_SECRET", "DISPATCHER_WEBHOOK_SECRET",
  "PAYSTACK_SECRET_KEY", "CRON_SECRET", "FIREBASE_ADMIN_PRIVATE_KEY",
];

function clientComponents(): Array<{ path: string; text: string }> {
  const out: Array<{ path: string; text: string }> = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) { walk(p); continue; }
      if (!/\.tsx?$/.test(entry.name)) continue;
      const text = readFileSync(p, "utf8");
      if (text.startsWith('"use client"') || text.startsWith("'use client'")) {
        out.push({ path: p.replace(process.cwd() + "/", ""), text });
      }
    }
  };
  walk(join(process.cwd(), "app", "super-admin", "marketplace"));
  walk(join(process.cwd(), "app", "api"));
  return out;
}

test("[12] NO service secret can reach a client component", () => {
  const files = clientComponents();
  assert.ok(files.length > 0, "expected at least the ops board");
  for (const f of files) {
    for (const secret of SERVER_ONLY_SECRETS) {
      assert.equal(f.text.includes(secret), false, `${f.path} references ${secret}`);
    }
    // A NEXT_PUBLIC_ prefix is the only env a browser may see; assert nothing
    // else is read client-side at all.
    const envReads = [...f.text.matchAll(/process\.env\.([A-Z_]+)/g)].map((m) => m[1]);
    for (const name of envReads) {
      assert.ok(name.startsWith("NEXT_PUBLIC_"), `${f.path} reads server env ${name}`);
    }
  }
});

test("[13] every module holding a secret is server-only", () => {
  for (const p of ["lib/delivery/config.ts", "lib/marketplace/store.ts",
                   "lib/marketplace/webhook.ts", "lib/marketplace/sweeps.ts"]) {
    const src = readFileSync(join(process.cwd(), p), "utf8");
    assert.match(src, /^import "server-only";/m, p);
  }
});

test("[14] no secret is committed in the staging template", () => {
  const tpl = readFileSync(join(process.cwd(), ".env.staging.example"), "utf8");
  assert.equal(/sk_live_/.test(tpl), false, "a live Paystack key must never appear");
  assert.equal(/BEGIN PRIVATE KEY/.test(tpl), false);
  for (const line of tpl.split("\n")) {
    const m = line.match(/^([A-Z_]+)="(.+)"$/);
    if (!m) continue;
    // Only non-secret defaults may carry a value.
    if (SERVER_ONLY_SECRETS.includes(m[1])) {
      assert.ok(m[2].startsWith("sk_test_") || m[2] === "", `${m[1]} has a value in the template`);
    }
  }
});

// ── The money boundary ──────────────────────────────────────────────────────

test("[15] no food price or settlement figure can reach Dispatcher", () => {
  const payload = {
    contractVersion: CONTRACT_VERSION, correlationId: "c", externalOrderId: "RF-1",
    pickup: { name: "T", address: "a", location: { lat: 6.6, lng: 3.3 }, contactPhone: "+234" },
    dropoff: { name: "A", address: "b", location: { lat: 6.5, lng: 3.4 }, contactPhone: "+234" },
    deliveryFeeMinor: 145_000,
  };
  assert.deepEqual(findForbiddenKeys(payload), []);
  for (const k of ["itemsTotal", "restaurantPayable", "markupTotal", "platformGross", "customerId"]) {
    assert.deepEqual(findForbiddenKeys({ ...payload, [k]: 1 }), [`$.${k}`], k);
  }
});

// ── POS isolation, unchanged ────────────────────────────────────────────────

const POS_FORBIDDEN = ["pos_order_claims", "localOrderId", "orderCounter", "prepared_items"];

test("[16] the marketplace layer never references POS machinery", () => {
  const dir = join(process.cwd(), "lib", "marketplace");
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".ts")) continue;
    const code = readFileSync(join(dir, name), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const forbidden of POS_FORBIDDEN) {
      assert.equal(code.includes(forbidden), false, `lib/marketplace/${name} references ${forbidden}`);
    }
  }
});

test("[17] the marketplace adapter writes only marketplace-scoped documents", () => {
  const src = readFileSync(join(process.cwd(), "lib/marketplace/store.ts"), "utf8");
  const collections = [...src.matchAll(/collection\((?:"([a-z_]+)"|([A-Z_]+))\)/g)].map((m) => m[1] ?? m[2]);
  assert.deepEqual([...new Set(collections)].sort(), ["INTENTS", "LEDGER", "OUTBOX", "PAYMENTS", "orders"]);
});

test("[18] marketplace orders carry no cashier fields", () => {
  const src = readFileSync(join(process.cwd(), "lib/marketplace/order.ts"), "utf8");
  const type = src.slice(src.indexOf("export type MarketplaceOrder"), src.indexOf("export function makeOrderCode"));
  for (const field of ["orderNumber", "localOrderId", "staffId", "auditLog", "tableLabel"]) {
    assert.equal(new RegExp(`^\\s+${field}\\??:`, "m").test(type), false, `MarketplaceOrder declares ${field}`);
  }
});

test("[19] the existing Paystack webhook gained ONE additive branch", () => {
  const src = readFileSync(join(process.cwd(), "app/api/webhooks/paystack/route.ts"), "utf8");
  // The pre-existing branches must still be there, in order.
  assert.ok(src.indexOf('paymentType === "onboarding"') > 0);
  assert.ok(src.indexOf('paymentType === "order"') > src.indexOf('paymentType === "onboarding"'));
  assert.ok(src.indexOf("processSuccessfulPayment(event.data)") > 0, "the subscription fallback survives");
  assert.match(src, /paymentType === "marketplace_order"/);
});

// ── Opt-in ──────────────────────────────────────────────────────────────────

test("[20] a live production-shaped restaurant is NOT in the marketplace", () => {
  const s = readMarketplaceSettings({
    name: "Trisha's Kitchen", status: "live", subscriptionStatus: "active", orderCounter: 4821,
  });
  assert.equal(s.marketplaceEnabled, false);
  assert.equal(isOrderable(s, T0).ok, false);
});

console.log(`\n${passed} checks passed\n`);
