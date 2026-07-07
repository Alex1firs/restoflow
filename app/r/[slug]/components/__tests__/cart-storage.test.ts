// Unit tests for slug-scoped cart persistence.
// Run: npx tsx "app/r/[slug]/components/__tests__/cart-storage.test.ts"
//
// cart-storage only touches `window` inside function bodies (guarded), so we
// install a minimal fake localStorage/window before exercising it.

import assert from "node:assert/strict";
import { loadCart, saveCart, clearStoredCart, cartStorageKey } from "../cart-storage";

// ── Fake localStorage + window ────────────────────────────────────────────────
// cart-storage only reads `window` inside function bodies, so installing it
// after the (hoisted) import is fine — it exists by the time any fn is called.
class FakeStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  get size() { return this.m.size; }
  keys() { return [...this.m.keys()]; }
}
const storage = new FakeStorage();
(globalThis as unknown as { window: unknown }).window = { localStorage: storage };

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const item = (id: string, q = 1) => ({ id, name: `Item ${id}`, price: 1000, quantity: q });

console.log("cart-storage");

test("empty slug reads back empty", () => {
  assert.deepEqual(loadCart("grills"), []);
});

test("save then load round-trips", () => {
  saveCart("grills", [item("a", 2), item("b")]);
  assert.deepEqual(loadCart("grills"), [item("a", 2), item("b")]);
});

test("carts are isolated per slug (never mix)", () => {
  saveCart("grills", [item("a")]);
  saveCart("tricias", [item("z", 3)]);
  assert.deepEqual(loadCart("grills"), [item("a")]);
  assert.deepEqual(loadCart("tricias"), [item("z", 3)]);
  assert.notEqual(cartStorageKey("grills"), cartStorageKey("tricias"));
});

test("saving an empty cart removes the key", () => {
  saveCart("grills", [item("a")]);
  saveCart("grills", []);
  assert.deepEqual(loadCart("grills"), []);
  assert.equal(storage.getItem(cartStorageKey("grills")), null);
});

test("clearStoredCart removes only that slug", () => {
  saveCart("grills", [item("a")]);
  saveCart("tricias", [item("z")]);
  clearStoredCart("grills");
  assert.deepEqual(loadCart("grills"), []);
  assert.deepEqual(loadCart("tricias"), [item("z")]);
});

test("expired cart (past TTL) is dropped", () => {
  const key = cartStorageKey("grills");
  storage.setItem(key, JSON.stringify({ items: [item("a")], expiresAt: Date.now() - 1000 }));
  assert.deepEqual(loadCart("grills"), []);
  assert.equal(storage.getItem(key), null, "expired key should be evicted");
});

test("future-dated cart (within TTL) survives", () => {
  const key = cartStorageKey("grills");
  storage.setItem(key, JSON.stringify({ items: [item("a")], expiresAt: Date.now() + 60_000 }));
  assert.deepEqual(loadCart("grills"), [item("a")]);
});

test("malformed JSON is dropped without throwing", () => {
  storage.setItem(cartStorageKey("grills"), "{not valid json");
  assert.deepEqual(loadCart("grills"), []);
});

test("missing expiresAt is treated as invalid", () => {
  storage.setItem(cartStorageKey("grills"), JSON.stringify({ items: [item("a")] }));
  assert.deepEqual(loadCart("grills"), []);
});

test("malformed items are filtered out", () => {
  const key = cartStorageKey("grills");
  storage.setItem(key, JSON.stringify({
    items: [item("a"), { id: "b" }, { id: "c", name: "x", price: NaN, quantity: 1 }, { id: "d", name: "y", price: 10, quantity: 0 }],
    expiresAt: Date.now() + 60_000,
  }));
  assert.deepEqual(loadCart("grills"), [item("a")]);
});

test("clear/save/load are all no-ops when window is undefined (SSR safe)", () => {
  const saved = (globalThis as unknown as { window: unknown }).window;
  (globalThis as unknown as { window: unknown }).window = undefined;
  assert.deepEqual(loadCart("grills"), []);
  assert.doesNotThrow(() => saveCart("grills", [item("a")]));
  assert.doesNotThrow(() => clearStoredCart("grills"));
  (globalThis as unknown as { window: unknown }).window = saved;
});

console.log(`\n${passed} checks passed`);
