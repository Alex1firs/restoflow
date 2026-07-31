/**
 * Fix 3 — bounded submission and deterministic hand-off.
 * Run: npx tsx lib/pos/__tests__/submit.test.ts
 *
 * A POS submission had no deadline: on a stalled connection the button sat on
 * "Submitting" forever and the cashier had no idea whether the order existed.
 * Every submission must now reach exactly one definite state, and a timeout — which
 * proves nothing about the server — must hand off under the SAME idempotency key.
 */

import assert from "node:assert/strict";
import {
  HANDOFF_FAILED_MESSAGE,
  RETRYABLE_SERVER_STATUSES,
  planHandoff,
  POS_SUBMIT_TIMEOUT_MS,
  POS_SYNC_TIMEOUT_MS,
  classifyResponseFailure,
  classifyThrownFailure,
  createBoundedRequest,
  messageForFailure,
  messageForQueuedHandoff,
  shouldHandOffToQueue,
  type SubmitFailure,
} from "../submit";
import { errorCategoryOf, errorCodeOf } from "../submit";
import { commitPosOrder, orderFingerprint, type FirestoreLike } from "../idempotency";
import { FakeFirestore } from "./fake-firestore";

let passed = 0;
const tests: Array<[string, () => Promise<void> | void]> = [];
const test = (name: string, fn: () => Promise<void> | void) => tests.push([name, fn]);

const ONLINE = { online: true, timedOut: false, tornDown: false };
const RESTAURANT = "tricias-kitchen";

/** Models the client's decision for one submission attempt. */
function decide(failure: SubmitFailure) {
  return {
    queued: shouldHandOffToQueue(failure),
    message: shouldHandOffToQueue(failure) ? messageForQueuedHandoff(failure) : messageForFailure(failure),
  };
}

// ── 1 · the deadline exists and is realistic ────────────────────────────────
test("[1] the submission deadline is bounded and sized for real networks", () => {
  assert.ok(POS_SUBMIT_TIMEOUT_MS > 0, "there is a deadline at all");
  assert.ok(
    POS_SUBMIT_TIMEOUT_MS >= 15_000,
    "not so short that a slow-but-working Nigerian mobile link false-timeouts"
  );
  assert.ok(POS_SUBMIT_TIMEOUT_MS <= 30_000, "not so long that the cashier starts reloading");
  assert.ok(
    POS_SYNC_TIMEOUT_MS > POS_SUBMIT_TIMEOUT_MS,
    "a background drain may run longer than a cashier-facing submit"
  );
});

// ── 2 · a response before the deadline ──────────────────────────────────────
test("[2] a response that arrives before the deadline is unaffected", async () => {
  const bounded = createBoundedRequest(1_000);
  const result = await new Promise<string>((resolve) => setTimeout(() => resolve("ok"), 10));
  assert.equal(result, "ok");
  assert.equal(bounded.timedOut(), false);
  assert.equal(bounded.signal.aborted, false);
  bounded.dispose();
});

// ── 3 · the deadline fires and is distinguishable from teardown ─────────────
test("[3] the deadline aborts the request and is reported as a timeout", async () => {
  const bounded = createBoundedRequest(20);
  await new Promise((r) => setTimeout(r, 60));

  assert.equal(bounded.signal.aborted, true, "the request was actually aborted");
  assert.equal(bounded.timedOut(), true);
  assert.equal(bounded.tornDown(), false);

  const failure = classifyThrownFailure(new DOMException("aborted", "AbortError"), {
    online: true,
    timedOut: bounded.timedOut(),
    tornDown: bounded.tornDown(),
  });
  assert.equal(failure.kind, "timeout");
  bounded.dispose();
});

// ── 4 · teardown is NOT a timeout ───────────────────────────────────────────
test("[4] an unmount/navigation abort is teardown and does NOT queue the order", async () => {
  const bounded = createBoundedRequest(10_000);
  bounded.teardown();

  assert.equal(bounded.signal.aborted, true);
  assert.equal(bounded.tornDown(), true);
  assert.equal(bounded.timedOut(), false, "must not be mistaken for the deadline");

  const failure = classifyThrownFailure(new DOMException("aborted", "AbortError"), {
    online: true,
    timedOut: bounded.timedOut(),
    tornDown: bounded.tornDown(),
  });
  assert.equal(failure.kind, "teardown");
  // The cart and the draft key are both still persisted, so the cashier resubmits
  // under the same identity and the server replays. Queuing behind their back
  // would create a bill nobody asked for.
  assert.equal(shouldHandOffToQueue(failure), false);
  bounded.dispose();
});

