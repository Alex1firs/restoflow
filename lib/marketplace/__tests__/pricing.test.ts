// Marketplace pricing: resolution, the snapshot, and the money invariants.
// Run: npx tsx lib/marketplace/__tests__/pricing.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  resolveMarkup, applyMarkup, roundUpTo, priceLine, buildSnapshot, checkInvariants,
  DEFAULT_ROUND_TO, formatNaira,
  type PricingConfig, type LineInput, type MarkupRule,
} from "../pricing";

let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`  ✓ ${name}`); };
console.log("marketplace/pricing");

const T0 = 1_756_000_000_000;
const cfg = (over: Partial<PricingConfig> = {}): PricingConfig => ({
  platformDefault: { type: "percent", bps: 1500 },
  restaurantDefault: null,
  roundToMinor: DEFAULT_ROUND_TO,
  rulesVersion: 1,
  ...over,
});

test("[1] resolution walks item → restaurant → platform, most specific first", () => {
  const c = cfg({ restaurantDefault: { type: "percent", bps: 2000 } });
  assert.equal(resolveMarkup({ type: "fixed", amountMinor: 500 }, c).source, "item");
  assert.equal(resolveMarkup(null, c).source, "restaurant");
  assert.equal(resolveMarkup(null, cfg()).source, "platform");
});

test("[2] a configured `none` is a real answer and stops the walk", () => {
  const c = cfg({ restaurantDefault: { type: "none" } });
  const r = resolveMarkup(null, c);
  assert.equal(r.source, "restaurant");
  assert.deepEqual(r.rule, { type: "none" });
  // "this restaurant takes no markup" must not fall through to the platform 15%
  assert.equal(applyMarkup(1_000_000, r.rule), 1_000_000);
});

test("[3] percent markup is basis points, computed in integers", () => {
  assert.equal(applyMarkup(1_000_000, { type: "percent", bps: 2000 }), 1_200_000); // ₦10,000 +20%
  assert.equal(applyMarkup(1_000_000, { type: "percent", bps: 0 }), 1_000_000);
  assert.equal(applyMarkup(333, { type: "percent", bps: 1500 }), 383);             // rounds once
  assert.ok(Number.isInteger(applyMarkup(99_999, { type: "percent", bps: 1234 })));
});

test("[4] no percentage is hard-coded — every value is configured", () => {
  for (const bps of [0, 500, 1000, 2000, 3000, 5000, 12345]) {
    const out = applyMarkup(1_000_000, { type: "percent", bps });
    assert.equal(out, 1_000_000 + Math.round(1_000_000 * bps / 10_000), String(bps));
  }
});

test("[5] fixed and absolute rules behave differently", () => {
  assert.equal(applyMarkup(1_000_000, { type: "fixed", amountMinor: 50_000 }), 1_050_000);
  assert.equal(applyMarkup(1_000_000, { type: "absolute", amountMinor: 1_400_000 }), 1_400_000);
});

test("[6] rounding is UP to the configured step", () => {
  assert.equal(roundUpTo(1_150_001, 5000), 1_155_000);
  assert.equal(roundUpTo(1_150_000, 5000), 1_150_000);
  assert.equal(roundUpTo(1, 5000), 5000);
  assert.equal(roundUpTo(1_234_567, 0), 1_234_567); // no step → no rounding
});

test("[7] THE WORKED EXAMPLE: ₦10,000 base, 20% markup → ₦12,000 customer", () => {
  const line = priceLine(
    { dishId: "d1", name: "Jollof + Chicken", quantity: 1, basePriceMinor: 1_000_000 },
    cfg({ restaurantDefault: { type: "percent", bps: 2000 } })
  );
  assert.equal(line.restaurantUnitMinor, 1_000_000);
  assert.equal(line.customerPriceMinor, 1_200_000);
  assert.equal(formatNaira(line.customerPriceMinor), "₦12,000");
});

