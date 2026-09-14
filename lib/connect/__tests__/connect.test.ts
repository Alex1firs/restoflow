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
import { connectEntries, connectRefundEntries, connectBalance, CONNECT_ACCOUNTS } from "../ledger";
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
  const entries = connectEntries({ deliveryId: "cn_1", restaurantId: "r1", price, payer: "customer", nowMs: 1 });
  assert.equal(connectBalance(entries), 0);
  assert.equal(entries.length, 3);
});

test("[14] the shape is delivery-only — no customer payment is invented", () => {
  // The marketplace ledger starts from money RestoFlow collected. Connect never
  // touches the customer's money, and a `customer` entry here would be a
  // movement that did not happen.
  assert.deepEqual([...CONNECT_ACCOUNTS].sort(), ["connect_revenue", "delivery_payable", "partner_receivable", "payment_received"]);
  const entries = connectEntries({
    deliveryId: "cn_1", restaurantId: "r1", payer: "customer", nowMs: 1,
    price: priceConnectDelivery({ dispatcherCostMinor: 120_000, marginBps: 1000 }),
  });
  const by = Object.fromEntries(entries.map((e) => [e.account, e.amountMinor]));
  assert.equal(by.payment_received, 132_000, "the payer paid the full price");
  assert.equal(by.delivery_payable, -120_000, "we owe Dispatcher its cost");
  assert.equal(by.connect_revenue, -12_000, "we keep the margin");
});

test("[15] the staging 10% margin balances", () => {
  for (const cost of [85_000, 120_000, 333_333]) {
    const entries = connectEntries({
      deliveryId: "cn_x", restaurantId: "r1", payer: "customer", nowMs: 1,
      price: priceConnectDelivery({ dispatcherCostMinor: cost, marginBps: 1000 }),
    });
    assert.equal(connectBalance(entries), 0, `cost ${cost}`);
  }
});

test("[16] ledger ids are deterministic, so a replay cannot double the books", () => {
  const price = priceConnectDelivery({ dispatcherCostMinor: 120_000, marginBps: 1000 });
  const a = connectEntries({ deliveryId: "cn_1", restaurantId: "r1", price, payer: "customer", nowMs: 1 });
  const b = connectEntries({ deliveryId: "cn_1", restaurantId: "r1", price, payer: "customer", nowMs: 99 });
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
  assert.match(src, /deliveryFeeMinor: d\.payment\.dispatcherCostMinor/,
    "Dispatcher must be paid its cost — RestoFlow's margin is not its business");
  assert.ok(!/partnerPriceMinor|amountMinor/.test(src.slice(src.indexOf("const req: CreateDeliveryRequest"), src.indexOf("const res = await c.createDelivery"))),
    "what the payer paid must never cross into the Dispatcher request");
  assert.match(src, /paymentCollection: "NONE"/);
  assert.match(src, /externalOrderId: d\.id/, "the Connect id is the idempotency anchor");
});

test("[19] a Connect delivery creates no marketplace order", () => {
  const src = read("lib/connect/service.ts") + read("lib/connect/store.ts");
  for (const forbidden of ['collection("orders")', "marketplaceState", "orderSource"]) {
    assert.ok(!src.includes(forbidden), `Connect must not touch ${forbidden}`);
  }
});

// ── Quote expiry ────────────────────────────────────────────────────────────

