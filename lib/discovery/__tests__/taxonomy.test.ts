// Unit tests for the food taxonomy (Sprint 2.2).
// Run: npx tsx lib/discovery/__tests__/taxonomy.test.ts

import assert from "node:assert/strict";
import {
  deriveTaxonomyTags,
  isCanonicalTag,
  CANONICAL_CATEGORIES,
  TAXONOMY_VERSION,
} from "../taxonomy";

let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`  ✓ ${name}`); };
const has = (tags: string[], t: string) => tags.includes(t);

console.log("discovery/taxonomy");

test("13 canonical categories after the approved swallow/soups merge", () => {
  assert.equal(CANONICAL_CATEGORIES.length, 13);
  assert.equal(TAXONOMY_VERSION, 1);
  // the three seed rows collapse into ONE canonical key/label
  const swallow = CANONICAL_CATEGORIES.filter((c) => c.key === "swallow-soups");
  assert.equal(swallow.length, 1);
  assert.equal(swallow[0].label, "Swallow & Soups");
});

// ── Synonyms + case/whitespace normalization ──
test("grills / Grills / GRILLS category → grills-suya", () => {
  for (const cat of ["grills", "Grills", "GRILLS", "  grills "]) {
    assert.deepEqual(deriveTaxonomyTags(cat, "Tasty Dish"), ["grills-suya"], `cat=${cat}`);
  }
});

test("swallow, soups-broths, and pepper soup all map to swallow-soups (merge)", () => {
  assert.ok(has(deriveTaxonomyTags("Swallow", ""), "swallow-soups"));
  assert.ok(has(deriveTaxonomyTags("Soups", ""), "swallow-soups"));
  assert.ok(has(deriveTaxonomyTags("Pepper Soup", ""), "swallow-soups"));
  assert.ok(has(deriveTaxonomyTags("Egusi", ""), "swallow-soups"));
});

test("Sides label: 'sides' and 'side dish' → swallow-sides", () => {
  assert.ok(has(deriveTaxonomyTags("Sides", ""), "swallow-sides"));
  assert.ok(has(deriveTaxonomyTags("Side Dish", ""), "swallow-sides"));
  assert.equal(CANONICAL_CATEGORIES.find((c) => c.key === "swallow-sides")?.label, "Sides");
});

// ── Multi-tagging (ruling #3) ──
test("category + dish-name imply different tags → BOTH applied", () => {
  const tags = deriveTaxonomyTags("Specials", "Jollof Rice");
  assert.ok(has(tags, "combos-specials"), "from category 'Specials'");
  assert.ok(has(tags, "rice-jollof"), "from name 'Jollof Rice'");
});

test("grilled chicken under Rice Dishes → rice-jollof + grills-suya + proteins", () => {
  const tags = deriveTaxonomyTags("Rice Dishes", "Grilled Chicken");
  assert.ok(has(tags, "rice-jollof"));  // category
  assert.ok(has(tags, "grills-suya"));  // name "grilled"
  assert.ok(has(tags, "proteins"));     // name "chicken"
});

test("tags are deduped and in stable seed order", () => {
  const tags = deriveTaxonomyTags("Rice", "Jollof Rice"); // both imply rice-jollof only
  assert.deepEqual(tags, ["rice-jollof"]);
});

// ── Fallback (ruling #4) — non-destructive, never drop ──
test("unmapped category with no keyword match → provisional normalized-label tag", () => {
  assert.deepEqual(deriveTaxonomyTags("Chef's Table", "Mystery Box"), ["chef's table"]);
  // whitespace/case normalized for the provisional tag
  assert.deepEqual(deriveTaxonomyTags("  OWANBE   Selection ", "Zzz"), ["owanbe selection"]);
});

test("provisional tag is NOT canonical; canonical keys are", () => {
  assert.equal(isCanonicalTag("chef's table"), false);
  assert.equal(isCanonicalTag("rice-jollof"), true);
});

test("no category and no keyword match → empty tags (item still not dropped)", () => {
  assert.deepEqual(deriveTaxonomyTags("", "Zxqv"), []);
  assert.deepEqual(deriveTaxonomyTags(null, null), []);
});

// ── Non-destructive: derivation only reads, never mutates input ──
test("derivation does not mutate its inputs", () => {
  const cat = "GRILLS";
  const name = "Suya Platter";
  deriveTaxonomyTags(cat, name);
  assert.equal(cat, "GRILLS");        // unchanged
  assert.equal(name, "Suya Platter"); // unchanged
});

test("word-boundary matching avoids false positives", () => {
  // "price" must not trigger rice-jollof via the 'rice' keyword
  const tags = deriveTaxonomyTags("Menu", "Best Price Combo");
  assert.ok(!has(tags, "rice-jollof"), "'price' should not match 'rice'");
  assert.ok(has(tags, "combos-specials"), "'combo' should match");
});

console.log(`\n${passed} checks passed`);