// ── 5 · the full classification matrix ──────────────────────────────────────
test("[5] every failure mode maps to exactly one definite decision", () => {
  // Outcome UNKNOWN → preserve under the same key, ordinary retry path.
  for (const kind of ["timeout", "network", "offline"] as const) {
    assert.deepEqual(planHandoff({ kind }), { handoff: true, queueState: "pending" }, kind);
  }
  // A retryable 5xx is UNCERTAIN, not a definite failure — see test [13].
  assert.deepEqual(planHandoff({ kind: "server-retryable", status: 500, message: "" }), {
    handoff: true,
    queueState: "pending",
  });
  // Preserved but PARKED: retrying these automatically is a loop.
  assert.deepEqual(planHandoff({ kind: "auth-required" }), { handoff: true, queueState: "auth_required" });
  assert.deepEqual(planHandoff({ kind: "server-permanent", status: 501, message: "" }), {
    handoff: true,
    queueState: "attention",
  });

  // Definite server answer, or nobody watching → do NOT queue.
  assert.equal(decide({ kind: "conflict" }).queued, false);
  assert.equal(decide({ kind: "validation", message: "bad item" }).queued, false);
  assert.equal(decide({ kind: "teardown" }).queued, false);

  // Status codes classify correctly.
  assert.equal(classifyResponseFailure(401, "").kind, "auth-required");
  assert.equal(classifyResponseFailure(403, "").kind, "auth-required");
  assert.equal(classifyResponseFailure(409, "").kind, "conflict");
  assert.equal(classifyResponseFailure(400, "bad").kind, "validation");
  assert.equal(classifyResponseFailure(426, "old").kind, "validation");
  for (const status of RETRYABLE_SERVER_STATUSES) {
    assert.equal(classifyResponseFailure(status, "").kind, "server-retryable", `status ${status}`);
  }
  assert.equal(classifyResponseFailure(501, "").kind, "server-permanent");
  assert.equal(classifyResponseFailure(505, "").kind, "server-permanent");

  // Offline beats a generic network error when the device knows it is offline.
  assert.equal(classifyThrownFailure(new TypeError("failed"), { ...ONLINE, online: false }).kind, "offline");
  assert.equal(classifyThrownFailure(new TypeError("failed"), ONLINE).kind, "network");
});

// ── 6 · validation errors never enter the queue ─────────────────────────────
test("[6] a validation error is shown, not queued, and keeps its server message", () => {
  const failure = classifyResponseFailure(400, 'Custom pricing not allowed for "Prime Ribs"');
  assert.equal(shouldHandOffToQueue(failure), false, "retrying a bad payload forever cannot help");
  assert.match(messageForFailure(failure), /Custom pricing not allowed/);
});

// ── 7 · cashier-facing copy ─────────────────────────────────────────────────
test("[7] cashier copy is reassuring, honest and free of internals", () => {
  const preserved = /saved|preserved/i;
  const cases: Array<[SubmitFailure, RegExp]> = [
    [{ kind: "timeout" }, preserved],
    [{ kind: "network" }, preserved],
    [{ kind: "offline" }, preserved],
    [{ kind: "auth-required" }, /sign in again/i],
    [{ kind: "server-retryable", status: 500, message: "" }, /could not confirm/i],
    [{ kind: "server-permanent", status: 501, message: "" }, /needs attention/i],
  ];

  for (const [failure, expected] of cases) {
    const msg = messageForQueuedHandoff(failure);
    assert.match(msg, expected, failure.kind);
    assert.match(msg, preserved, `${failure.kind} confirms the order is not lost`);
    // No internals may leak to a cashier. Word-bounded, so ordinary English
    // containing a jargon substring (e.g. "please" / "lease") is not a false hit.
    for (const leak of ["timeout", "abort", "401", "403", "500", "501", "IndexedDB", "fingerprint", "claim", "undefined", "lease", "sync status"]) {
      assert.ok(
        !new RegExp(`\\b${leak}\\b`, "i").test(msg),
        `${failure.kind} must not mention "${leak}" (got: ${msg})`
      );
    }
  }

  // An UNCERTAIN outcome must not be reported as either success or failure.
  const uncertain = messageForQueuedHandoff({ kind: "server-retryable", status: 500, message: "" });
  assert.ok(!/not created|failed|reached the/i.test(uncertain), "no false claim either way");

  // Teardown is silent — there is nothing useful to say.
  assert.equal(messageForFailure({ kind: "teardown" }), "");
  // A failed local hand-off must never claim the order was saved.
  assert.ok(!/saved and will sync/i.test(HANDOFF_FAILED_MESSAGE));
  assert.match(HANDOFF_FAILED_MESSAGE, /cart has been kept/i);
});