test("[20] a dead quote cannot become a payment at the old price", () => {
  // Under the payment model the answer to a stale quote is to re-quote and show
  // the new number, not to refuse the partner outright — but it must never be
  // possible to open a checkout against a price Dispatcher no longer honours.
  const src = read("lib/connect/service.ts");
  const prep = src.slice(src.indexOf("export async function preparePayment"), src.indexOf("export async function onConnectPaymentConfirmed"));
  assert.match(prep, /quote\.expiresAtMs - nowMs < QUOTE_MIN_REMAINING_MS/);
  assert.match(prep, /quoteConnectDelivery\(/, "a stale quote must be replaced before checkout");
  assert.ok(prep.indexOf("quote = fresh.quote") < prep.indexOf("initializeConnectPayment"),
    "the refreshed price must be the one paid");
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
    + read("app/api/admin/connect/deliveries/[id]/pay/route.ts");
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
    + read("app/api/admin/connect/deliveries/[id]/pay/route.ts");
  assert.ok(!src.includes("receivingCode"), "the customer's proof is not the partner's to hold");
});

// ── Activation ──────────────────────────────────────────────────────────────

test("[28] activation is a super-admin act and demands a margin", () => {
  const src = read("app/api/super-admin/connect/[slug]/route.ts");
  assert.match(src, /getSuperAdminUser/);
  assert.match(src, /marginBps is required/);
  assert.ok(!/marginBps\s*\?\?\s*\d/.test(src), "there must be no default margin to fall back on");
});

// ── Payment gate ────────────────────────────────────────────────────────────

test("[29] dispatch is not something an HTTP caller can do", () => {
  // The courier is commissioned behind the Paystack webhook. If a route could
  // dispatch, a delivery could exist without money having landed.
  const src = read("app/api/admin/connect/deliveries/[id]/pay/route.ts");
  assert.match(src, /preparePayment/);
  assert.ok(!/dispatchPaidDelivery|createDelivery/.test(src), "no route may dispatch directly");
});

test("[30] the amount is server-computed and never read from the client", () => {
  const svc = read("lib/connect/service.ts");
  assert.match(svc, /amountMinor: quote\.partnerPriceMinor/);
  const route = read("app/api/admin/connect/deliveries/[id]/pay/route.ts");
  assert.ok(!/body\.amount|body\.price/.test(route), "a client-supplied amount must be impossible");
});

test("[31] a near-expiry quote is refreshed before payment, not after", () => {
  const svc = read("lib/connect/service.ts");
  assert.match(svc, /QUOTE_MIN_REMAINING_MS/);
  const prep = svc.slice(svc.indexOf("export async function preparePayment"), svc.indexOf("export async function onConnectPaymentConfirmed"));
  assert.ok(prep.indexOf("QUOTE_MIN_REMAINING_MS") < prep.indexOf("initializeConnectPayment"),
    "the freshness check must run BEFORE Paystack is called");
  assert.match(prep, /priceChanged/, "a changed price must be reported to the caller");
});

test("[32] the webhook checks the paid amount against the frozen snapshot", () => {
  const svc = read("lib/connect/service.ts");
  const fn = svc.slice(svc.indexOf("export async function onConnectPaymentConfirmed"));
  assert.match(fn, /args\.amountMinor !== d\.payment\.amountMinor/);
  assert.match(fn, /amount_mismatch/);
});

test("[33] a replayed webhook pays, dispatches and books nothing twice", () => {
  const store = read("lib/connect/store.ts");
  const fn = store.slice(store.indexOf("async markPaid("));
  assert.match(fn, /runTransaction/);
  assert.match(fn, /if \(!d\.payment \|\| d\.payment\.paidAtMs\) return false;/);
  const svc = read("lib/connect/service.ts");
  assert.match(svc, /if \(d\.payment\.paidAtMs\) return \{ outcome: "replayed"/);
});

test("[34] Connect reuses the existing webhook rather than adding a second", () => {
  const hook = read("app/api/webhooks/paystack/route.ts");
  assert.match(hook, /paymentType === "connect_delivery"/);
  assert.match(hook, /paymentType === "marketplace_order"/, "the marketplace branch must remain");
});

test("[35] Connect money is collected by the platform, never split to a subaccount", () => {
  // The restaurant is owed none of a delivery fee — it is Dispatcher's cost
  // plus RestoFlow's margin.
  // Code, not the comment that explains why the storefront does it differently.
  const pay = read("lib/connect/payments.ts");
  const body = pay.slice(pay.indexOf("export async function initializeConnectPayment"));
  assert.ok(!/subaccount/.test(body), "a subaccount split would pay the restaurant its own delivery fee");
  assert.ok(!/bearer/.test(body));
});

// ── Reconcile before retry ──────────────────────────────────────────────────

test("[36] an ambiguous create is reconciled before anything is retried or refunded", () => {
  const svc = read("lib/connect/service.ts");
  const fn = svc.slice(svc.indexOf("export async function dispatchPaidDelivery"));
  const fail = fn.slice(fn.indexOf("if (!res.ok)"));
  assert.ok(fail.indexOf("getDelivery") < fail.indexOf("payment_held_unfulfilled"),
    "must ask Dispatcher what it holds before declaring failure");
  assert.match(fail, /externalOrderId: d\.id/, "reconciliation is keyed on the idempotency anchor");
});

// ── Refunds ─────────────────────────────────────────────────────────────────

test("[37] exactly one refund obligation can ever exist", () => {
  const store = read("lib/connect/store.ts");
  const fn = store.slice(store.indexOf("async claimRefund("));
  assert.match(fn, /runTransaction/);
  assert.match(fn, /if \(d\.refund\) return false;/, "a second claim must be refused");
});

test("[38] a provider 'already refunded' is success, not an error to retry forever", () => {
  const pay = read("lib/connect/payments.ts");
  assert.match(pay, /already\.\*refund\|has been refunded\|duplicate/);
  const fn = pay.slice(pay.indexOf("export async function refundConnectPayment"));
  const dup = fn.slice(fn.indexOf("const message"));
  assert.match(dup, /alreadyRefunded: true/);
});

test("[38b] a refund must PROVE no job exists, not assume it", () => {
  // Our record saying there is no job is not evidence — the create may have
  // succeeded with the response lost. Refunding on that assumption pays a
  // customer back for a courier already on the way.
  const svc = read("lib/connect/service.ts");
  const fn = svc.slice(svc.indexOf("export async function refundConnectDelivery"));
  const head = fn.slice(0, fn.indexOf("claimRefund"));
  assert.match(head, /getDelivery\(\{ externalOrderId: d\.id/, "must ask Dispatcher before refunding");
  assert.match(head, /job_exists_after_all/, "a job found must cancel the refund");
  assert.match(head, /reconciliation_unavailable/, "being unable to ask must not become a refund");
});

test("[39] a dispatched delivery can never be refunded by this path", () => {
  const svc = read("lib/connect/service.ts");
  const fn = svc.slice(svc.indexOf("export async function refundConnectDelivery"));
  assert.match(fn, /if \(d\.delivery\?\.deliveryJobId\) return \{ ok: false, reason: "already_dispatched" \}/);
});

test("[40] a refund reverses the books without erasing the payment", () => {
  const price = priceConnectDelivery({ dispatcherCostMinor: 85_000, marginBps: 1000 });
  const paid = connectEntries({ deliveryId: "cn_1", restaurantId: "r1", price, payer: "customer", nowMs: 1 });
  const back = connectRefundEntries({ deliveryId: "cn_1", restaurantId: "r1", price, payer: "customer", nowMs: 2 });
  assert.equal(connectBalance(back), 0);
  assert.equal(connectBalance([...paid, ...back]), 0, "paid then refunded nets to zero");
  // Distinct ids, so the history keeps both events rather than overwriting one.
  assert.equal(new Set([...paid, ...back].map((e) => e.id)).size, 6);
});

// ── Payer as a dimension ────────────────────────────────────────────────────

test("[41] both payers produce the same shape, distinguished by a field", () => {
  const price = priceConnectDelivery({ dispatcherCostMinor: 85_000, marginBps: 1000 });
  const c = connectEntries({ deliveryId: "a", restaurantId: "r1", price, payer: "customer", nowMs: 1 });
  const r = connectEntries({ deliveryId: "b", restaurantId: "r1", price, payer: "restaurant", nowMs: 1 });
  assert.deepEqual(c.map((e) => e.account), r.map((e) => e.account), "one ledger architecture, not two");
  assert.deepEqual(c.map((e) => e.amountMinor), r.map((e) => e.amountMinor));
  assert.equal(c[0].payer, "customer");
  assert.equal(r[0].payer, "restaurant");
});

test("[42] the worked example balances", () => {
  // ₦850 cost + ₦85 margin = ₦935 paid.
  const price = priceConnectDelivery({ dispatcherCostMinor: 85_000, marginBps: 1000 });
  assert.equal(price.partnerPriceMinor, 93_500);
  const entries = connectEntries({ deliveryId: "cn_1", restaurantId: "r1", price, payer: "customer", nowMs: 1 });
  const by = Object.fromEntries(entries.map((e) => [e.account, e.amountMinor]));
  assert.equal(by.payment_received, 93_500);
  assert.equal(by.delivery_payable, -85_000);
  assert.equal(by.connect_revenue, -8_500);
  assert.equal(connectBalance(entries), 0);
});

// ── The guest token ─────────────────────────────────────────────────────────

test("[43] the token is minted at quote, so the pay link exists before the courier", () => {
  const svc = read("lib/connect/service.ts");
  assert.match(svc, /trackingToken: randomBytes\(16\)\.toString\("hex"\)/);
});

test("[44] a wrong or missing token is indistinguishable from no delivery", () => {
  const g = read("lib/connect/guest.ts");
  assert.match(g, /if \(!token\) return null;/);
  assert.match(g, /d\.trackingToken !== token\) return null;/);
});

test("[45] the guest page never exposes cost, margin, pickup code or Dispatcher", () => {
  const g = read("lib/connect/guest.ts");
  const page = read("app/d/[id]/page.tsx");
  for (const leak of ["dispatcherCostMinor", "marginMinor", "pickupCode"]) {
    assert.ok(!g.includes(`${leak},`) && !page.includes(leak), `guest surface leaks ${leak}`);
  }
  // "Dispatcher" may appear in the reasoning, never in what renders.
  const body = page.slice(page.indexOf("export default"));
  assert.ok(!/Dispatcher/.test(body), "Dispatcher must stay invisible to the customer");
});

test("[46] the receiving code is withheld until the food is actually coming", () => {
  const g = read("lib/connect/guest.ts");
  assert.match(g, /CODE_VISIBLE_FROM = \["PICKED_UP", "EN_ROUTE_TO_CUSTOMER", "ARRIVING"\]/);
});

test("[47] the page names the restaurant first and RestoFlow plainly", () => {
  const page = read("app/d/[id]/page.tsx");
  assert.match(page, /Pay delivery for/);
  assert.match(page, /view\.restaurant\.name/);
  assert.match(page, /Delivery powered by RestoFlow/);
});

test("[48] the same link becomes tracking once paid", () => {
  const g = read("lib/connect/guest.ts");
  assert.match(g, /tracking: GuestView\["tracking"\]/);
  const page = read("app/d/[id]/page.tsx");
  assert.match(page, /view\.paid && !view\.tracking/);
  assert.match(page, /view\.tracking &&/);
});

test("[50] a held or refunded delivery never says 'finding you a courier'", () => {
  // The single worst thing to show somebody whose money we are holding: both
  // untrue and reassuring.
  const g = read("lib/connect/guest.ts");
  for (const st of ["payment_held_unfulfilled", "refund_pending", "refunded", "refund_failed"]) {
    assert.ok(g.includes(st), `guest view must speak to ${st}`);
  }
  const page = read("app/d/[id]/page.tsx");
  assert.match(page, /view\.paid && !view\.tracking && !view\.problem/,
    "the 'finding a courier' message must be suppressed when there is a problem");
});

test("[51] refunds are a super-admin act, not a partner or customer one", () => {
  const route = read("app/api/super-admin/connect/deliveries/[id]/refund/route.ts");
  assert.match(route, /getSuperAdminUser/);
  assert.ok(!/authoriseConnect|trackingToken/.test(route),
    "neither the partner nor a link-holder may move money");
});

test("[52] accepted is not settled", () => {
  // Paystack accepts a refund immediately and settles it later — the refund
  // reads `pending` and the transaction `reversal-pending`. Recording our own
  // "succeeded" on the 200 would have our books claim the money is back with
  // the customer while the provider still holds it.
  const svc = read("lib/connect/service.ts");
  assert.match(svc, /const settled = res\.providerStatus === "processed"/);
  assert.match(svc, /state: settled \? "refunded" : "refund_pending"/);
  assert.match(svc, /status: settled \? "succeeded" : "pending"/);
  assert.match(svc, /settledAtMs: settled \? nowMs : null/);
  const types = read("lib/connect/types.ts");
  assert.match(types, /providerStatus: string \| null/, "the provider's own word must be kept");
});

console.log(`\n${passed} checks passed\n`);
