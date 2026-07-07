// Unit tests for display-layer menu normalization + search.
// Run: npx tsx lib/__tests__/menu-utils.test.ts

import assert from "node:assert/strict";
import {
  normalizeCategoryKey,
  categoryDisplayLabel,
  groupCategories,
  itemMatchesQuery,
  filterMenuItems,
  type MenuLike,
} from "../menu-utils";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const item = (id: string, name: string, category: string | null, description = ""): MenuLike => ({ id, name, category, description });

// A realistic messy menu (mirrors Food Kapitol's live "grills/Grills/GRILLS").
const MENU: MenuLike[] = [
  item("1", "Bole with Grilled Turkey", "grills", "smoky plantain and turkey"),
  item("2", "Suya Platter", "Grills", "spicy beef skewers"),
  item("3", "Chicken Wings", "GRILLS", "peppered wings"),
  item("4", "Jollof Rice", "Rice Dishes", "party jollof"),
  item("5", "Fried Rice", " rice   dishes ", "veg fried rice"),
  item("6", "Bottled Water", "", "still water"), // blank category
  item("7", "Chapman", null, "house mocktail"),  // null category
];

console.log("menu-utils");

test("grills / Grills / GRILLS normalize to one key", () => {
  assert.equal(normalizeCategoryKey("grills"), "grills");
  assert.equal(normalizeCategoryKey("Grills"), "grills");
  assert.equal(normalizeCategoryKey("GRILLS"), "grills");
});

test("whitespace is trimmed and collapsed", () => {
  assert.equal(normalizeCategoryKey("  rice   dishes  "), "rice dishes");
  assert.equal(normalizeCategoryKey("\tGRILLS\n"), "grills");
});

test("display label is restaurant-friendly Title Case", () => {
  assert.equal(categoryDisplayLabel("GRILLS"), "Grills");
  assert.equal(categoryDisplayLabel("  rice   dishes "), "Rice Dishes");
  assert.equal(categoryDisplayLabel(""), "");
  assert.equal(categoryDisplayLabel(null), "");
});

test("grills/Grills/GRILLS become ONE tab with correct count + label", () => {
  const groups = groupCategories(MENU);
  const grills = groups.filter((g) => g.key === "grills");
  assert.equal(grills.length, 1, "exactly one grills tab");
  assert.equal(grills[0].label, "Grills");
  assert.equal(grills[0].count, 3, "all three grills items counted");
});

test("whitespace-variant categories merge correctly", () => {
  const groups = groupCategories(MENU);
  const rice = groups.filter((g) => g.key === "rice dishes");
  assert.equal(rice.length, 1, "'Rice Dishes' and ' rice   dishes ' merge");
  assert.equal(rice[0].count, 2);
  assert.equal(rice[0].label, "Rice Dishes");
});

test("blank / null categories produce no tab (but items are NOT dropped)", () => {
  const groups = groupCategories(MENU);
  assert.ok(!groups.some((g) => g.key === ""), "no empty-key tab");
  // Only 'grills' and 'rice dishes' remain as tabs.
  assert.deepEqual(groups.map((g) => g.key), ["grills", "rice dishes"]);
  // The blank/null-category items still exist in the full list.
  const all = filterMenuItems(MENU, null, "");
  assert.equal(all.length, MENU.length, "no items dropped by grouping");
  assert.ok(all.some((i) => i.id === "6") && all.some((i) => i.id === "7"));
});

test("tabs preserve first-seen menu order", () => {
  const groups = groupCategories(MENU);
  assert.deepEqual(groups.map((g) => g.label), ["Grills", "Rice Dishes"]);
});

test("filtering by a normalized category key captures all raw variants", () => {
  const grills = filterMenuItems(MENU, "grills", "");
  assert.deepEqual(grills.map((i) => i.id).sort(), ["1", "2", "3"]);
});

test("search by item NAME works", () => {
  const r = filterMenuItems(MENU, null, "jollof");
  assert.deepEqual(r.map((i) => i.id), ["4"]);
});

test("search by DESCRIPTION works", () => {
  const r = filterMenuItems(MENU, null, "skewers");
  assert.deepEqual(r.map((i) => i.id), ["2"]);
});

test("search by normalized CATEGORY works", () => {
  const r = filterMenuItems(MENU, null, "rice dishes");
  assert.deepEqual(r.map((i) => i.id).sort(), ["4", "5"]);
});

test("search is case-insensitive and trims", () => {
  assert.ok(itemMatchesQuery(item("x", "Peppered Wings", "grills"), "  WINGS "));
  assert.equal(itemMatchesQuery(item("x", "Water", "drinks"), "sushi"), false);
});

test("empty query matches everything (no items disappear)", () => {
  assert.equal(filterMenuItems(MENU, null, "").length, MENU.length);
  assert.equal(filterMenuItems(MENU, null, "   ").length, MENU.length);
});

test("category + search combine (both must match)", () => {
  // 'grills' tab + query 'wings' → only the wings item
  assert.deepEqual(filterMenuItems(MENU, "grills", "wings").map((i) => i.id), ["3"]);
  // 'grills' tab + query that matches nothing in grills → empty (drives empty state)
  assert.deepEqual(filterMenuItems(MENU, "grills", "jollof"), []);
});

console.log(`\n${passed} checks passed`);
