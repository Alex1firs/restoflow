// Unit tests for the landing discovery-showcase pure helpers.
// Run: npx tsx app/components/__tests__/discover-showcase-lib.test.ts

import assert from "node:assert/strict";
import { serviceAreaLine } from "../discover-showcase-lib";

let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`  ✓ ${name}`); };

console.log("discover-showcase-lib");

test("serviceAreaLine: empty / all-blank → static fallback", () => {
  assert.equal(serviceAreaLine([]), "Now serving cities across Nigeria");
  assert.equal(serviceAreaLine([null, "", "  ", undefined]), "Now serving cities across Nigeria");
});

test("serviceAreaLine: one or two states joined with &", () => {
  assert.equal(serviceAreaLine(["Anambra"]), "Now serving Anambra");
  assert.equal(serviceAreaLine(["Anambra", "Lagos"]), "Now serving Anambra & Lagos");
});

test("serviceAreaLine: 3+ states → first two + 'more'", () => {
  assert.equal(serviceAreaLine(["Anambra", "Lagos", "Enugu"]), "Now serving Anambra, Lagos & more");
});

test("serviceAreaLine: dedupes + trims, preserves first-seen order", () => {
  assert.equal(serviceAreaLine([" Lagos ", "Lagos", "Anambra", "lagos"]), "Now serving Lagos, Anambra & more");
});

console.log(`\n${passed} checks passed`);
