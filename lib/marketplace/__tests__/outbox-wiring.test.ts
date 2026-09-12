/**
 * The wiring tests for WS6.1.
 *
 * The drain logic already had its own suite. What was missing — and what let
 * every message this system ever produced sit unsent — was that nothing called
 * it and nothing implemented the two send ports. These assertions are about the
 * connections, not the algorithm: a queue with a perfect drain and no caller is
 * indistinguishable from no queue at all.
 *
 *   npx tsx lib/marketplace/__tests__/outbox-wiring.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..", "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const SWEEPS = read("lib/marketplace/sweeps.ts");
const ADAPTERS = read("lib/marketplace/outbox-adapters.ts");
const CRON = read("app/api/cron/outbox/route.ts");
const VERCEL = JSON.parse(read("vercel.json")) as { crons?: { path: string; schedule: string }[] };
const NOTIFS = read("lib/customer-notifications.ts");
const STORE = read("lib/marketplace/store.ts");

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log("  ✓ " + name);
  } catch (e) {
    console.error("  ✗ " + name);
    console.error("    " + (e as Error).message);
    process.exitCode = 1;
  }
}

console.log("\noutbox wiring\n");

test("[1] something actually calls the drain", () => {
  assert.match(SWEEPS, /drainOutbox\(/, "the sweeps must drain the outbox");
  assert.match(CRON, /drainOutbox\(/, "the dedicated cron must drain the outbox");
});

test("[2] notifications go out immediately, not on the next sweep", () => {
  // The hosting plan allows only daily crons, so the cron alone would tell a
  // customer tomorrow morning that their order was received. Immediacy comes
  // from draining inline right after the messages are queued; the cron is the
  // backstop that catches retries and anything the inline pass missed.
  // Every place that enqueues must also nudge, or that event waits a day.
  for (const site of [
    "lib/marketplace/announce.ts",
    "app/api/admin/marketplace/orders/[orderId]/route.ts",
    "app/api/webhooks/dispatcher/route.ts",
  ]) {
    assert.match(read(site), /await deliverQueuedNow\(db, orderId\)/,
      `${site} enqueues without sending — that event would wait for the cron`);
  }
  assert.ok((VERCEL.crons ?? []).some((c) => c.path === "/api/cron/outbox"),
    "no backstop cron declared for retries");
});

test("[2b] the inline drain can never break the payment path", () => {
  const HELPER = read("lib/marketplace/deliver-now.ts");
  const fn = HELPER.slice(HELPER.indexOf("export async function deliverQueuedNow"));
  assert.match(fn.slice(0, fn.indexOf("\n}")), /catch \(err\)/, "must swallow its own failures");
});

test("[3] the drain endpoint is not a public send button", () => {
  assert.match(CRON, /CRON_SECRET/);
  assert.match(CRON, /401/);
});

test("[4] both send ports are implemented", () => {
  assert.match(ADAPTERS, /export async function sendCustomerPush/);
  assert.match(ADAPTERS, /export async function sendRestaurantAlert/);
  assert.match(SWEEPS, /sendCustomerPush/);
  assert.match(SWEEPS, /sendRestaurantAlert/);
});

test("[5] the store implements every port the drain needs", () => {
  for (const m of [
    "claimDueNotifications", "markSending", "markNotificationSent",
    "scheduleNotificationRetry", "markNotificationDead", "invalidateDeviceToken",
  ]) {
    assert.match(STORE, new RegExp(`async ${m}\\(`), `store is missing ${m}`);
  }
});

test("[6] claiming is compare-and-set, so overlapping runs cannot double-send", () => {
  const fn = STORE.slice(STORE.indexOf("async markSending("));
  assert.match(fn, /runTransaction/, "markSending must be transactional");
  assert.match(fn, /state !== "queued" && state !== "failed"/, "must refuse an entry another worker took");
});

test("[7] no second notification stack was invented", () => {
  // Termii and Telegram are what RestoFlow already uses. A new provider here
  // would mean two places to change a message and two things to be broken.
  assert.match(ADAPTERS, /termii/i, "customer channel should reuse the existing SMS provider");
  assert.match(ADAPTERS, /sendTelegramAlert/, "restaurant channel should reuse the existing Telegram alert");
  for (const forbidden of ["firebase-admin/messaging", "expo-server-sdk", "onesignal", "sendgrid"]) {
    assert.ok(!ADAPTERS.includes(forbidden), `introduced a parallel provider: ${forbidden}`);
  }
});

test("[8] a missing credential dead-letters rather than retrying forever", () => {
  const fn = ADAPTERS.slice(ADAPTERS.indexOf("async function sendTermiiSMS"));
  assert.match(fn, /TERMII_API_KEY is not set/);
  const idx = fn.indexOf("TERMII_API_KEY is not set");
  assert.match(fn.slice(idx - 120, idx), /permanent/, "a missing key must not be a transient failure");
});

test("[9] the tracking link carries the token the page demands", () => {
  assert.match(NOTIFS, /\?t=\$\{encodeURIComponent\(token\)\}/, "storefront link must include ?t=");
  assert.match(ADAPTERS, /\?t=\$\{encodeURIComponent\(token\)\}/, "marketplace link must include ?t=");
});

test("[10] a link is dropped rather than sent broken", () => {
  assert.match(NOTIFS, /const trackLine = trackingLink \?/, "must omit the line when there is no token");
});

test("[11] the customer is never told about Dispatcher", () => {
  // Copy comes from notifications.ts, which already enforces this. The adapters
  // must not write customer-facing words of their own.
  const body = ADAPTERS.slice(ADAPTERS.indexOf("*/") + 2);
  assert.ok(!/dispatcher/i.test(body),
    "adapters must not mention Dispatcher outside the header comment");
});

test("[12] an empty SMS balance retries rather than binning the message", () => {
  const fn = ADAPTERS.slice(ADAPTERS.indexOf("function outcomeForHttp"));
  const head = fn.slice(0, fn.indexOf("\n}"));
  assert.match(head, /status === 402 \|\| status === 429/, "402/429 must be transient");
  const idx = head.indexOf("402 || status === 429");
  assert.match(head.slice(idx, idx + 200), /transient/, "a top-up-able failure must not dead-letter");
});

console.log(`\n${passed} checks passed\n`);