test("[8] …and the full basket: + ₦2,000 delivery → ₦14,000 charged", () => {
  const s = buildSnapshot({
    lines: [{ dishId: "d1", name: "Jollof", quantity: 1, basePriceMinor: 1_000_000 }],
    config: cfg({ restaurantDefault: { type: "percent", bps: 2000 } }),
    deliveryFeeMinor: 200_000, deliveryCostMinor: 160_000,
    quoteId: "QT-1", nowMs: T0,
  });
  assert.equal(s.customerSubtotalMinor, 1_200_000);
  assert.equal(s.restaurantSubtotalMinor, 1_000_000);
  assert.equal(s.markupTotalMinor, 200_000);
  assert.equal(s.totalChargedMinor, 1_400_000);
  assert.equal(formatNaira(s.totalChargedMinor), "₦14,000");
  assert.equal(s.restaurantPayableMinor, 1_000_000, "the restaurant gets its own price, exactly");
  assert.equal(s.deliveryPayableMinor, 160_000);
  assert.equal(s.platformGrossMinor, 200_000 + 40_000, "markup + delivery margin");
  assert.equal(checkInvariants(s).ok, true);
});

test("[9] options are marked up with the base, not after it", () => {
  const line = priceLine(
    { dishId: "d1", name: "Suya", quantity: 2, basePriceMinor: 500_000, optionsTotalMinor: 100_000 },
    cfg({ restaurantDefault: { type: "percent", bps: 2000 }, roundToMinor: 0 })
  );
  assert.equal(line.restaurantUnitMinor, 600_000);
  assert.equal(line.customerPriceMinor, 720_000);
  assert.equal(line.lineRestaurantMinor, 1_200_000);
  assert.equal(line.lineCustomerMinor, 1_440_000);
});

test("[10] an item override beats the restaurant default", () => {
  const c = cfg({ restaurantDefault: { type: "percent", bps: 2000 }, roundToMinor: 0 });
  const normal = priceLine({ dishId: "a", name: "A", quantity: 1, basePriceMinor: 1_000_000 }, c);
  const overridden = priceLine(
    { dishId: "b", name: "B", quantity: 1, basePriceMinor: 1_000_000, override: { type: "percent", bps: 500 } }, c);
  assert.equal(normal.customerPriceMinor, 1_200_000);
  assert.equal(overridden.customerPriceMinor, 1_050_000);
  assert.equal(overridden.markupApplied.source, "item");
});

test("[11] a customer price can NEVER sit below the restaurant's own price", () => {
  // An operator typo in an absolute override must not produce a loss-making line.
  const line = priceLine(
    { dishId: "d", name: "D", quantity: 1, basePriceMinor: 1_000_000, override: { type: "absolute", amountMinor: 100 } },
    cfg()
  );
  assert.equal(line.customerPriceMinor, 1_000_000);
  assert.equal(checkInvariants(buildSnapshot({
    lines: [{ dishId: "d", name: "D", quantity: 1, basePriceMinor: 1_000_000, override: { type: "absolute", amountMinor: 100 } }],
    config: cfg(), deliveryFeeMinor: 0, deliveryCostMinor: 0, quoteId: null, nowMs: T0,
  })).ok, true);
});

test("[12] THE POS PRICE IS NEVER TOUCHED — base survives every rule", () => {
  const rules: MarkupRule[] = [
    { type: "none" }, { type: "percent", bps: 3000 },
    { type: "fixed", amountMinor: 250_000 }, { type: "absolute", amountMinor: 2_000_000 },
  ];
  for (const rule of rules) {
    const line = priceLine({ dishId: "d", name: "D", quantity: 1, basePriceMinor: 1_000_000, override: rule }, cfg());
    assert.equal(line.basePriceMinor, 1_000_000, JSON.stringify(rule));
    assert.equal(line.restaurantUnitMinor, 1_000_000, JSON.stringify(rule));
  }
});

test("[13] discounts: who funds one decides who absorbs it", () => {
  const base = {
    lines: [{ dishId: "d", name: "D", quantity: 1, basePriceMinor: 1_000_000 }] as LineInput[],
    config: cfg({ restaurantDefault: { type: "percent", bps: 2000 } }),
    deliveryFeeMinor: 200_000, deliveryCostMinor: 200_000, quoteId: null, nowMs: T0,
  };
  const platformFunded = buildSnapshot({ ...base, discounts: [{ code: "WELCOME", amountMinor: 100_000, fundedBy: "platform" }] });
  const restaurantFunded = buildSnapshot({ ...base, discounts: [{ code: "CHEF", amountMinor: 100_000, fundedBy: "restaurant" }] });

  assert.equal(platformFunded.restaurantPayableMinor, 1_000_000, "platform-funded: restaurant untouched");
  assert.equal(restaurantFunded.restaurantPayableMinor, 900_000, "restaurant-funded: restaurant absorbs it");
  assert.equal(platformFunded.totalChargedMinor, restaurantFunded.totalChargedMinor, "the customer pays the same either way");
  assert.equal(checkInvariants(platformFunded).ok, true);
  assert.equal(checkInvariants(restaurantFunded).ok, true);
});

