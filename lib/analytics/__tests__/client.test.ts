// Unit tests for the browser analytics emitter.
// Run: npx tsx lib/analytics/__tests__/client.test.ts
//
// The emitter reads window/navigator/sessionStorage/Blob/fetch at call time, so
// we install fakes before driving it. setTimeout is stubbed to a no-op; flushes
// are driven deterministically via the "pagehide" listener or the MAX_QUEUE edge.

import assert from "node:assert/strict";

type Beacon = { url: string; body: string };
const beacons: Beacon[] = [];
const fetches: { url: string; body: string; keepalive?: boolean }[] = [];
let listeners: Record<string, Array<() => void>> = {};
let store = new Map<string, string>();

class FakeBlob {
  _t: string;
  constructor(parts: string[]) { this._t = parts.join(""); }
}

const setGlobal = (name: string, value: unknown) =>
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });

function installEnv(beaconWorks = true) {
  beacons.length = 0;
  fetches.length = 0;
  listeners = {};
  store = new Map();
  setGlobal("window", { addEventListener: (t: string, cb: () => void) => { (listeners[t] ||= []).push(cb); } });
  setGlobal("document", { visibilityState: "hidden" });
  setGlobal("navigator", beaconWorks
    ? { sendBeacon: (url: string, blob: FakeBlob) => { beacons.push({ url, body: blob._t }); return true; } }
    : {});
  setGlobal("sessionStorage", {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  });
  setGlobal("Blob", FakeBlob);
  setGlobal("fetch", (url: string, opts: { body: string; keepalive?: boolean }) => {
    fetches.push({ url, body: opts.body, keepalive: opts.keepalive });
    return Promise.resolve();
  });
  setGlobal("setTimeout", () => 0);
  setGlobal("clearTimeout", () => {});
}

const firePagehide = () => (listeners["pagehide"] ?? []).forEach((cb) => cb());

// Import after globals exist; use dynamic import via require-like through tsx.
import {
  configureAnalytics, track, trackVisitOnce, trackItemViewOnce, __resetForTest,
} from "../client";

let passed = 0;
function test(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }

console.log("analytics client emitter");

test("disabled → no beacon, no fetch, nothing queued", () => {
  installEnv(); __resetForTest();
  configureAnalytics("grills", false);
  track("add_to_cart", { itemId: "a" });
  trackVisitOnce();
  firePagehide();
  assert.equal(beacons.length, 0);
  assert.equal(fetches.length, 0);
});

test("enabled → flush on pagehide sends one batched beacon", () => {
  installEnv(); __resetForTest();
  configureAnalytics("grills", true);
  track("cart_opened");
  track("checkout_started");
  firePagehide();
  assert.equal(beacons.length, 1);
  const payload = JSON.parse(beacons[0].body);
  assert.equal(payload.slug, "grills");
  assert.deepEqual(payload.events.map((e: { type: string }) => e.type), ["cart_opened", "checkout_started"]);
  assert.equal(beacons[0].url, "/api/storefront/events");
});

test("payload carries ONLY slug + whitelisted event fields (no PII possible)", () => {
  installEnv(); __resetForTest();
  configureAnalytics("grills", true);
  track("add_to_cart", { itemId: "x" });
  track("fulfillment_selected", { fulfillment: "delivery" });
  track("payment_method_selected", { method: "online" });
  firePagehide();
  const payload = JSON.parse(beacons[0].body);
  assert.deepEqual(Object.keys(payload).sort(), ["events", "slug"]);
  for (const ev of payload.events) {
    for (const k of Object.keys(ev)) {
      assert.ok(["type", "itemId", "fulfillment", "method"].includes(k), `unexpected field ${k}`);
    }
  }
});

test("storefront_visit fires once per session (sessionStorage dedupe)", () => {
  installEnv(); __resetForTest();
  configureAnalytics("grills", true);
  trackVisitOnce();
  trackVisitOnce();
  trackVisitOnce();
  firePagehide();
  const visits = JSON.parse(beacons[0].body).events.filter((e: { type: string }) => e.type === "storefront_visit");
  assert.equal(visits.length, 1);
});

test("menu_item_view de-dupes per item per load", () => {
  installEnv(); __resetForTest();
  configureAnalytics("grills", true);
  trackItemViewOnce("a");
  trackItemViewOnce("a");
  trackItemViewOnce("b");
  firePagehide();
  const views = JSON.parse(beacons[0].body).events;
  assert.deepEqual(views.map((e: { itemId: string }) => e.itemId).sort(), ["a", "b"]);
});

test("falls back to keepalive fetch when sendBeacon is unavailable", () => {
  installEnv(false); __resetForTest();
  configureAnalytics("grills", true);
  track("cart_opened");
  firePagehide();
  assert.equal(beacons.length, 0);
  assert.equal(fetches.length, 1);
  assert.equal(fetches[0].keepalive, true);
  assert.equal(JSON.parse(fetches[0].body).events[0].type, "cart_opened");
});

test("MAX_QUEUE forces an immediate flush without waiting", () => {
  installEnv(); __resetForTest();
  configureAnalytics("grills", true);
  for (let i = 0; i < 40; i++) track("menu_item_view", { itemId: `i${i}` });
  // 40th push hits MAX_QUEUE and flushes synchronously — no pagehide needed.
  assert.equal(beacons.length, 1);
  assert.equal(JSON.parse(beacons[0].body).events.length, 40);
});

test("carts/slug scoping — payload slug matches configured slug", () => {
  installEnv(); __resetForTest();
  configureAnalytics("tricias", true);
  track("cart_opened");
  firePagehide();
  assert.equal(JSON.parse(beacons[0].body).slug, "tricias");
});

console.log(`\n${passed} checks passed`);
