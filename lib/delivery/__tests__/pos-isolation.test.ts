/**
 * The compatibility promise, made mechanical.
 *
 * The POS offline/idempotency subsystem was expensive to harden and is running
 * on live tills. This test asserts, by scanning the delivery integration's own
 * source, that it cannot disturb it — no write to a POS collection, no use of
 * the POS claim keyspace, no touching of the per-restaurant order counter.
 *
 * A source scan rather than a runtime check on purpose: it fails the moment
 * somebody TYPES the wrong thing, without needing the code path to be reached.
 *
 * Run: npx tsx lib/delivery/__tests__/pos-isolation.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`  ✓ ${name}`); };
console.log("delivery/pos-isolation");

const LIB = join(process.cwd(), "lib", "delivery");
const ROUTES = [
  join(process.cwd(), "app", "api", "webhooks", "dispatcher", "route.ts"),
  join(process.cwd(), "app", "api", "mobile", "v1", "orders", "[orderId]", "tracking", "route.ts"),
];

function sourceFiles(): Array<{ path: string; text: string }> {
  const files: Array<{ path: string; text: string }> = [];
  for (const name of readdirSync(LIB)) {
    if (!name.endsWith(".ts")) continue;
    files.push({ path: `lib/delivery/${name}`, text: readFileSync(join(LIB, name), "utf8") });
  }
  for (const p of ROUTES) {
    files.push({ path: p.replace(process.cwd() + "/", ""), text: readFileSync(p, "utf8") });
  }
  return files;
}

/** Comments legitimately NAME these things while explaining why we avoid them. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const files = sourceFiles().map((f) => ({ ...f, code: stripComments(f.text) }));

test("[1] the integration ships the files it claims to", () => {
  const names = files.map((f) => f.path);
  for (const expected of [
    "lib/delivery/contract.ts", "lib/delivery/signature.ts", "lib/delivery/status.ts",
    "lib/delivery/projection.ts", "lib/delivery/ingest.ts", "lib/delivery/store.ts",
    "lib/delivery/firestore-store.ts", "lib/delivery/tracking.ts",
    "lib/delivery/dispatcher-client.ts", "lib/delivery/config.ts",
  ]) {
    assert.ok(names.includes(expected), `missing ${expected}`);
  }
});

test("[2] NEVER references the POS idempotency claim keyspace", () => {
  for (const f of files) {
    assert.equal(/pos_order_claims/.test(f.code), false, f.path);
    assert.equal(/localOrderId/.test(f.code), false, f.path);
  }
});

test("[3] NEVER touches the per-restaurant cashier order counter", () => {
  for (const f of files) {
    assert.equal(/orderCounter/.test(f.code), false, f.path);
    assert.equal(/\borderNumber\b/.test(f.code), false, f.path);
  }
});

test("[4] NEVER reads or writes the POS catalog", () => {
  for (const f of files) {
    assert.equal(/prepared_items/.test(f.code), false, f.path);
  }
});

test("[5] the ONLY collections written are the two new server-only ones", () => {
  // Every `.collection("x")` in the subsystem, from the adapter.
  const adapter = files.find((f) => f.path.endsWith("firestore-store.ts"))!;
  const referenced = [...adapter.code.matchAll(/collection\((?:"([a-z_]+)"|([A-Z_]+))\)/g)]
    .map((m) => m[1] ?? m[2]);
  assert.deepEqual([...new Set(referenced)].sort(), ["EVENT_CLAIMS", "TIMELINE", "orders"]);
});

test("[6] the only write to `orders` is a field-path update of `delivery`", () => {
  const adapter = files.find((f) => f.path.endsWith("firestore-store.ts"))!;
  // A whole-document set on an order would silently drop every field it omits.
  assert.equal(/tx\.set\(ref/.test(adapter.code), false, "must never set() an order document");
  assert.match(adapter.code, /tx\.update\(ref,\s*\{\s*delivery:/, "expected a scoped delivery update");
});

test("[7] every order write is gated on orderSource === marketplace", () => {
  const adapter = files.find((f) => f.path.endsWith("firestore-store.ts"))!;
  const guards = adapter.code.match(/ORDER_SOURCE_MARKETPLACE/g) ?? [];
  // read guard, write guard, and the two query filters
  assert.ok(guards.length >= 4, `expected the guard on every path, found ${guards.length}`);
});

test("[8] no delivery module imports POS code", () => {
  for (const f of files) {
    assert.equal(/from ["'].*lib\/pos/.test(f.code), false, f.path);
    assert.equal(/from ["']\.\.\/pos/.test(f.code), false, f.path);
    assert.equal(/offline-db/.test(f.code), false, f.path);
  }
});

test("[9] the customer tracking route never accepts an identity from the request body", () => {
  const route = files.find((f) => f.path.includes("tracking/route.ts"))!;
  assert.match(route.code, /verifyIdToken/, "identity must come from a verified token");
  assert.equal(/body\.customerId|searchParams\.get\(["']customerId/.test(route.code), false,
    "a caller-supplied customer id would be an IDOR");
});

test("[10] the webhook route verifies the signature over the RAW body, before parsing", () => {
  const route = files.find((f) => f.path.includes("webhooks/dispatcher"))!;
  // Anchor on the CALL SITE, not the import — the import legitimately precedes
  // everything and would make this assertion pass or fail for the wrong reason.
  const rawIdx = route.code.indexOf("req.text()");
  const verifyIdx = route.code.indexOf("verifySignature({");
  const parseIdx = route.code.indexOf("JSON.parse");
  assert.ok(rawIdx > -1 && verifyIdx > rawIdx, "must read the raw body first");
  assert.ok(parseIdx > verifyIdx, "must not parse before verifying");
  assert.equal(/req\.json\(\)/.test(route.code), false, "req.json() would discard the signed bytes");
});

console.log(`\n${passed} checks passed\n`);
