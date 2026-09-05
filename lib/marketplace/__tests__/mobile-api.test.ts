/**
 * The customer-facing API surface: `/api/mobile/v1`.
 *
 * Two kinds of assertion, deliberately.
 *
 * Behavioural — the pure functions the routes depend on (stage collapsing,
 * customer-facing DTOs, coordinate validation, distance) are exercised
 * directly.
 *
 * Structural — the routes themselves need Firestore and a verified Firebase
 * token, so a unit test cannot call them. What a unit test CAN do is read
 * their source and prove the properties that make a per-request test
 * unnecessary: that no route accepts a customer id as input, that every
 * authenticated route goes through the one wrapper, and that no route hands a
 * customer a field from the settlement side of the price snapshot. Those are
 * whole-surface claims; a request-level test would only ever cover the routes
 * somebody remembered to write a test for.
 *
 * Run: npx tsx lib/marketplace/__tests__/mobile-api.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { restaurantFacing, toCustomerStage, toCustomerOrderSummary, toCustomerOrderDetail } from "../customer-view";
import { isValidLatLng, haversineKm, roadDistanceKm, DEFAULT_ROAD_FACTOR } from "../geo";
import { customerDeliveryFee } from "../pricing";

let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`  ✓ ${name}`); };
console.log("marketplace/mobile-api");

const ROOT = join(__dirname, "..", "..", "..");
const API = join(ROOT, "app", "api", "mobile", "v1");

/** Every route.ts under /api/mobile/v1, with its path relative to that root. */
function routeFiles(dir = API, prefix = ""): Array<{ rel: string; src: string }> {
  const out: Array<{ rel: string; src: string }> = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...routeFiles(full, `${prefix}/${entry}`));
    else if (entry === "route.ts") out.push({ rel: `${prefix}/route.ts`, src: readFileSync(full, "utf8") });
  }
  return out;
}
const ROUTES = routeFiles();

/**
 * Source with comments removed.
 *
 * A field name is allowed to appear in prose explaining why it must never be
 * sent; scanning the raw text would make the explanation itself a failure.
 */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

// ── The surface exists and is complete ───────────────────────────────────────

test("[1] the mobile API covers the whole customer journey", () => {
  const rels = ROUTES.map((r) => r.rel).sort();
  for (const required of [
    "/feed/route.ts",                       // browse
    "/search/route.ts",                     // find
    "/restaurants/[slug]/route.ts",         // menu
    "/cart/quote/route.ts",                 // price
    "/orders/route.ts",                     // place + history
    "/orders/[orderId]/route.ts",           // detail
    "/orders/[orderId]/tracking/route.ts",  // track
    "/me/route.ts",                         // profile
    "/me/addresses/route.ts",               // where to deliver
    "/me/addresses/[addressId]/route.ts",
  ]) assert.ok(rels.includes(required), `missing route ${required}`);
});

// ── Identity comes from the token, and only from the token ───────────────────

