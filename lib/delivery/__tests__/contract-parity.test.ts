/**
 * Cross-repository contract parity — RestoFlow side.
 *
 * The identical fixture file lives in the Dispatcher repository at
 * functions/integration/test/contract-fixtures.json. Both repos assert their
 * own implementation against it, so a change to the state set, the header
 * names, the status mapping or the signing scheme in either repo fails a test
 * in BOTH — instead of becoming a production incident the first time an event
 * crosses the boundary.
 *
 * Run: npx tsx lib/delivery/__tests__/contract-parity.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CONTRACT_VERSION, CONTRACT_MAJOR, DELIVERY_STATES, TERMINAL_STATES,
  FAILURE_REASONS, CANCELLED_BY, EVENT_TYPES, HEADERS,
  FORBIDDEN_OUTBOUND_KEYS, isTerminal,
} from "../contract";
import { computeSignature } from "../signature";
import { toCanonicalState, type DispatcherSnapshot } from "../status";

let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`  ✓ ${name}`); };
console.log("delivery/contract-parity");

type Fixtures = {
  contractVersion: string;
  contractMajor: number;
  deliveryStates: string[];
  terminalStates: string[];
  failureReasons: string[];
  cancelledBy: string[];
  eventTypes: string[];
  headers: Record<string, string>;
  statusMapping: Array<{ dispatcher: DispatcherSnapshot; canonical: string | null }>;
  signature: { secret: string; timestampMs: number; rawBody: string; expected: string };
  forbiddenOutboundKeys: string[];
};

const fixtures: Fixtures = JSON.parse(
  readFileSync(join(process.cwd(), "lib/delivery/__tests__/contract-fixtures.json"), "utf8")
);

test("[1] contract version and major agree with the fixtures", () => {
  assert.equal(CONTRACT_VERSION, fixtures.contractVersion);
  assert.equal(CONTRACT_MAJOR, fixtures.contractMajor);
});

test("[2] the delivery state set matches EXACTLY, in order", () => {
  assert.deepEqual([...DELIVERY_STATES], fixtures.deliveryStates);
});

test("[3] terminal states match", () => {
  assert.deepEqual([...TERMINAL_STATES], fixtures.terminalStates);
  for (const s of fixtures.terminalStates) {
    assert.equal(isTerminal(s as (typeof DELIVERY_STATES)[number]), true, s);
  }
});

test("[4] failure reasons, cancellation actors and event types match", () => {
  assert.deepEqual([...FAILURE_REASONS], fixtures.failureReasons);
  assert.deepEqual([...CANCELLED_BY], fixtures.cancelledBy);
  assert.deepEqual([...EVENT_TYPES], fixtures.eventTypes);
});

test("[5] header names match — a rename here silently breaks auth", () => {
  assert.deepEqual({ ...HEADERS }, fixtures.headers);
});

test("[6] EVERY status mapping case produces the fixture result", () => {
  for (const c of fixtures.statusMapping) {
    assert.equal(
      toCanonicalState(c.dispatcher), c.canonical,
      `${JSON.stringify(c.dispatcher)} → expected ${c.canonical}`
    );
  }
});

test("[7] the signature scheme produces the fixture digest", () => {
  const { secret, timestampMs, rawBody, expected } = fixtures.signature;
  assert.equal(computeSignature(secret, timestampMs, rawBody), expected,
    "a change to the signing scheme must break both repos at once");
});

test("[8] the forbidden-key list is a superset of the shared one", () => {
  // RestoFlow's list may be stricter (it also blocks `total` and `orderCost`,
  // which are meaningful field names on Dispatcher's own record), but it must
  // never be missing anything the shared contract forbids.
  for (const k of fixtures.forbiddenOutboundKeys) {
    assert.ok(FORBIDDEN_OUTBOUND_KEYS.includes(k), `missing forbidden key: ${k}`);
  }
});

test("[9] every mapped canonical state is a declared state", () => {
  for (const c of fixtures.statusMapping) {
    if (c.canonical === null) continue;
    assert.ok((DELIVERY_STATES as readonly string[]).includes(c.canonical), c.canonical);
  }
});

console.log(`\n${passed} checks passed\n`);