test("[14] the processor fee comes out of platform margin, not the restaurant", () => {
  const s = buildSnapshot({
    lines: [{ dishId: "d", name: "D", quantity: 1, basePriceMinor: 1_000_000 }],
    config: cfg({ restaurantDefault: { type: "percent", bps: 2000 } }),
    deliveryFeeMinor: 200_000, deliveryCostMinor: 160_000,
    processorFeeMinor: 21_000, quoteId: null, nowMs: T0,
  });
  assert.equal(s.restaurantPayableMinor, 1_000_000);
  assert.equal(s.platformGrossMinor, 200_000 + 40_000 - 21_000);
  assert.equal(checkInvariants(s).ok, true);
});

test("[15] INVARIANT 1 — charged == subtotal + delivery + tax − discounts", () => {
  const s = buildSnapshot({
    lines: [{ dishId: "a", name: "A", quantity: 3, basePriceMinor: 333_333 }],
    config: cfg(), deliveryFeeMinor: 175_000, deliveryCostMinor: 150_000,
    taxMinor: 12_345, discounts: [{ code: "X", amountMinor: 50_000, fundedBy: "platform" }],
    quoteId: null, nowMs: T0,
  });
  assert.equal(
    s.totalChargedMinor,
    s.customerSubtotalMinor + s.deliveryFeeMinor + s.taxMinor - s.discountTotalMinor
  );
});

test("[16] INVARIANT 2 — the money in equals the money out", () => {
  const s = buildSnapshot({
    lines: [{ dishId: "a", name: "A", quantity: 2, basePriceMinor: 750_000 }],
    config: cfg({ restaurantDefault: { type: "percent", bps: 2500 } }),
    deliveryFeeMinor: 200_000, deliveryCostMinor: 175_000,
    processorFeeMinor: 30_000, taxMinor: 5_000, quoteId: null, nowMs: T0,
  });
  assert.equal(
    s.restaurantPayableMinor + s.deliveryPayableMinor + s.platformGrossMinor +
    s.processorFeeMinor + s.taxMinor,
    s.totalChargedMinor
  );
  // Tax is a separate claim, not platform revenue.
  assert.equal(s.taxMinor, 5_000);
  assert.equal(s.platformGrossMinor,
    s.markupTotalMinor + (s.deliveryFeeMinor - s.deliveryCostMinor) - s.processorFeeMinor);
});

test("[17] PROPERTY: both invariants hold across 2,000 randomised baskets", () => {
  let rng = 42;
  const rand = (n: number) => { rng = (rng * 1103515245 + 12345) & 0x7fffffff; return rng % n; };

  for (let i = 0; i < 2000; i++) {
    const lineCount = 1 + rand(4);
    const lines: LineInput[] = [];
    for (let j = 0; j < lineCount; j++) {
      const overrideRoll = rand(4);
      const override: MarkupRule | null =
        overrideRoll === 0 ? { type: "percent", bps: rand(5000) } :
        overrideRoll === 1 ? { type: "fixed", amountMinor: rand(200_000) } :
        overrideRoll === 2 ? { type: "none" } : null;
      lines.push({
        dishId: `d${j}`, name: `D${j}`, quantity: 1 + rand(5),
        basePriceMinor: 10_000 + rand(2_000_000),
        optionsTotalMinor: rand(150_000),
        override,
      });
    }
    const restaurantDefault: MarkupRule | null = rand(2) === 0 ? { type: "percent", bps: rand(4000) } : null;
    const deliveryCost = rand(400_000);
    const s = buildSnapshot({
      lines,
      config: cfg({ restaurantDefault, roundToMinor: [0, 1000, 5000, 10_000][rand(4)] }),
      deliveryFeeMinor: deliveryCost + rand(80_000),
      deliveryCostMinor: deliveryCost,
      processorFeeMinor: rand(50_000),
      taxMinor: rand(20_000),
      discounts: rand(3) === 0
        ? [{ code: "R", amountMinor: rand(60_000), fundedBy: rand(2) === 0 ? "platform" : "restaurant" }]
        : [],
      quoteId: null, nowMs: T0,
    });
    const v = checkInvariants(s);
    assert.equal(v.ok, true, `iteration ${i}: ${v.ok ? "" : v.errors.join("; ")}`);
    assert.ok(Number.isInteger(s.totalChargedMinor), `iteration ${i}: non-integer total`);
  }
});