test("[2] NO route reads a customer id from the request", () => {
  // The class of "customer A fetches customer B" is removed by there being no
  // input that could express it. This is the assertion that keeps it removed.
  for (const { rel, src } of ROUTES) {
    for (const forbidden of [
      /searchParams\.get\(\s*["']customerId["']/,
      /searchParams\.get\(\s*["']userId["']/,
      /searchParams\.get\(\s*["']uid["']/,
      /body\.customerId/,
      /body\.userId/,
      /\bcustomerId\s*[:=]\s*(?!customer\.id)(?!\{)[a-zA-Z_]/,
    ]) assert.ok(!forbidden.test(src), `${rel} appears to accept a caller-supplied identity: ${forbidden}`);
  }
});

test("[3] every authenticated route goes through withCustomer", () => {
  for (const { rel, src } of ROUTES) {
    const authed = /withCustomer/.test(src);
    const publik = /withPublic/.test(src);
    assert.ok(authed || publik, `${rel} uses neither wrapper — it would have no flag check, no auth and no rate limit`);
    // A route may not hand-roll auth alongside the wrapper.
    assert.ok(!/verifyIdToken/.test(src), `${rel} verifies a token itself instead of using the wrapper`);
    assert.ok(!/getAuthenticatedUser/.test(src), `${rel} reaches into the RESTAURANT session helper`);
    assert.ok(!/__session/.test(src), `${rel} touches the restaurant session cookie`);
  }
});

test("[4] the public routes are exactly the discovery ones", () => {
  const publicRoutes = ROUTES.filter((r) => /withPublic/.test(r.src)).map((r) => r.rel).sort();
  assert.deepEqual(publicRoutes, ["/feed/route.ts", "/restaurants/[slug]/route.ts", "/search/route.ts"]);
  // Anything touching an order, a profile or an address must be authenticated.
  for (const { rel, src } of ROUTES) {
    if (/^\/(orders|me|cart)/.test(rel)) {
      assert.ok(/withCustomer/.test(src), `${rel} must be authenticated`);
      assert.ok(!/withPublic/.test(src), `${rel} must not be public`);
    }
  }
});

test("[5] ownership is always compared against the verified uid", () => {
  // Wherever a route compares a stored customerId, the right-hand side must be
  // `customer.id` — the value that came out of the token.
  for (const { rel, src } of ROUTES) {
    for (const m of src.matchAll(/customerId\s*!==\s*([A-Za-z_.]+)/g)) {
      assert.equal(m[1], "customer.id", `${rel} compares ownership against ${m[1]}`);
    }
  }
});

test("[6] a denial is a 404, so ids cannot be probed", () => {
  const detail = ROUTES.find((r) => r.rel === "/orders/[orderId]/route.ts")!.src;
  // Three reasons to refuse, one answer.
  assert.equal((detail.match(/return notFound\(\)/g) ?? []).length, 3);
  assert.ok(!/status:\s*403/.test(detail), "a 403 would confirm the order exists");

  const tracking = ROUTES.find((r) => r.rel === "/orders/[orderId]/tracking/route.ts")!.src;
  assert.match(tracking, /reason === "not_found"/);
  assert.match(tracking, /return notFound\(\)/);
});

// ── Money the customer may see ───────────────────────────────────────────────

test("[7] no route exposes the settlement side of the price snapshot", () => {
  // What a restaurant is paid, what the platform keeps and what the processor
  // takes are all on the snapshot the order document holds. A DTO built by
  // spreading that document would ship every one of them to a phone.
  for (const { rel, src: raw } of ROUTES) {
    const src = code(raw);
    for (const field of [
      "restaurantPayableMinor", "platformGrossMinor", "platformNetMinor",
      "processorFeeMinor", "deliveryPayableMinor", "commissionBps", "markupBps",
      "restaurantSubtotalMinor",
    ]) assert.ok(!src.includes(field), `${rel} exposes ${field}`);
    assert.ok(!/\.\.\.\s*(snapshot|pricing|d\b|data\(\))/.test(src), `${rel} spreads a stored document into a response`);
  }
});

test("[8] the customer DTO is an allowlist, field by field", () => {
  const src = code(readFileSync(join(ROOT, "lib", "marketplace", "customer-view.ts"), "utf8"));
  for (const field of ["restaurantPayableMinor", "platformGrossMinor", "processorFeeMinor", "commissionBps"]) {
    assert.ok(!src.includes(field), `customer-view exposes ${field}`);
  }
  // Only the four figures that make up what they are charged.
  for (const field of ["customerSubtotalMinor", "deliveryFeeMinor", "discountTotalMinor", "taxMinor", "totalChargedMinor"]) {
    assert.ok(src.includes(field), `customer-view should surface ${field}`);
  }
});

// ── Stage collapsing: two state machines, one thing the customer reads ───────

const stage = (r: Parameters<typeof toCustomerStage>[0], d: Parameters<typeof toCustomerStage>[1]) =>
  toCustomerStage(r, d);

test("[9] before a rider exists, the kitchen is the whole story", () => {
  assert.equal(stage("placed", null).stage, "confirmed");
  assert.equal(stage("accepted", null).stage, "restaurant_accepted");
  assert.equal(stage("preparing", null).stage, "preparing");
  assert.equal(stage("ready", null).stage, "preparing");   // the pass is invisible to a customer
  // A reserved job that riders cannot see yet is still the kitchen's story.
  assert.equal(stage("preparing", "REQUESTED").stage, "preparing");
});

test("[9a] once the job is out to riders, waiting for one IS the story", () => {
  // The job only exists after acceptance now, so SEARCHING no longer overlaps
  // with "the kitchen hasn't started". Reporting "preparing" while the food is
  // ready and nobody has claimed the job hides the thing that is actually
  // holding the order up.
  assert.equal(stage("preparing", "SEARCHING_FOR_DRIVER").stage, "finding_rider");
  assert.equal(stage("ready", "SEARCHING_FOR_DRIVER").stage, "finding_rider");
  // Losing a rider and looking for the first one are the same wait to a customer.
  assert.equal(stage("ready", "REASSIGNING").stage, "finding_rider");
  assert.equal(stage("ready", "DRIVER_CANCELLED").stage, "finding_rider");
});

test("[9b] a paid order the kitchen has not seen never claims to be cooking", () => {
  // The regression this guards: the tracking route used to default a missing
  // delivery job to "REQUESTED" and print "Preparing your food" for an order
  // no restaurant had accepted.
  assert.match(restaurantFacing("placed").headline, /waiting for restaurant/i);
  assert.ok(!/preparing/i.test(restaurantFacing("placed").headline));
  assert.match(restaurantFacing("accepted").headline, /accepted/i);
  assert.match(restaurantFacing("preparing").headline, /preparing/i);
});

test("[9c] a refused order says so plainly and promises the money back", () => {
  for (const s of ["rejected", "cancelled"] as const) {
    const copy = restaurantFacing(s);
    assert.match(`${copy.headline} ${copy.detail ?? ""}`, /refund/i);
  }
});

test("[10] once a rider is assigned, delivery leads", () => {
  // The kitchen may still be cooking; what the customer wants to know is where
  // their courier is.
  assert.equal(stage("preparing", "DRIVER_ASSIGNED").stage, "courier_assigned");
  assert.equal(stage("preparing", "DRIVER_TO_PICKUP").stage, "courier_to_restaurant");
  assert.equal(stage("ready", "ARRIVED_AT_PICKUP").stage, "courier_at_restaurant");
  assert.equal(stage("ready", "WAITING_FOR_ORDER").stage, "courier_at_restaurant");
  assert.equal(stage("ready", "PICKED_UP").stage, "picked_up");
  assert.equal(stage("ready", "EN_ROUTE_TO_CUSTOMER").stage, "on_the_way");
  assert.equal(stage("ready", "ARRIVING").stage, "arriving");
  assert.equal(stage("ready", "DELIVERED").stage, "delivered");
});

test("[11] problems are a separate axis from progress", () => {
  // A cancelled order is not a stage — it is a stage plus a problem, so the app
  // can show how far it got AND what went wrong.
  assert.deepEqual(stage("rejected", null), { stage: "confirmed", problem: "rejected" });
  assert.deepEqual(stage("cancelled", null), { stage: "confirmed", problem: "cancelled" });
  assert.deepEqual(stage("preparing", "CANCELLED"), { stage: "confirmed", problem: "cancelled" });
  assert.deepEqual(stage("ready", "DELIVERY_FAILED"), { stage: "on_the_way", problem: "delivery_failed" });
  // A restaurant rejection outranks whatever delivery thinks.
  assert.equal(stage("rejected", "DRIVER_ASSIGNED").problem, "rejected");
});

test("[12] the stage function is total — every restaurant state maps", () => {
  for (const r of ["placed", "accepted", "preparing", "ready", "rejected", "cancelled"] as const) {
    const s = stage(r, null);
    assert.ok(typeof s.stage === "string" && s.stage.length > 0, `${r} produced no stage`);
  }
});

// ── The order DTO ────────────────────────────────────────────────────────────

const ORDER_DOC = {
  marketplaceOrderCode: "MP-7Q2K",
  restaurantName: "Trisha's Kitchen",
  createdAtMs: 1_756_000_000_000,
  address: "12 Admiralty Way, Lekki",
  deliveryInstructions: "Blue gate",
  items: [
    { dishId: "jollof", name: "Jollof Rice", quantity: 2, options: [] },
    { dishId: "moi", name: "Moi Moi", quantity: 1, options: [] },
  ],
  fulfillment: { restaurantState: "preparing", history: [{ state: "accepted", at: 1_756_000_060_000 }] },
  delivery: { state: "PICKED_UP", pickedUpAt: 1_756_000_600_000, driver: { firstName: "Ade" } },
  payment: { state: "captured", verifiedAt: 1_756_000_010_000 },
  pricing: {
    customerSubtotalMinor: 720_000, deliveryFeeMinor: 120_000, discountTotalMinor: 0,
    taxMinor: 0, totalChargedMinor: 840_000,
    // Present on the stored document, and must NOT come out the other side.
    restaurantPayableMinor: 600_000, platformGrossMinor: 120_000, processorFeeMinor: 12_600,
    lines: [{ dishId: "jollof", customerPriceMinor: 300_000 }, { dishId: "moi", customerPriceMinor: 120_000 }],
  },
};

test("[13] a summary carries only what a list row needs", () => {
  const s = toCustomerOrderSummary("RF-1", ORDER_DOC);
  assert.equal(s.id, "RF-1");
  assert.equal(s.code, "MP-7Q2K");
  assert.equal(s.totalMinor, 840_000);
  assert.equal(s.itemCount, 3);              // quantities, not lines
  assert.equal(s.stage, "picked_up");
  assert.equal(s.problem, null);
  assert.equal(s.isActive, true);
  const keys = Object.keys(s);
  for (const leaked of ["restaurantPayableMinor", "platformGrossMinor", "processorFeeMinor", "pricing", "payment"]) {
    assert.ok(!keys.includes(leaked), `summary leaked ${leaked}`);
  }
});

test("[14] a delivered order is no longer active", () => {
  const done = toCustomerOrderSummary("RF-1", { ...ORDER_DOC, delivery: { state: "DELIVERED" } });
  assert.equal(done.stage, "delivered");
  assert.equal(done.isActive, false);
  const cancelled = toCustomerOrderSummary("RF-1", { ...ORDER_DOC, fulfillment: { restaurantState: "cancelled" } });
  assert.equal(cancelled.problem, "cancelled");
  assert.equal(cancelled.isActive, false);
});

test("[15] the detail DTO prices lines from the frozen snapshot", () => {
  const d = toCustomerOrderDetail("RF-1", ORDER_DOC);
  const jollof = d.lines.find((l) => l.itemId === "jollof")!;
  // Read from the snapshot, never recomputed from the live menu — the price
  // the customer agreed to is the price they see forever.
  assert.equal(jollof.unitPriceMinor, 300_000);
  assert.equal(jollof.quantity, 2);
  assert.equal(d.quote.totalMinor, 840_000);
  assert.equal(d.quote.subtotalMinor, 720_000);
  assert.equal(d.deliveryAddress, "12 Admiralty Way, Lekki");
  assert.ok(!JSON.stringify(d).includes("600000"), "the restaurant's payable reached the customer");
  assert.ok(!JSON.stringify(d).includes("12600"), "the processor fee reached the customer");
});

test("[16] the timeline is chronological and in the customer's words", () => {
  const d = toCustomerOrderDetail("RF-1", ORDER_DOC);
  const times = d.timeline.map((t) => Date.parse(t.at));
  assert.deepEqual(times, [...times].sort((a, b) => a - b), "timeline is out of order");
  const labels = d.timeline.map((t) => t.label);
  assert.ok(labels.includes("Order confirmed"));
  assert.ok(labels.includes("Restaurant accepted your order"));
  // No internal state names, no operational reasons.
  for (const l of labels) {
    assert.ok(!/PICKED_UP|EN_ROUTE|DRIVER_|_[A-Z]/.test(l), `internal state leaked into the timeline: ${l}`);
  }
});

test("[17] a half-empty order document does not throw", () => {
  // Orders written before a field existed, or mid-write, must still render.
  const bare = toCustomerOrderDetail("RF-2", {});
  assert.equal(bare.stage, "confirmed");
  assert.equal(bare.totalMinor, 0);
  assert.deepEqual(bare.lines, []);
  assert.deepEqual(bare.timeline, []);
});

// ── Inputs ───────────────────────────────────────────────────────────────────

test("[18] coordinates are validated, and null-island is rejected", () => {
  assert.equal(isValidLatLng({ lat: 6.43, lng: 3.42 }), true);
  assert.equal(isValidLatLng({ lat: 0, lng: 0 }), false);      // an unset default far more often than a place
  assert.equal(isValidLatLng({ lat: 91, lng: 3 }), false);
  assert.equal(isValidLatLng({ lat: 6, lng: 181 }), false);
  assert.equal(isValidLatLng({ lat: NaN, lng: 3 }), false);
  assert.equal(isValidLatLng({ lat: "6.43", lng: "3.42" }), false);
  assert.equal(isValidLatLng(null), false);
  assert.equal(isValidLatLng("6.43,3.42"), false);
});

test("[19] the quote never accepts a client-supplied price", () => {
  const src = readFileSync(join(ROOT, "lib", "marketplace", "quote.ts"), "utf8");
  // QuoteLineRequest is the entire shape a client may send.
  const shape = src.slice(src.indexOf("export type QuoteLineRequest"), src.indexOf("export type QuoteResult"));
  for (const field of ["price", "Minor", "total", "amount"]) {
    assert.ok(!new RegExp(`\\b\\w*${field}\\w*\\s*[?]?:`, "i").test(shape),
      `QuoteLineRequest accepts a ${field} field — a client could name its own price`);
  }
  const route = ROUTES.find((r) => r.rel === "/cart/quote/route.ts")!.src;
  // The quote route takes an address ID, never coordinates. Quoting to
  // arbitrary coordinates would turn the endpoint into a serviceability
  // oracle; taking an id means the only places a caller can quote to are
  // places they already saved.
  const destructured = route.match(/const \{([^}]*)\} = body/)![1];
  for (const field of ["lat", "lng", "location", "coords"]) {
    assert.ok(!destructured.includes(field), `the quote route destructures ${field} from the request body`);
  }
  assert.ok(!/searchParams\.get\(\s*["\']l(at|ng)["\']\)/.test(route), "the quote route reads coordinates from the query");
  // The dropoff comes from the caller's OWN address subcollection.
  assert.match(route, /addressesRef\(db, customer\.id\)/);
  assert.match(route, /dropoff: address\.location/);
});

test("[20] delivery fee is pass-through, and the seam for changing that exists", () => {
  assert.equal(customerDeliveryFee(120_000), 120_000);
  assert.equal(customerDeliveryFee(0), 0);
});

// ── Distance ─────────────────────────────────────────────────────────────────

test("[21] haversine is symmetric, zero on itself, and right for a known pair", () => {
  const lekki = { lat: 6.4474, lng: 3.4736 };
  const ikeja = { lat: 6.6018, lng: 3.3515 };
  assert.equal(haversineKm(lekki, lekki), 0);
  assert.ok(Math.abs(haversineKm(lekki, ikeja) - haversineKm(ikeja, lekki)) < 1e-9);
  const km = haversineKm(lekki, ikeja);
  assert.ok(km > 20 && km < 24, `Lekki→Ikeja came out at ${km}km`);
});

test("[22] road distance is straight-line inflated by a stated factor", () => {
  const a = { lat: 6.44, lng: 3.47 }, b = { lat: 6.60, lng: 3.35 };
  assert.equal(DEFAULT_ROAD_FACTOR, 1.3);
  assert.ok(Math.abs(roadDistanceKm(a, b) - haversineKm(a, b) * 1.3) < 1e-9);
  // An estimate, not a routed distance — no paid map API is called to produce it.
  const geo = code(readFileSync(join(ROOT, "lib", "marketplace", "geo.ts"), "utf8"));
  assert.ok(!/fetch\(|googleapis|mapbox|API_KEY/i.test(geo), "geo.ts reaches an external map provider");
});

// ── The mobile API cannot touch the POS ──────────────────────────────────────

test("[23] no mobile route reads prepared_items or writes an existing order path", () => {
  for (const { rel, src: raw } of ROUTES) {
    const src = code(raw);
    assert.ok(!src.includes("prepared_items"), `${rel} reads the POS catalogue`);
    assert.ok(!/collection\("pos_order_claims"\)/.test(src), `${rel} touches POS idempotency claims`);
  }
  // Discovery reads the customer catalogue and only that one.
  const disc = code(readFileSync(join(ROOT, "lib", "marketplace", "discovery.ts"), "utf8"));
  assert.ok(disc.includes("menu_items"));
  assert.ok(!disc.includes("prepared_items"));
});

test("[24] every marketplace query starts from the opt-in flag", () => {
  const disc = code(readFileSync(join(ROOT, "lib", "marketplace", "discovery.ts"), "utf8"));
  const queries = (disc.match(/collection\("restaurants"\)[\s\S]{0,400}?\.get\(\)/g) ?? []);
  assert.ok(queries.length > 0, "no restaurant query found to check");
  for (const q of queries) {
    if (!q.includes(".doc(")) {
      assert.ok(q.includes("marketplace.marketplaceEnabled"),
        "a restaurant listing query does not filter on marketplaceEnabled — a restaurant that never opted in could appear in the app");
    }
  }
});

test("[9d] BOTH tracking branches name the restaurant", () => {
  // A delivered order takes the "nothing left to track" branch, which is
  // exactly the moment the customer reads "enjoy your food from …". Patching
  // only the live-tracking branch left the finished order generic.
  const src = readFileSync(join(ROOT, "app/api/mobile/v1/orders/[orderId]/tracking/route.ts"), "utf8");
  const hits = src.match(/restaurantName: order[!?]?\.restaurantName/g) ?? [];
  assert.ok(hits.length >= 2, `both branches must pass the name, found ${hits.length}`);
});

test("[9e] a customer NEVER sees an internal restaurant slug", () => {
  // The fallback chain used to end at restaurantId, so every order written
  // before the name was stored showed "stg-trishas-kitchen" in the app.
  const withName = toCustomerOrderSummary("o1", { restaurantName: "Trisha's Kitchen", restaurantId: "stg-trishas-kitchen" });
  assert.equal(withName.restaurantName, "Trisha's Kitchen");

  const hydrated = toCustomerOrderSummary("o2", { restaurantId: "stg-trishas-kitchen" }, "Trisha's Kitchen");
  assert.equal(hydrated.restaurantName, "Trisha's Kitchen",
    "a historic order must take the hydrated name over its slug");

  // Last resort only when the restaurant itself is gone.
  const orphan = toCustomerOrderSummary("o3", { restaurantId: "stg-gone" }, null);
  assert.equal(orphan.restaurantName, "stg-gone");
});

test("[9f] tracking answers in the CUSTOMER's vocabulary, not the subsystem's", () => {
  // buildTrackingPayload speaks driver / location / etaToDropoffMins; the app
  // reads courier / courierLocation / etaMins. The live-tracking branch used to
  // spread the payload, so while a rider was actually moving the app got three
  // keys it does not read — no courier card, no map, no ETA — and they only
  // appeared once tracking STOPPED, because that branch maps by hand.
  const src = readFileSync(join(ROOT, "app/api/mobile/v1/orders/[orderId]/tracking/route.ts"), "utf8");
  assert.ok(!/\.\.\.payload/.test(src),
    "the tracking payload must be mapped field by field, never spread");
  for (const key of ["courier: payload.driver", "courierLocation: payload.location", "etaMins: payload.etaToDropoffMins"]) {
    assert.ok(src.includes(key), `missing mapping: ${key}`);
  }
  // Both branches must offer the same shape.
  assert.equal((src.match(/courier:/g) ?? []).length >= 2, true);
});

console.log(`\n${passed} checks passed\n`);