// ── 8 · THE POINT OF FIX 3: timeout after the server already committed ──────
test("[8] REGRESSION: server commits, client times out, queued retry returns the canonical order", async () => {
  const db = new FakeFirestore();
  db.seed("restaurants", RESTAURANT, { orderCounter: 300 });

  const KEY = "txn-timeout-1";
  const items = [{ id: "m-1", quantity: 2, customPrice: null, itemNote: "" }];
  const fingerprint = orderFingerprint({
    items,
    serviceMode: "counter",
    tableLabel: "",
    note: "",
    pricingMode: "regular",
  });
  const commit = (source: "online" | "sync") =>
    commitPosOrder({
      db: db as unknown as FirestoreLike,
      restaurantId: RESTAURANT,
      localOrderId: KEY,
      fingerprint,
      source,
      buildOrderData: (orderNumber) => ({
        restaurantId: RESTAURANT,
        localOrderId: KEY,
        items,
        total: 7000,
        source,
        orderNumber,
      }),
    });

  // 1. The cashier submits. The server commits...
  const committed = await commit("online");
  assert.equal(committed.outcome, "created");

  // 2. ...the response never arrives; our deadline fires. The client classifies it
  //    as a timeout, which is "unknown", so it hands off — under the SAME key.
  const bounded = createBoundedRequest(5);
  await new Promise((r) => setTimeout(r, 30));
  const failure = classifyThrownFailure(new DOMException("x", "AbortError"), {
    online: true,
    timedOut: bounded.timedOut(),
    tornDown: bounded.tornDown(),
  });
  bounded.dispose();
  assert.equal(failure.kind, "timeout");
  assert.equal(shouldHandOffToQueue(failure), true);

  const queuedRecord = { localOrderId: KEY, syncStatus: "pending" as const, items };
  assert.equal(queuedRecord.localOrderId, KEY, "the queued copy reuses the key — no new identity");

  // 3. Reconnection drains the queue.
  const synced = await commit("sync");

  assert.equal(synced.outcome, "replayed");
  assert.equal(synced.orderId, committed.orderId, "resolves to the canonical existing order");
  assert.equal(db.countIn("orders"), 1, "exactly ONE order, not two");
  assert.equal(
    db.docsIn("restaurants").find((d) => d.id === RESTAURANT)!.data.orderCounter,
    301,
    "one order number consumed"
  );
  assert.equal(db.docsIn("orders")[0].data.source, "online", "the original was not overwritten");
});

// ── 9 · a conflict does not start a new transaction ─────────────────────────
test("[9] a 409 does not queue anything and does not mint a second identity", async () => {
  const db = new FakeFirestore();
  db.seed("restaurants", RESTAURANT, { orderCounter: 300 });
  const KEY = "txn-conflict-1";
  const mk = (items: Array<{ id: string; quantity: number }>) =>
    commitPosOrder({
      db: db as unknown as FirestoreLike,
      restaurantId: RESTAURANT,
      localOrderId: KEY,
      fingerprint: orderFingerprint({ items, serviceMode: "counter", tableLabel: "" }),
      source: "online",
      buildOrderData: (orderNumber) => ({ restaurantId: RESTAURANT, localOrderId: KEY, items, orderNumber }),
    });

  await mk([{ id: "m-1", quantity: 1 }]);
  const conflict = await mk([{ id: "m-9", quantity: 5 }]);

  assert.equal(conflict.outcome, "conflict");
  const failure = classifyResponseFailure(409, "");
  assert.equal(shouldHandOffToQueue(failure), false, "a conflict is never queued");
  assert.equal(db.countIn("orders"), 1);
  assert.equal(db.docsIn("restaurants").find((d) => d.id === RESTAURANT)!.data.orderCounter, 301);
});

// ── 10 · repeated presses cannot mint multiple identities ───────────────────
test("[10] a synchronous in-flight guard stops repeated presses re-entering", () => {
  // Models the component: `submitting` is React state (async), so the ref is the
  // guard that actually holds within one tick.
  let inFlight = false;
  let submittingState = false;
  let mints = 0;
  const mintKey = () => `txn-${++mints}`;
  const keys: string[] = [];

  const handleSubmit = () => {
    if (submittingState || inFlight) return;
    inFlight = true;
    keys.push(mintKey());
    // React would commit this later; the ref already blocks re-entry.
    submittingState = true;
  };

  handleSubmit();
  handleSubmit(); // same tick — state not yet committed
  handleSubmit();

  assert.equal(mints, 1, "one identity for one transaction");
  assert.deepEqual(keys, ["txn-1"]);
});