test("[18] the snapshot records WHICH rule priced each line, for disputes", () => {
  const s = buildSnapshot({
    lines: [
      { dishId: "a", name: "A", quantity: 1, basePriceMinor: 500_000, override: { type: "percent", bps: 1000 } },
      { dishId: "b", name: "B", quantity: 1, basePriceMinor: 500_000 },
    ],
    config: cfg({ restaurantDefault: { type: "percent", bps: 2000 } }),
    deliveryFeeMinor: 0, deliveryCostMinor: 0, quoteId: "QT-9", nowMs: T0,
  });
  assert.equal(s.lines[0].markupApplied.source, "item");
  assert.equal(s.lines[1].markupApplied.source, "restaurant");
  assert.equal(s.rulesVersion, 1);
  assert.equal(s.computedAt, T0);
  assert.equal(s.quoteId, "QT-9");
});

test("[19] a later config change cannot alter an existing snapshot", () => {
  const lines: LineInput[] = [{ dishId: "d", name: "D", quantity: 1, basePriceMinor: 1_000_000 }];
  const before = buildSnapshot({
    lines, config: cfg({ restaurantDefault: { type: "percent", bps: 2000 } }),
    deliveryFeeMinor: 0, deliveryCostMinor: 0, quoteId: null, nowMs: T0,
  });
  const frozen = JSON.parse(JSON.stringify(before));
  // The operator triples the markup tomorrow.
  buildSnapshot({
    lines, config: cfg({ restaurantDefault: { type: "percent", bps: 6000 } }),
    deliveryFeeMinor: 0, deliveryCostMinor: 0, quoteId: null, nowMs: T0 + 86_400_000,
  });
  assert.deepEqual(before, frozen, "the historical snapshot is a value, not a view");
});

test("[20] a delivery subsidy is expressible as a NEGATIVE delivery margin", () => {
  const s = buildSnapshot({
    lines: [{ dishId: "d", name: "D", quantity: 1, basePriceMinor: 1_000_000 }],
    config: cfg({ restaurantDefault: { type: "percent", bps: 2000 } }),
    deliveryFeeMinor: 0,          // free delivery promotion
    deliveryCostMinor: 200_000,   // Dispatcher still charges us
    quoteId: null, nowMs: T0,
  });
  assert.equal(s.platformGrossMinor, 200_000 - 200_000, "the markup pays for the free delivery");
  assert.equal(s.restaurantPayableMinor, 1_000_000, "the restaurant is unaffected");
  assert.equal(checkInvariants(s).ok, true);
});

test("[MARKUP APPLIES ONCE] an option is not marked up twice", () => {
  // Found on staging: the storefront displayed a ₦500 option at ₦600 (20%),
  // and checkout charged ₦750 — because the quote fed the ALREADY marked-up
  // customer price into `optionsTotalMinor`, which is marked up again with the
  // base. The customer was shown one price and charged another.
  const config = cfg({ restaurantDefault: { type: "percent", bps: 2000 }, roundToMinor: 0 });

  const plain = priceLine({ dishId: "d", name: "Jollof", quantity: 1, basePriceMinor: 350_000 }, config);
  const withOption = priceLine(
    { dishId: "d", name: "Jollof", quantity: 1, basePriceMinor: 350_000, optionsTotalMinor: 50_000 },
    config
  );

  // The option costs the restaurant ₦500; the customer pays ₦600 more, not ₦750.
  assert.equal(withOption.customerPriceMinor - plain.customerPriceMinor, 60_000,
    "an option must carry exactly one markup");

  // And the whole line is simply (base + options) marked up once.
  assert.equal(withOption.customerPriceMinor, Math.round(400_000 * 1.2));
});

test("[MARKUP APPLIES ONCE] the quote passes BASE option prices, never customer ones", () => {
  // Structural: the public projection carries customer prices, so summing
  // `choice.priceMinor` into the line is the bug above. The quote must look the
  // base price up from the raw menu document instead.
  const src = readFileSync(join(__dirname, "..", "quote.ts"), "utf8");
  assert.ok(!/optionsTotalMinor \+= choice\.priceMinor/.test(src),
    "the quote is summing customer-priced options into the marked-up line again");
  assert.match(src, /optionBaseMinor\.get/);
  assert.match(src, /function baseOptionPrices/);
});

console.log(`\n${passed} checks passed\n`);
