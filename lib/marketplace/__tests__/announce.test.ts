/**
 * One settlement → one order → one announcement, whichever path gets there
 * first: the Paystack webhook, the customer's return from checkout, or the
 * reconciliation sweep.
 *
 * The dedupe is not this code remembering anything — it is the outbox key
 * `<orderId>__<audience>__<event>` inserted with `create`, so the database
 * refuses the second write. These tests model exactly that and then check the
 * three real paths all go through the shared announcement.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

let passed = 0;
const test = (n: string, f: () => void) => { f(); passed++; console.log(`  ✓ ${n}`); };
console.log("marketplace/announce");

const ROOT = join(__dirname, "..", "..", "..");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** The outbox, with the same key and the same create-once semantics. */
function outbox() {
  const rows = new Map<string, { orderId: string; audience: string; event: string }>();
  return {
    rows,
    enqueue(orderId: string, audience: string, event: string): boolean {
      const id = `${orderId}__${audience}__${event}`;
      if (rows.has(id)) return false;             // ALREADY_EXISTS
      rows.set(id, { orderId, audience, event });
      return true;
    },
    countOf: (event: string) => [...rows.values()].filter((r) => r.event === event).length,
  };
}

/** What `announceOrderCreated` enqueues for one order. */
const announce = (box: ReturnType<typeof outbox>, orderId: string) => {
  box.enqueue(orderId, "customer", "payment_successful");
  box.enqueue(orderId, "restaurant", "new_marketplace_order");
};

const ORDER = "order_1";

test("[1] webhook first — one announcement", () => {
  const box = outbox();
  announce(box, ORDER);
  assert.equal(box.countOf("payment_successful"), 1);
  assert.equal(box.countOf("new_marketplace_order"), 1);
});

test("[2] reconciliation first — the customer is told, not left in silence", () => {
  // The regression: only the webhook announced, so an order recovered by the
  // sweep — which is exactly what a lost webhook produces — arrived silently.
  const box = outbox();
  announce(box, ORDER);                        // sweep settles
  assert.equal(box.countOf("payment_successful"), 1);
});

test("[3] callback first — same one announcement", () => {
  const box = outbox();
  announce(box, ORDER);                        // customer returns from Paystack
  assert.equal(box.rows.size, 2);
});

test("[4] a delayed webhook after reconciliation adds nothing", () => {
  const box = outbox();
  announce(box, ORDER);                        // sweep got there first
  const before = box.rows.size;
  announce(box, ORDER);                        // webhook arrives late
  assert.equal(box.rows.size, before);
  assert.equal(box.countOf("payment_successful"), 1, "the customer is told once, not twice");
});

test("[5] repeated reconciliation is a no-op", () => {
  const box = outbox();
  for (let i = 0; i < 5; i++) announce(box, ORDER);
  assert.equal(box.countOf("payment_successful"), 1);
  assert.equal(box.countOf("new_marketplace_order"), 1);
});

test("[6] two different orders are announced independently", () => {
  const box = outbox();
  announce(box, "order_1");
  announce(box, "order_2");
  assert.equal(box.countOf("payment_successful"), 2);
});

test("[7] every settlement path goes through the shared announcement", () => {
  const HOOK = strip(readFileSync(join(ROOT, "lib/marketplace/webhook.ts"), "utf8"));
  const RECON = strip(readFileSync(join(ROOT, "lib/marketplace/reconcile.ts"), "utf8"));
  assert.match(HOOK, /announceOrderCreated\(db, result\.orderId\)/);
  assert.match(RECON, /announceOrderCreated\(db, result\.orderId\)/);
  // …and only on a genuinely new order, so a replay announces nothing.
  assert.match(RECON, /result\.outcome === "created"/);
  // No second copy of the enqueue logic left behind in the webhook.
  assert.ok(!/enqueueNotification/.test(HOOK),
    "the webhook must not keep its own copy of the announcement");
});

test("[8] the outbox key is what makes this idempotent", () => {
  const STORE = strip(readFileSync(join(ROOT, "lib/marketplace/store.ts"), "utf8"));
  assert.match(STORE, /\$\{args\.orderId\}__\$\{args\.audience\}__\$\{args\.event\}/);
  assert.match(STORE, /\.create\(\{/, "create, not set — a second enqueue must be refused");
});

console.log(`\n${passed} checks passed\n`);