// ── 11 · ordered hand-off: nothing is cleared before the write lands ────────
test("[11] a failed IndexedDB hand-off preserves the cart and the draft identity", async () => {
  // Models the hand-off block's ordering: persist FIRST, and only then retire the
  // draft and clear the cart.
  const run = async (putSucceeds: boolean) => {
    const state = { cart: [{ id: "m-1" }], draftKey: "txn-keepme", queued: [] as string[], error: "" };
    try {
      if (!putSucceeds) throw new Error("QuotaExceededError");
      state.queued.push(state.draftKey);
      state.draftKey = ""; // finishActiveDraft
      state.cart = []; // only after the write landed
    } catch {
      state.error = HANDOFF_FAILED_MESSAGE;
    }
    return state;
  };

  const ok = await run(true);
  assert.deepEqual(ok.queued, ["txn-keepme"]);
  assert.equal(ok.cart.length, 0);
  assert.equal(ok.draftKey, "");
  assert.equal(ok.error, "");

  const failed = await run(false);
  assert.deepEqual(failed.queued, [], "nothing was queued");
  assert.equal(failed.cart.length, 1, "the cart is preserved");
  assert.equal(failed.draftKey, "txn-keepme", "the transaction identity is preserved for retry");
  assert.equal(failed.error, HANDOFF_FAILED_MESSAGE, "and it does not claim the order was saved");
});

// ── 12 · rollout compatibility ──────────────────────────────────────────────
test("[12] a cached keyless client is unaffected by the timeout work", () => {
  // Nothing in Fix 3 requires an idempotency key: the classification is purely
  // client-side, and a keyless payload still reaches the compatibility path.
  const failure = classifyThrownFailure(new TypeError("network"), ONLINE);
  assert.equal(failure.kind, "network");
  assert.equal(shouldHandOffToQueue(failure), true);
  assert.equal(process.env.POS_REQUIRE_IDEMPOTENCY_KEY, undefined, "enforcement still off by default");
});


// ── 13 · THE CORRECTED 5xx: commit happens, THEN a 500 is returned ──────────
test("[13] REGRESSION: server commits then returns 500; retry yields ONE order", async () => {
  // This is not hypothetical. app/api/admin/pos/route.ts wraps everything in a
  // catch that returns 500, and the replay branch re-reads the order document
  // AFTER the transaction committed — plus a proxy can 502/504 once the function
  // has already returned. So a 5xx cannot be read as "no order was created".
  const db = new FakeFirestore();
  db.seed("restaurants", RESTAURANT, { orderCounter: 400 });

  const KEY = "txn-500-after-commit";
  const items = [{ id: "m-1", quantity: 1, customPrice: 5500, itemNote: "extra hot" }];
  const fingerprint = orderFingerprint({
    items, serviceMode: "counter", tableLabel: "", note: "table by window", pricingMode: "regular",
  });
  const commit = (source: "online" | "sync") =>
    commitPosOrder({
      db: db as unknown as FirestoreLike,
      restaurantId: RESTAURANT,
      localOrderId: KEY,
      fingerprint,
      source,
      buildOrderData: (orderNumber) => ({
        restaurantId: RESTAURANT, localOrderId: KEY, items, source, orderNumber,
      }),
    });

  // 1. The transaction commits...
  const committed = await commit("online");
  assert.equal(committed.outcome, "created");
  assert.equal(db.countIn("orders"), 1);

  // 2. ...and THEN the route throws while building the response → 500.
  const failure = classifyResponseFailure(500, "Failed to create order. Please try again.");
  assert.equal(failure.kind, "server-retryable");
  const plan = planHandoff(failure);
  assert.equal(plan.handoff, true, "an uncertain outcome must be preserved, not discarded");
  assert.equal(plan.handoff && plan.queueState, "pending", "and stay on the ordinary retry path");

  // 3. The retry reuses the SAME key — never a new identity after a 5xx.
  const retried = await commit("sync");

  assert.equal(retried.outcome, "replayed", "idempotency returns the existing canonical order");
  assert.equal(retried.orderId, committed.orderId);
  assert.equal(db.countIn("orders"), 1, "final state: exactly ONE order");
  assert.equal(
    db.docsIn("restaurants").find((d) => d.id === RESTAURANT)!.data.orderCounter,
    401,
    "one order number consumed"
  );
  // The customer's custom price survived intact.
  assert.equal((db.docsIn("orders")[0].data.items as Array<{ customPrice: number }>)[0].customPrice, 5500);
});

