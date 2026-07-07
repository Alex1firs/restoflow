// Unit tests for nextOpenTime (Africa/Lagos next-open calculation).
// Run: npx tsx lib/__tests__/restaurant-utils.test.ts

import assert from "node:assert/strict";
import { nextOpenTime, type OpeningHours } from "../restaurant-utils";

let passed = 0;
function test(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }

// 09:00–22:00 every day.
const NINE_TO_TEN: OpeningHours = {};
for (let d = 0; d < 7; d++) NINE_TO_TEN[d.toString()] = { open: true, from: "09:00", to: "22:00" };

// 2026-07-07 is a Tuesday. Lagos = UTC+1 (no DST).
console.log("nextOpenTime");

test("opens later today (before opening)", () => {
  const r = nextOpenTime(NINE_TO_TEN, new Date("2026-07-07T06:00:00Z")); // 07:00 Lagos
  assert.equal(r.kind, "opens");
  if (r.kind === "opens") {
    assert.equal(r.label, "9:00 AM");
    assert.equal(r.date, "2026-07-07");
    assert.equal(r.time, "09:00");
    assert.equal(r.sameDay, true);
  }
});

test("currently open → kind 'open'", () => {
  assert.equal(nextOpenTime(NINE_TO_TEN, new Date("2026-07-07T12:00:00Z")).kind, "open"); // 13:00 Lagos
  assert.equal(nextOpenTime(NINE_TO_TEN, new Date("2026-07-07T08:30:00Z")).kind, "open"); // 09:30 Lagos
});

test("already closed today → opens tomorrow", () => {
  const r = nextOpenTime(NINE_TO_TEN, new Date("2026-07-07T21:30:00Z")); // 22:30 Lagos (after 22:00)
  assert.equal(r.kind, "opens");
  if (r.kind === "opens") {
    assert.equal(r.label, "Tomorrow 9:00 AM");
    assert.equal(r.date, "2026-07-08");
    assert.equal(r.sameDay, false);
  }
});

test("closed all day today → opens next open day (Tomorrow)", () => {
  const hours: OpeningHours = { ...NINE_TO_TEN, "2": { open: false, from: "09:00", to: "22:00" } }; // Tue closed
  const r = nextOpenTime(hours, new Date("2026-07-07T10:00:00Z")); // Tue 11:00 Lagos
  assert.equal(r.kind, "opens");
  if (r.kind === "opens") {
    assert.equal(r.label, "Tomorrow 9:00 AM"); // Wed
    assert.equal(r.date, "2026-07-08");
  }
});

test("opens several days out → weekday-prefixed label", () => {
  // Tue + Wed closed → next open is Thu (offset 2).
  const hours: OpeningHours = { ...NINE_TO_TEN, "2": { open: false, from: "09:00", to: "22:00" }, "3": { open: false, from: "09:00", to: "22:00" } };
  const r = nextOpenTime(hours, new Date("2026-07-07T10:00:00Z")); // Tue
  assert.equal(r.kind, "opens");
  if (r.kind === "opens") {
    assert.equal(r.date, "2026-07-09"); // Thursday
    assert.equal(r.label, "Thu 9:00 AM");
  }
});

test("always open (empty/missing hours) → kind 'open'", () => {
  assert.equal(nextOpenTime({}, new Date("2026-07-07T03:00:00Z")).kind, "open");
  assert.equal(nextOpenTime(null, new Date("2026-07-07T03:00:00Z")).kind, "open");
  assert.equal(nextOpenTime(undefined, new Date("2026-07-07T03:00:00Z")).kind, "open");
});

test("no open days at all → kind 'never'", () => {
  const closed: OpeningHours = {};
  for (let d = 0; d < 7; d++) closed[d.toString()] = { open: false, from: "09:00", to: "22:00" };
  assert.equal(nextOpenTime(closed, new Date("2026-07-07T10:00:00Z")).kind, "never");
});

test("afternoon-only hours: before open → opens today with correct time", () => {
  const pm: OpeningHours = {};
  for (let d = 0; d < 7; d++) pm[d.toString()] = { open: true, from: "16:30", to: "23:00" };
  const r = nextOpenTime(pm, new Date("2026-07-07T09:00:00Z")); // 10:00 Lagos, before 16:30
  assert.equal(r.kind, "opens");
  if (r.kind === "opens") {
    assert.equal(r.label, "4:30 PM");
    assert.equal(r.time, "16:30");
  }
});

console.log(`\n${passed} checks passed`);
