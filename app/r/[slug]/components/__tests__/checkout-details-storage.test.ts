// Unit tests for slug-scoped, consent-gated checkout-detail persistence.
// Run: npx tsx "app/r/[slug]/components/__tests__/checkout-details-storage.test.ts"
//
// The module only touches `window` inside function bodies (guarded), so we
// install a minimal fake localStorage/window before exercising it.

import assert from "node:assert/strict";
import {
  loadCheckoutDetails,
  saveCheckoutDetails,
  clearCheckoutDetails,
  hasSavedCheckoutDetails,
  checkoutDetailsKey,
  type SavedCheckoutDetails,
} from "../checkout-details-storage";

// ── Fake localStorage + window ────────────────────────────────────────────────
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

const FULL: SavedCheckoutDetails = {
  fullName: "Ada Obi",
  phone: "08012345678",
  address: "12 Marina Road",
  area: "zone-vi",
  instructions: "Call at the gate",
  fulfillment: "delivery",
  payment: "online",
};

console.log("checkout-details-storage");

// Mirrors: "save only when consent (checkbox) → caller decides; module persists what it's given"
test("saves and round-trips a full detail set (consent granted path)", () => {
  storage.removeItem(checkoutDetailsKey("kapitol"));
  saveCheckoutDetails("kapitol", FULL);
  assert.deepEqual(loadCheckoutDetails("kapitol"), FULL);
});

// "does not save when unchecked" — the component simply never calls save; the
// module-level analogue is that an untouched slug reads back null.
test("a slug that was never saved reads back null", () => {
  assert.equal(loadCheckoutDetails("never-saved"), null);
  assert.equal(hasSavedCheckoutDetails("never-saved"), false);
});

test("restores fields for the SAME restaurant slug", () => {
  saveCheckoutDetails("kapitol", FULL);
  const got = loadCheckoutDetails("kapitol");
  assert.equal(got?.fullName, "Ada Obi");
  assert.equal(got?.phone, "08012345678");
  assert.equal(got?.address, "12 Marina Road");
});

test("does NOT restore across different restaurant slugs (per-restaurant scope)", () => {
  saveCheckoutDetails("kapitol", FULL);
  assert.equal(loadCheckoutDetails("tricias"), null);
  assert.notEqual(checkoutDetailsKey("kapitol"), checkoutDetailsKey("tricias"));
  // saving for tricias must not disturb kapitol
  saveCheckoutDetails("tricias", { fullName: "Bola", phone: "07000000000" });
  assert.equal(loadCheckoutDetails("kapitol")?.fullName, "Ada Obi");
  assert.equal(loadCheckoutDetails("tricias")?.fullName, "Bola");
});

test("clearCheckoutDetails removes only that slug's data", () => {
  saveCheckoutDetails("kapitol", FULL);
  saveCheckoutDetails("tricias", { fullName: "Bola", phone: "07000000000" });
  clearCheckoutDetails("kapitol");
  assert.equal(loadCheckoutDetails("kapitol"), null);
  assert.equal(loadCheckoutDetails("tricias")?.fullName, "Bola");
  assert.equal(storage.getItem(checkoutDetailsKey("kapitol")), null);
});

test("disabled fulfillment preference is ignored safely, rest still restores", () => {
  saveCheckoutDetails("kapitol", FULL); // fulfillment: delivery
  const got = loadCheckoutDetails("kapitol", { allowedFulfillment: ["pickup", "dine_in"] });
  assert.equal(got?.fulfillment, undefined, "delivery no longer offered → dropped");
  assert.equal(got?.fullName, "Ada Obi", "other fields untouched");
  assert.equal(got?.phone, "08012345678");
});

test("disabled payment preference is ignored safely, rest still restores", () => {
  saveCheckoutDetails("kapitol", FULL); // payment: online
  const got = loadCheckoutDetails("kapitol", { allowedPayment: ["cash", "whatsapp"] });
  assert.equal(got?.payment, undefined, "online no longer offered → dropped");
  assert.equal(got?.address, "12 Marina Road", "other fields untouched");
});