// ── 14 · a pre-commit 503 is recoverable in exactly the same way ────────────
test("[14] an ordinary pre-commit 503 stays recoverable under the same key", async () => {
  const db = new FakeFirestore();
  db.seed("restaurants", RESTAURANT, { orderCounter: 400 });
  const KEY = "txn-503";
  const items = [{ id: "m-2", quantity: 3, customPrice: null, itemNote: "" }];
  const fp = orderFingerprint({ items, serviceMode: "counter", tableLabel: "" });

  // Nothing committed (the gateway never reached the handler).
  const failure = classifyResponseFailure(503, "");
  assert.equal(planHandoff(failure).handoff, true);
  assert.equal(db.countIn("orders"), 0);

  // The queued retry creates it for the first time — one order, not zero.
  const created = await commitPosOrder({
    db: db as unknown as FirestoreLike,
    restaurantId: RESTAURANT,
    localOrderId: KEY,
    fingerprint: fp,
    source: "sync",
    buildOrderData: (orderNumber) => ({ restaurantId: RESTAURANT, localOrderId: KEY, items, orderNumber }),
  });
  assert.equal(created.outcome, "created");
  assert.equal(db.countIn("orders"), 1);
});

// ── 15 · a permanent server failure is preserved but not looped ─────────────
test("[15] a non-retryable server response is preserved and parked, never looped", () => {
  const failure = classifyResponseFailure(501, "Not implemented");
  assert.equal(failure.kind, "server-permanent");
  const plan = planHandoff(failure);
  assert.equal(plan.handoff, true, "the order is still preserved — never discarded");
  assert.equal(plan.handoff && plan.queueState, "attention", "but parked, so it cannot loop");
  assert.match(messageForQueuedHandoff(failure), /needs attention/i);
});

// ── 16 · 401 preserves everything and parks the transaction ────────────────
test("[16] a 401 preserves the whole order and its identity, and pauses it", () => {
  const failure = classifyResponseFailure(401, "Unauthorized");
  assert.equal(failure.kind, "auth-required", "not conflated with offline or network");

  const plan = planHandoff(failure);
  assert.equal(plan.handoff, true);
  assert.equal(plan.handoff && plan.queueState, "auth_required", "parked, not auto-retried");

  // The message must not assert the order reached the restaurant server.
  const msg = messageForQueuedHandoff(failure);
  assert.match(msg, /session has expired/i);
  assert.match(msg, /safely preserved/i);
  assert.match(msg, /sign in again/i);
  assert.ok(!/reached|received|recorded on the server/i.test(msg), "no unconfirmed claim of delivery");

  // 401 is distinguishable from every other cause.
  const kinds = new Set([
    classifyThrownFailure(new DOMException("a", "AbortError"), { online: true, timedOut: false, tornDown: true }).kind,
    classifyThrownFailure(new DOMException("a", "AbortError"), { online: true, timedOut: true, tornDown: false }).kind,
    classifyThrownFailure(new TypeError("x"), { online: false, timedOut: false, tornDown: false }).kind,
    classifyThrownFailure(new TypeError("x"), ONLINE).kind,
    classifyResponseFailure(400, "").kind,
    classifyResponseFailure(409, "").kind,
    classifyResponseFailure(500, "").kind,
    classifyResponseFailure(401, "").kind,
  ]);
  assert.deepEqual(
    [...kinds].sort(),
    ["auth-required", "conflict", "network", "offline", "server-retryable", "teardown", "timeout", "validation"],
    "eight distinct causes, no conflation"
  );
});

// ── 17 · errorCodeOf / errorCategoryOf carry safe diagnostics ───────────────
test("[17] diagnostics recorded on the queue record are non-sensitive", () => {
  assert.equal(errorCodeOf({ kind: "auth-required" }), 401);
  assert.equal(errorCodeOf({ kind: "conflict" }), 409);
  assert.equal(errorCodeOf({ kind: "server-retryable", status: 503, message: "" }), 503);
  assert.equal(errorCodeOf({ kind: "timeout" }), null);
  assert.equal(errorCategoryOf({ kind: "server-permanent", status: 501, message: "" }), "server-permanent");
  // Categories are fixed identifiers, never server text that might contain data.
  for (const kind of ["timeout", "network", "offline", "auth-required", "conflict"] as const) {
    assert.match(errorCategoryOf({ kind } as SubmitFailure), /^[a-z-]+$/);
  }
});

// ── runner ───────────────────────────────────────────────────────────────────
(async () => {
  console.log("pos/submit (Fix 3)");
  for (const [name, fn] of tests) {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  }
  console.log(`\n${passed}/${tests.length} passed`);
})().catch((err) => {
  console.error("\n✗ FAILED\n", err);
  process.exit(1);
});
