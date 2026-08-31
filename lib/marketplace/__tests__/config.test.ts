// Feature flags and opt-in: no existing restaurant may be listed by accident.
// Run: npx tsx lib/marketplace/__tests__/config.test.ts

import assert from "node:assert/strict";
import { readMarketplaceSettings, readMarkup, isOrderable, pricingConfigFor, readFlags } from "../config";

let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`  ✓ ${name}`); };
console.log("marketplace/config");

const T0 = 1_756_000_000_000;

test("[1] THE GUARANTEE: a restaurant with no marketplace map is internal_only", () => {
  for (const doc of [{}, { name: "Trisha's Kitchen", status: "live" }, { marketplace: null }]) {
    const s = readMarketplaceSettings(doc);
    assert.equal(s.state, "internal_only");
    assert.equal(s.marketplaceEnabled, false);
    assert.equal(isOrderable(s, T0).ok, false);
  }
  assert.equal(readMarketplaceSettings(null).marketplaceEnabled, false);
  assert.equal(readMarketplaceSettings(undefined).marketplaceEnabled, false);
});

test("[2] a live production-shaped restaurant is NOT listed", () => {
  // The real shape of an existing record: live, subscribed, geocoded, trading.
  const trishas = {
    name: "Trisha's Kitchen", status: "live", subscriptionStatus: "active",
    deliveryEnabled: true, pickupEnabled: true, latitude: 6.6, longitude: 3.35,
    paystackSubaccountCode: "ACCT_x", orderCounter: 4821,
  };
  const s = readMarketplaceSettings(trishas);
  assert.equal(s.marketplaceEnabled, false);
  assert.equal(isOrderable(s, T0).reason, "not_listed");
});

test("[3] BOTH switches are required — approval alone does not list", () => {
  assert.equal(readMarketplaceSettings({ marketplace: { state: "active" } }).marketplaceEnabled, false);
  assert.equal(readMarketplaceSettings({ marketplace: { marketplaceEnabled: true } }).marketplaceEnabled, false);
  assert.equal(readMarketplaceSettings({ marketplace: { state: "active", marketplaceEnabled: true } }).marketplaceEnabled, true);
});

test("[4] every non-active state refuses orders, with a distinct reason", () => {
  for (const [state, reason] of [["onboarding", "not_listed"], ["paused", "not_listed"],
                                 ["suspended", "not_listed"], ["internal_only", "not_listed"]] as const) {
    const s = readMarketplaceSettings({ marketplace: { state, marketplaceEnabled: true } });
    assert.equal(isOrderable(s, T0).reason, reason, state);
  }
});

test("[5] a paused-until timestamp closes ordering, and reopens by itself", () => {
  const s = readMarketplaceSettings({
    marketplace: { state: "active", marketplaceEnabled: true, unavailableUntil: T0 + 3600_000 },
  });
  assert.equal(isOrderable(s, T0).reason, "temporarily_unavailable");
  assert.equal(isOrderable(s, T0 + 3600_001).ok, true);
});

test("[6] a malformed marketplace map falls back to internal_only, never to live", () => {
  for (const m of ["yes", 42, [], { state: "LIVE_NOW" }, { state: null }]) {
    const s = readMarketplaceSettings({ marketplace: m });
    assert.equal(s.marketplaceEnabled, false, JSON.stringify(m));
  }
});

test("[7] an unrecognised markup rule is `none`, never a guessed percentage", () => {
  assert.deepEqual(readMarkup(undefined), { type: "none" });
  assert.deepEqual(readMarkup({ type: "percent" }), { type: "none" });        // no bps
  assert.deepEqual(readMarkup({ type: "percent", bps: -5 }), { type: "none" });
  assert.deepEqual(readMarkup({ type: "wat", bps: 2000 }), { type: "none" });
  assert.deepEqual(readMarkup({ type: "percent", bps: 2000 }), { type: "percent", bps: 2000 });
  assert.deepEqual(readMarkup({ type: "fixed", amountMinor: 50_000 }), { type: "fixed", amountMinor: 50_000 });
});

test("[8] a restaurant's configured `none` is honoured, not overridden", () => {
  const s = readMarketplaceSettings({
    marketplace: { state: "active", marketplaceEnabled: true, pricing: { markup: { type: "none" } } },
  });
  const c = pricingConfigFor({ settings: s, platformDefault: { type: "percent", bps: 3000 } });
  assert.deepEqual(c.restaurantDefault, { type: "none" });
});

test("[9] prep times default sensibly and are read when set", () => {
  assert.deepEqual(readMarketplaceSettings({}).prepTimeMins, { min: 20, max: 40 });
  const s = readMarketplaceSettings({ marketplace: { prepTimeMins: { min: 15, max: 30 } } });
  assert.deepEqual(s.prepTimeMins, { min: 15, max: 30 });
  // A nonsensical value falls back rather than producing a zero-minute prep.
  assert.equal(readMarketplaceSettings({ marketplace: { prepTimeMins: { min: 0, max: -3 } } }).prepTimeMins.min, 20);
});

test("[10] flags default OFF and nest — payments cannot be on without the marketplace", () => {
  assert.deepEqual(readFlags({}), { enabled: false, paymentsEnabled: false, deliveryEnabled: false });
  assert.deepEqual(
    readFlags({ MARKETPLACE_PAYMENTS_ENABLED: "true", DELIVERY_INTEGRATION_ENABLED: "true" }),
    { enabled: false, paymentsEnabled: false, deliveryEnabled: false },
    "the master switch gates everything below it"
  );
  assert.deepEqual(
    readFlags({ MARKETPLACE_ENABLED: "true", MARKETPLACE_PAYMENTS_ENABLED: "true", DELIVERY_INTEGRATION_ENABLED: "true" }),
    { enabled: true, paymentsEnabled: true, deliveryEnabled: true }
  );
});

test("[11] only the exact string 'true' enables anything", () => {
  for (const v of ["TRUE", "1", "yes", "on", " true"]) {
    assert.equal(readFlags({ MARKETPLACE_ENABLED: v }).enabled, false, v);
  }
});

console.log(`\n${passed} checks passed\n`);