test("still-enabled preferences are preserved when allow-lists include them", () => {
  saveCheckoutDetails("kapitol", FULL);
  const got = loadCheckoutDetails("kapitol", {
    allowedFulfillment: ["delivery", "pickup"],
    allowedPayment: ["online", "cash"],
  });
  assert.equal(got?.fulfillment, "delivery");
  assert.equal(got?.payment, "online");
});

test("NEVER stores card / payment / reference / order-id / token fields", () => {
  storage.removeItem(checkoutDetailsKey("kapitol"));
  // Caller accidentally hands over a fat object with sensitive keys.
  const withSecrets = {
    fullName: "Ada Obi",
    phone: "08012345678",
    cardNumber: "4084084084084081",
    cvv: "123",
    paystackReference: "ref_abc123",
    orderId: "ORD-999",
    sessionToken: "eyJhbGciOi...",
  } as unknown as SavedCheckoutDetails;
  saveCheckoutDetails("kapitol", withSecrets);
  const raw = storage.getItem(checkoutDetailsKey("kapitol"))!;
  for (const secret of ["cardNumber", "4084084084084081", "cvv", "paystackReference", "ref_abc123", "orderId", "ORD-999", "sessionToken", "eyJhbGciOi"]) {
    assert.ok(!raw.includes(secret), `stored blob must not contain ${secret}`);
  }
  // The legitimate convenience fields still persisted.
  const got = loadCheckoutDetails("kapitol");
  assert.equal(got?.fullName, "Ada Obi");
  assert.equal(got?.phone, "08012345678");
});

test("invalid fulfillment/payment enum values are dropped on save", () => {
  storage.removeItem(checkoutDetailsKey("kapitol"));
  const badEnums = { fullName: "Ada", fulfillment: "teleport", payment: "bitcoin" } as unknown as SavedCheckoutDetails;
  saveCheckoutDetails("kapitol", badEnums);
  const got = loadCheckoutDetails("kapitol");
  assert.equal(got?.fulfillment, undefined);
  assert.equal(got?.payment, undefined);
  assert.equal(got?.fullName, "Ada");
});

test("empty / whitespace-only fields are not persisted (empty payload removes key)", () => {
  saveCheckoutDetails("kapitol", FULL);
  saveCheckoutDetails("kapitol", { fullName: "   ", phone: "" });
  assert.equal(loadCheckoutDetails("kapitol"), null);
  assert.equal(storage.getItem(checkoutDetailsKey("kapitol")), null);
});

test("oversized strings are truncated (quota safety)", () => {
  storage.removeItem(checkoutDetailsKey("kapitol"));
  saveCheckoutDetails("kapitol", { address: "x".repeat(5000) });
  const got = loadCheckoutDetails("kapitol");
  assert.equal(got?.address?.length, 500);
});

test("expired blob (past TTL) is dropped and evicted", () => {
  const key = checkoutDetailsKey("kapitol");
  storage.setItem(key, JSON.stringify({ details: { fullName: "Ada" }, expiresAt: Date.now() - 1000 }));
  assert.equal(loadCheckoutDetails("kapitol"), null);
  assert.equal(storage.getItem(key), null, "expired key should be evicted");
});

test("malformed JSON is dropped without throwing", () => {
  storage.setItem(checkoutDetailsKey("kapitol"), "{not json");
  assert.deepEqual(loadCheckoutDetails("kapitol"), null);
});

test("missing expiresAt is treated as invalid", () => {
  storage.setItem(checkoutDetailsKey("kapitol"), JSON.stringify({ details: { fullName: "Ada" } }));
  assert.equal(loadCheckoutDetails("kapitol"), null);
});

test("all ops are no-ops when window is undefined (SSR safe)", () => {
  const saved = (globalThis as unknown as { window: unknown }).window;
  (globalThis as unknown as { window: unknown }).window = undefined;
  assert.equal(loadCheckoutDetails("kapitol"), null);
  assert.doesNotThrow(() => saveCheckoutDetails("kapitol", FULL));
  assert.doesNotThrow(() => clearCheckoutDetails("kapitol"));
  assert.equal(hasSavedCheckoutDetails("kapitol"), false);
  (globalThis as unknown as { window: unknown }).window = saved;
});

console.log(`\n${passed} checks passed`);
