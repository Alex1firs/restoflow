/**
 * Fix 5 (stranded-record recovery) and Fix 4 (cross-tab ownership).
 * Run: npx tsx lib/pos/__tests__/sync-lease.test.ts
 *
 * Two bugs, one mechanism:
 *
 *   Fix 5 — a record flipped to `syncing` whose owner died was invisible to every
 *   queue filter and never retried. A silently LOST order.
 *
 *   Fix 4 — the old guard was a per-component React ref, so two tabs (or a PWA
 *   plus a browser tab) synchronised the same records concurrently.
 *
 * `FakeQueueStore` models the one property the design depends on: a
 * read-modify-write inside a single IndexedDB transaction is atomic, and
 * IndexedDB serialises transactions per origin, so no other tab can interleave.
 * `Tab` instances share one store, exactly like two real tabs share one database.
 */

import assert from "node:assert/strict";
import {
  ATTENTION_STATUSES,
  LEASE_DURATION_MS,
  MAX_AUTO_ATTEMPTS,
  MAX_RETRY_DELAY_MS,
  RETRY_SCHEDULE_MS,
  attentionRecords,
  authRequiredRecords,
  computeNextRetryAt,
  isWaitingForRetry,
  manualRetryTransition,
  needsAttention,
  resumeAuthTransition,
  claimTransition,
  claimableRecords,
  completeTransition,
  failTransition,
  hasLiveLease,
  isStranded,
  outstandingRecords,
  recoverTransition,
  recoveryReasonFor,
  type QueueRecordLike,
} from "../sync-lease";

let passed = 0;
const tests: Array<[string, () => Promise<void> | void]> = [];
const test = (name: string, fn: () => Promise<void> | void) => tests.push([name, fn]);

const T0 = 1_800_000_000_000;

type Rec = QueueRecordLike & Record<string, unknown>;

/**
 * Stands in for the `ordersQueue` object store. `updateAtomic` mirrors
 * `dbUpdateAtomic`: the read and the write happen with no interleaving, which is
 * what IndexedDB guarantees and what makes the claim authoritative.
 */
class FakeQueueStore {
  private rows = new Map<string, Rec>();
  /** Serialises transactions, as IndexedDB does per origin. */
  private chain: Promise<unknown> = Promise.resolve();

  seed(record: Rec): this {
    this.rows.set(record.localOrderId, { ...record });
    return this;
  }
  all(): Rec[] {
    return [...this.rows.values()].map((r) => ({ ...r }));
  }
  get(key: string): Rec | undefined {
    const r = this.rows.get(key);
    return r ? { ...r } : undefined;
  }
  delete(key: string): void {
    this.rows.delete(key);
  }
  count(): number {
    return this.rows.size;
  }

  updateAtomic(key: string, updater: (current: Rec | undefined) => Rec | null): Promise<Rec | null> {
    const run = async (): Promise<Rec | null> => {
      // Yield BEFORE reading so concurrent callers genuinely interleave at the
      // scheduling level; the serialised chain is what still makes it atomic.
      await Promise.resolve();
      const current = this.rows.get(key);
      const next = updater(current ? { ...current } : undefined);
      if (next === null) return null;
      this.rows.set(key, { ...next });
      return { ...next };
    };
    const result = this.chain.then(run, run);
    this.chain = result.catch(() => {});
    return result;
  }
}

/** One browser context (tab or installed PWA window). */
class Tab {
  readonly sent: string[] = [];
  constructor(readonly ownerId: string, readonly store: FakeQueueStore) {}

  /** What triggerBackgroundSync does: recover, then claim, then send. */
  async runSync(now: number, opts: { fail?: boolean; attemptId?: string } = {}): Promise<string[]> {
    await this.recover(now);
    const claimed: string[] = [];
    for (const candidate of claimableRecords(this.store.all(), now)) {
      const got = await this.store.updateAtomic(candidate.localOrderId, (current) =>
        current
          ? (claimTransition(current, {
              ownerId: this.ownerId,
              attemptId: opts.attemptId ?? `att-${this.ownerId}`,
              now,
            }) as Rec | null)
          : null
      );
      if (!got) continue; // another context holds a live lease
      claimed.push(candidate.localOrderId);
      this.sent.push(candidate.localOrderId);

      if (opts.fail) {
        await this.store.updateAtomic(candidate.localOrderId, (current) =>
          current ? (failTransition(current, { error: "network", now, retryable: true }) as Rec) : null
        );
      } else {
        await this.store.updateAtomic(candidate.localOrderId, (current) =>
          current
            ? (completeTransition(current, { orderId: `ORD_${candidate.localOrderId}`, orderNumber: 501, now }) as Rec)
            : null
        );
        this.store.delete(candidate.localOrderId);
      }
    }
    return claimed;
  }

  /** Claim only, leaving the request "in flight" — models a tab mid-sync. */
  async claimOnly(key: string, now: number): Promise<Rec | null> {
    return this.store.updateAtomic(key, (current) =>
      current
        ? (claimTransition(current, { ownerId: this.ownerId, attemptId: `att-${this.ownerId}`, now }) as Rec | null)
        : null
    );
  }

  async recover(now: number): Promise<number> {
    let n = 0;
    for (const r of this.store.all()) {
      if (!isStranded(r, now)) continue;
      const written = await this.store.updateAtomic(r.localOrderId, (current) =>
        current && isStranded(current, now) ? (recoverTransition(current, now) as Rec | null) : null
      );
      if (written) n++;
    }
    return n;
  }
}

const pending = (key: string, extra: Partial<Rec> = {}): Rec => ({
  localOrderId: key,
  syncStatus: "pending",
  attemptCount: 0,
  paymentStatus: "unpaid",
  items: [{ id: "m-1", quantity: 2, customPrice: 4500, itemNote: "no pepper" }],
  note: "for pickup",
  total: 9000,
  ...extra,
});

// ── FIX 5 ────────────────────────────────────────────────────────────────────

test("[L1] an actively leased record is not stolen by another tab", async () => {
  const store = new FakeQueueStore().seed(pending("txn-a"));
  const tabA = new Tab("ctx-A", store);
  const tabB = new Tab("ctx-B", store);

  await tabA.claimOnly("txn-a", T0); // A is mid-request
  const claimedByB = await tabB.runSync(T0 + 1_000);

  assert.deepEqual(claimedByB, [], "B must not touch a live lease");
  assert.equal(store.get("txn-a")!.syncOwnerId, "ctx-A");
  assert.equal(hasLiveLease(store.get("txn-a")!, T0 + 1_000), true);
});

test("[L2] an expired lease returns to a retryable state", async () => {
  const store = new FakeQueueStore().seed(pending("txn-b"));
  const tabA = new Tab("ctx-A", store);
  await tabA.claimOnly("txn-b", T0);

  const duringLease = store.get("txn-b")!;
  assert.equal(isStranded(duringLease, T0 + LEASE_DURATION_MS - 1), false);

  const after = T0 + LEASE_DURATION_MS + 1;
  assert.equal(isStranded(store.get("txn-b")!, after), true);

  const tabB = new Tab("ctx-B", store);
  assert.equal(await tabB.recover(after), 1);
  const recovered = store.get("txn-b")!;
  assert.equal(recovered.syncStatus, "failed", "retryable again, never deleted");
  assert.equal(recovered.syncOwnerId, undefined, "lease released");
  assert.equal(recovered.leaseExpiresAt, undefined);
});

test("[L3] a LEGACY syncing record with no lease metadata is recovered safely", async () => {
  // Written by the pre-fix client: `syncing`, no owner, no lease, no timestamps.
  const legacy: Rec = { localOrderId: "offline-legacy-9", syncStatus: "syncing", items: [{ id: "m-1", quantity: 1 }] };
  const store = new FakeQueueStore().seed(legacy);

  assert.equal(isStranded(legacy, T0), true, "no credible owner → recoverable");
  assert.equal(recoveryReasonFor(legacy), "legacy-no-lease");

  const tab = new Tab("ctx-A", store);
  assert.equal(await tab.recover(T0), 1);
  assert.equal(store.count(), 1, "preserved, not deleted");
  assert.equal(store.get("offline-legacy-9")!.syncStatus, "failed");
  assert.equal(store.get("offline-legacy-9")!.localOrderId, "offline-legacy-9", "identity untouched");
});

test("[L4] browser closes mid-sync: the next session retries the same record", async () => {
  const store = new FakeQueueStore().seed(pending("txn-c"));
  const dying = new Tab("ctx-dead", store);
  await dying.claimOnly("txn-c", T0);
  // The browser is gone. Nothing released the lease.

  // Next session, before expiry: the record is respected, not double-sent.
  const next = new Tab("ctx-new", store);
  assert.deepEqual(await next.runSync(T0 + 1_000), []);

  // After expiry the new session recovers and sends it exactly once.
  const sent = await next.runSync(T0 + LEASE_DURATION_MS + 5_000);
  assert.deepEqual(sent, ["txn-c"]);
  assert.equal(store.count(), 0, "synced and removed");
});

test("[L5] power loss after status became syncing does not lose the order", async () => {
  const store = new FakeQueueStore().seed(pending("txn-power"));
  const tab = new Tab("ctx-A", store);
  await tab.claimOnly("txn-power", T0);

  // Power cut. Under the OLD filters (pending|failed only) this record was
  // invisible in both the pending count and Open Bills — the lost-order bug.
  const afterBoot = T0 + LEASE_DURATION_MS + 1;
  assert.equal(
    outstandingRecords(store.all(), afterBoot).length,
    1,
    "a stranded record MUST still be counted as outstanding"
  );
  assert.equal(store.get("txn-power")!.localOrderId, "txn-power");

  // Startup recovery makes it retryable and it syncs.
  const fresh = new Tab("ctx-boot", store);
  assert.equal(await fresh.recover(afterBoot), 1);
  assert.deepEqual(await fresh.runSync(afterBoot + 10), ["txn-power"]);
});

test("[L6] recovery preserves localOrderId, customPrice and notes exactly", async () => {
  const store = new FakeQueueStore().seed(pending("txn-immutable"));
  const before = store.get("txn-immutable")!;
  const tab = new Tab("ctx-A", store);
  await tab.claimOnly("txn-immutable", T0);
  await tab.recover(T0 + LEASE_DURATION_MS + 1);

  const after = store.get("txn-immutable")!;
  assert.equal(after.localOrderId, before.localOrderId, "identity never re-minted");
  assert.deepEqual(after.items, before.items, "items, customPrice and item notes intact");
  assert.equal(after.note, before.note);
  assert.equal(after.total, before.total);
  assert.equal(after.paymentStatus, before.paymentStatus);
  assert.equal(typeof after.lastErrorAt, "number", "useful non-sensitive diagnostics kept");
});

test("[L7] repeated recovery scans are idempotent and never duplicate records", async () => {
  const store = new FakeQueueStore().seed(pending("txn-idem"));
  const tab = new Tab("ctx-A", store);
  await tab.claimOnly("txn-idem", T0);

  const after = T0 + LEASE_DURATION_MS + 1;
  assert.equal(await tab.recover(after), 1, "first scan recovers it");
  assert.equal(await tab.recover(after), 0, "second scan finds nothing to do");
  assert.equal(await tab.recover(after + 60_000), 0);
  assert.equal(store.count(), 1, "still exactly one record");
});

test("[L8] a completed record is never recovered or re-sent", async () => {
  const done = pending("txn-done", { syncStatus: "synced", syncedOrderId: "ORD_1", syncedOrderNumber: 77 });
  const store = new FakeQueueStore().seed(done);
  const tab = new Tab("ctx-A", store);

  assert.equal(isStranded(done, T0 + 10 * LEASE_DURATION_MS), false);
  assert.equal(await tab.recover(T0 + 10 * LEASE_DURATION_MS), 0);
  assert.deepEqual(claimableRecords(store.all(), T0), [], "never claimable again");
  assert.deepEqual(await tab.runSync(T0), []);
  assert.equal(claimTransition(done, { ownerId: "x", attemptId: "y", now: T0 }), null);
  assert.deepEqual(outstandingRecords(store.all(), T0), [], "and not shown as outstanding");
});

test("[L9] a record synced before the crash resolves to a replay, not a duplicate", async () => {
  // The server committed, then the terminal died before the local write. On
  // recovery the SAME key is resent, so the server replays. Order integrity is
  // proven in emulator.test.ts [E9]; here we prove the key survives untouched.
  const store = new FakeQueueStore().seed(pending("txn-committed"));
  const dying = new Tab("ctx-dead", store);
  await dying.claimOnly("txn-committed", T0);

  const boot = new Tab("ctx-boot", store);
  await boot.recover(T0 + LEASE_DURATION_MS + 1);
  await boot.runSync(T0 + LEASE_DURATION_MS + 2);

  assert.deepEqual(boot.sent, ["txn-committed"], "resent under the original key");
});

// ── FIX 4 ────────────────────────────────────────────────────────────────────

test("[L10] two tabs syncing simultaneously: each record is claimed exactly once", async () => {
  const keys = ["txn-1", "txn-2", "txn-3", "txn-4", "txn-5"];
  const store = new FakeQueueStore();
  keys.forEach((k) => store.seed(pending(k)));

  const tabA = new Tab("ctx-A", store);
  const tabB = new Tab("ctx-B", store);

  // Genuinely concurrent: both start from the same snapshot.
  const [a, b] = await Promise.all([tabA.runSync(T0), tabB.runSync(T0)]);

  const allClaims = [...a, ...b];
  assert.equal(allClaims.length, new Set(allClaims).size, "no record claimed twice");
  assert.deepEqual([...allClaims].sort(), [...keys].sort(), "every record handled exactly once");

  const allSent = [...tabA.sent, ...tabB.sent];
  assert.equal(allSent.length, keys.length, "each record sent to the server once");
  assert.equal(store.count(), 0, "queue fully drained");
});

test("[L11] a tab skips records another healthy tab is actively processing", async () => {
  const store = new FakeQueueStore().seed(pending("txn-x")).seed(pending("txn-y"));
  const tabA = new Tab("ctx-A", store);
  const tabB = new Tab("ctx-B", store);

  await tabA.claimOnly("txn-x", T0); // A holds x, request in flight

  const bClaims = await tabB.runSync(T0 + 500);
  assert.deepEqual(bClaims, ["txn-y"], "B takes only the unclaimed record");
  assert.equal(store.get("txn-x")!.syncOwnerId, "ctx-A", "A keeps its record");
});

test("[L12] background throttling does not let a live lease be stolen", () => {
  // Chrome throttles background-tab timers to ~1/min, so a live owner may not be
  // heard from for a while. The lease must outlast that.
  const store = new FakeQueueStore().seed(pending("txn-bg"));
  const claimed = claimTransition(store.get("txn-bg")!, { ownerId: "ctx-A", attemptId: "att", now: T0 })!;

  assert.ok(
    LEASE_DURATION_MS >= 90_000,
    "the lease must survive a throttled background tab (~60s between ticks)"
  );
  assert.equal(hasLiveLease(claimed, T0 + 60_000), true, "still owned after a throttled minute");
  assert.equal(isStranded(claimed, T0 + 60_000), false);
});

test("[L13] a claim is refused when the record vanished or is not claimable", () => {
  // Deleted between the snapshot and the claim.
  assert.equal(claimTransition({ localOrderId: "gone", syncStatus: "synced" }, { ownerId: "a", attemptId: "b", now: T0 }), null);
  // Live lease held elsewhere.
  const live = claimTransition(pending("txn-live"), { ownerId: "ctx-A", attemptId: "att", now: T0 })!;
  assert.equal(claimTransition(live, { ownerId: "ctx-B", attemptId: "att2", now: T0 + 1_000 }), null);
  // But claimable once it lapses.
  assert.ok(claimTransition(live, { ownerId: "ctx-B", attemptId: "att2", now: T0 + LEASE_DURATION_MS + 1 }));
});

test("[L14] claiming increments the attempt count and stamps a fresh attempt id", () => {
  const first = claimTransition(pending("txn-n"), { ownerId: "ctx-A", attemptId: "att-1", now: T0 })!;
  assert.equal(first.attemptCount, 1);
  assert.equal(first.syncAttemptId, "att-1");

  const failed = failTransition(first, { error: "network", now: T0 + 10, retryable: true });
  const second = claimTransition(failed, { ownerId: "ctx-B", attemptId: "att-2", now: T0 + 20 })!;
  assert.equal(second.attemptCount, 2, "attempts accumulate across contexts");
  assert.equal(second.syncAttemptId, "att-2");
  assert.equal(second.localOrderId, "txn-n", "identity never changes");
});

test("[L15] completion records the canonical server order and releases the lease", () => {
  const claimed = claimTransition(pending("txn-done2"), { ownerId: "ctx-A", attemptId: "att", now: T0 })!;
  const done = completeTransition(claimed, { orderId: "ORD_CANON", orderNumber: 812, now: T0 + 100 });

  assert.equal(done.syncStatus, "synced");
  assert.equal(done.syncedOrderId, "ORD_CANON", "canonical response stored for support/audit");
  assert.equal(done.syncedOrderNumber, 812);
  assert.equal(done.syncOwnerId, undefined, "lease released");
  assert.equal(done.leaseExpiresAt, undefined);
  assert.equal(done.localOrderId, "txn-done2");
});

test("[L16] outstanding counts include stranded records but exclude in-flight and synced", () => {
  const store = new FakeQueueStore()
    .seed(pending("p1"))
    .seed(pending("f1", { syncStatus: "failed" }))
    .seed(pending("s1", { syncStatus: "synced" }));
  const live = claimTransition(pending("live1"), { ownerId: "ctx-A", attemptId: "att", now: T0 })!;
  store.seed(live as Rec);
  const strandedRec = claimTransition(pending("strand1"), { ownerId: "ctx-dead", attemptId: "att", now: T0 })!;
  store.seed(strandedRec as Rec);

  const now = T0 + 1_000;
  const outstanding = outstandingRecords(store.all(), now).map((r) => r.localOrderId).sort();
  assert.deepEqual(outstanding, ["f1", "p1"], "in-flight is in progress, synced is done");

  const later = T0 + LEASE_DURATION_MS + 1;
  const afterExpiry = outstandingRecords(store.all(), later).map((r) => r.localOrderId).sort();
  assert.deepEqual(afterExpiry, ["f1", "live1", "p1", "strand1"], "lapsed leases resurface");
});

test("[L17] recovered records integrate with the lock and are claimed once", async () => {
  const store = new FakeQueueStore();
  const strandedA = claimTransition(pending("txn-r1"), { ownerId: "ctx-dead", attemptId: "a", now: T0 })!;
  const legacy: Rec = { localOrderId: "txn-r2", syncStatus: "syncing", items: [{ id: "m-1", quantity: 1 }] };
  store.seed(strandedA as Rec).seed(legacy);

  const now = T0 + LEASE_DURATION_MS + 1;
  const tabA = new Tab("ctx-A", store);
  const tabB = new Tab("ctx-B", store);

  // Both tabs recover and sync concurrently.
  const [a, b] = await Promise.all([tabA.runSync(now), tabB.runSync(now)]);
  const claims = [...a, ...b];

  assert.equal(claims.length, new Set(claims).size, "recovered records are still claimed once each");
  assert.deepEqual([...claims].sort(), ["txn-r1", "txn-r2"]);
  assert.equal(store.count(), 0);
});

test("[L18] a failed attempt releases the lease without losing anything", async () => {
  const store = new FakeQueueStore().seed(pending("txn-fail"));
  const tabA = new Tab("ctx-A", store);
  await tabA.runSync(T0, { fail: true });

  const rec = store.get("txn-fail")!;
  assert.equal(rec.syncStatus, "failed");
  assert.equal(rec.syncOwnerId, undefined, "released so another tab can retry");
  assert.equal(rec.attemptCount, 1);
  assert.deepEqual(rec.items, pending("txn-fail").items, "transaction data intact");

  // The lease is released immediately, so no other tab has to wait for expiry —
  // but backoff now governs WHEN the next attempt happens, so an instant retry is
  // correctly suppressed and the scheduled one goes ahead.
  const tabB = new Tab("ctx-B", store);
  const dueAt = store.get("txn-fail")!.nextRetryAt as number;
  assert.ok(dueAt > T0, "a retry was scheduled");
  assert.deepEqual(await tabB.runSync(T0 + 10), [], "not hammered immediately");
  assert.deepEqual(await tabB.runSync(dueAt + 1), ["txn-fail"], "retried when due");
});


// ── BACKOFF ──────────────────────────────────────────────────────────────────

test("[B1] a first failure schedules a retry instead of firing immediately", () => {
  const failed = failTransition(
    claimTransition(pending("txn-b1"), { ownerId: "ctx-A", attemptId: "a", now: T0 })!,
    { error: "network", now: T0, retryable: true, rand: () => 0.5 }
  );
  assert.equal(failed.syncStatus, "failed");
  assert.equal(typeof failed.nextRetryAt, "number");
  assert.ok(failed.nextRetryAt! > T0, "scheduled in the future");
  assert.equal(failed.lastAttemptAt, T0);
  assert.equal(isWaitingForRetry(failed, T0 + 1_000), true);
});

test("[B2] a reconnect before nextRetryAt sends nothing; after it, exactly one attempt", async () => {
  const store = new FakeQueueStore();
  const failed = failTransition(
    claimTransition(pending("txn-b2"), { ownerId: "ctx-A", attemptId: "a", now: T0 })!,
    { error: "network", now: T0, retryable: true, rand: () => 0.5 }
  );
  store.seed(failed as Rec);
  const due = failed.nextRetryAt!;
  const tab = new Tab("ctx-A", store);

  // Reconnect while still waiting: the record is not claimable at all.
  assert.deepEqual(claimableRecords(store.all(), due - 1_000), []);
  assert.deepEqual(await tab.runSync(due - 1_000), [], "no request is sent during backoff");

  // Once due, it is attempted — once.
  assert.deepEqual(await tab.runSync(due + 1), ["txn-b2"]);
  assert.deepEqual(tab.sent, ["txn-b2"]);
});

test("[B3] repeated failures lengthen the delay, bounded by the maximum", () => {
  let record: Rec = pending("txn-b3");
  const delays: number[] = [];
  for (let attempt = 1; attempt <= 10; attempt++) {
    const claimed = claimTransition(record, { ownerId: "ctx-A", attemptId: `a${attempt}`, now: T0 })!;
    if (!claimed) break;
    const failed = failTransition(claimed, { error: "network", now: T0, retryable: true, rand: () => 0.5 });
    if (typeof failed.nextRetryAt === "number") delays.push(failed.nextRetryAt - T0);
    record = failed as Rec;
    if (needsAttention(failed)) break;
  }

  // Monotonic while the schedule is still climbing.
  for (let i = 1; i < Math.min(delays.length, RETRY_SCHEDULE_MS.length); i++) {
    assert.ok(delays[i] > delays[i - 1], `delay ${i} (${delays[i]}) must exceed ${delays[i - 1]}`);
  }
  for (const d of delays) {
    assert.ok(d > 0, "never negative or zero");
    assert.ok(d <= MAX_RETRY_DELAY_MS, `capped at ${MAX_RETRY_DELAY_MS}, got ${d}`);
  }
  // First retry is quick enough to be useful at the counter.
  assert.ok(delays[0] <= 20_000, `first retry should be prompt, got ${delays[0]}ms`);
});

test("[B4] jitter stays within bounds for every extreme of the random source", () => {
  for (const rand of [() => 0, () => 1, () => 0.5, () => 0.999999]) {
    for (let attempt = 1; attempt <= RETRY_SCHEDULE_MS.length + 3; attempt++) {
      const delay = computeNextRetryAt(attempt, T0, rand) - T0;
      assert.ok(delay >= 1_000, `attempt ${attempt}: never below 1s, got ${delay}`);
      assert.ok(delay <= MAX_RETRY_DELAY_MS, `attempt ${attempt}: never above the cap, got ${delay}`);
      assert.ok(Number.isFinite(delay));
    }
  }
  // Jitter actually varies, so many terminals do not reconnect in lockstep.
  assert.notEqual(computeNextRetryAt(2, T0, () => 0), computeNextRetryAt(2, T0, () => 1));
  // Attempt 0 or negative is clamped rather than crashing.
  assert.ok(computeNextRetryAt(0, T0, () => 0.5) > T0);
  assert.ok(computeNextRetryAt(-5, T0, () => 0.5) > T0);
});

test("[B5] exhausted retries park for attention and are NEVER deleted", async () => {
  const store = new FakeQueueStore();
  let record: Rec = pending("txn-b5");
  for (let i = 0; i < MAX_AUTO_ATTEMPTS + 2; i++) {
    const claimed = claimTransition(record, { ownerId: "ctx-A", attemptId: `a${i}`, now: T0 });
    if (!claimed) break;
    record = failTransition(claimed, { error: "network", now: T0, retryable: true, rand: () => 0.5 }) as Rec;
  }
  store.seed(record);

  assert.equal(record.syncStatus, "attention", "parked once attempts are exhausted");
  assert.equal(store.count(), 1, "the order still exists — never deleted");
  assert.deepEqual(record.items, pending("txn-b5").items, "payload intact");
  assert.equal(record.localOrderId, "txn-b5", "identity intact");
  assert.deepEqual(claimableRecords(store.all(), T0 + 10 * MAX_RETRY_DELAY_MS), [], "no more auto retries");
  assert.equal(attentionRecords(store.all()).length, 1, "and it is visible as needing attention");
  assert.equal(outstandingRecords(store.all(), T0).length, 1, "still counted as outstanding");
});

test("[B6] a successful sync clears retry scheduling and diagnostics", () => {
  const failed = failTransition(
    claimTransition(pending("txn-b6"), { ownerId: "ctx-A", attemptId: "a", now: T0 })!,
    { error: "network", now: T0, retryable: true, code: 503, category: "server-retryable", rand: () => 0.5 }
  );
  assert.ok(failed.nextRetryAt);
  const reclaimed = claimTransition(failed, { ownerId: "ctx-A", attemptId: "b", now: failed.nextRetryAt! + 1 })!;
  const done = completeTransition(reclaimed, { orderId: "ORD_X", orderNumber: 9, now: T0 + 1 });

  assert.equal(done.syncStatus, "synced");
  assert.equal(done.nextRetryAt, undefined, "schedule cleared");
  assert.equal(done.lastErrorCode, undefined);
  assert.equal(done.lastErrorCategory, undefined);
  assert.equal(done.syncedOrderId, "ORD_X");
});

test("[B7] a recovered stranded record is due immediately, not stuck behind backoff", () => {
  const claimed = claimTransition(pending("txn-b7"), { ownerId: "ctx-dead", attemptId: "a", now: T0 })!;
  // It carried a schedule from an earlier failure.
  const withSchedule = { ...claimed, nextRetryAt: T0 + MAX_RETRY_DELAY_MS } as Rec;
  const recovered = recoverTransition(withSchedule, T0 + LEASE_DURATION_MS + 1)!;

  assert.equal(recovered.nextRetryAt, undefined, "interrupted, not rejected — no inherited wait");
  assert.equal(recovered.syncStatus, "failed");
  assert.equal(
    claimableRecords([recovered as Rec], T0 + LEASE_DURATION_MS + 2).length,
    1,
    "immediately retryable"
  );
});

test("[B8] legacy failed records with no retry metadata remain recoverable", async () => {
  // Written before backoff existed: `failed`, no nextRetryAt, no attemptCount.
  const legacy: Rec = { localOrderId: "offline-old-1", syncStatus: "failed", items: [{ id: "m-1", quantity: 1 }] };
  const store = new FakeQueueStore().seed(legacy);

  assert.equal(isWaitingForRetry(legacy, T0), false, "no schedule means due now");
  assert.deepEqual(claimableRecords(store.all(), T0).map((r) => r.localOrderId), ["offline-old-1"]);

  const tab = new Tab("ctx-A", store);
  assert.deepEqual(await tab.runSync(T0), ["offline-old-1"], "syncs without needing migration");
});

// ── AUTH LIFECYCLE ──────────────────────────────────────────────────────────

test("[A1] an auth-required record is preserved, visible, and never auto-retried", async () => {
  const store = new FakeQueueStore();
  const parked = failTransition(
    claimTransition(pending("txn-a1"), { ownerId: "ctx-A", attemptId: "a", now: T0 })!,
    { error: "Waiting for sign-in", now: T0, retryable: false, authRequired: true, code: 401, category: "auth-required" }
  );
  store.seed(parked as Rec);

  assert.equal(parked.syncStatus, "auth_required");
  assert.equal(parked.nextRetryAt, undefined, "no timer — it waits for a sign-in, not a clock");
  assert.deepEqual(parked.items, pending("txn-a1").items, "items, customPrice and notes preserved");
  assert.equal(parked.note, "for pickup");
  assert.equal(parked.localOrderId, "txn-a1");

  // Reconnects must not retry it, however many happen.
  const tab = new Tab("ctx-A", store);
  for (const t of [T0 + 1_000, T0 + 60_000, T0 + 10 * LEASE_DURATION_MS]) {
    assert.deepEqual(await tab.runSync(t), [], "no request before sign-in");
  }
  assert.deepEqual(tab.sent, [], "zero requests: no authentication loop");

  // But it is visible to the cashier.
  assert.equal(attentionRecords(store.all()).length, 1);
  assert.equal(authRequiredRecords(store.all()).length, 1);
  assert.equal(outstandingRecords(store.all(), T0).length, 1);
});

test("[A2] repeated 401s update the one record and never create duplicates", async () => {
  const store = new FakeQueueStore().seed(pending("txn-a2"));
  const tab = new Tab("ctx-A", store);

  for (let i = 0; i < 4; i++) {
    const claimed = await tab.claimOnly("txn-a2", T0 + i);
    if (!claimed) continue;
    await store.updateAtomic("txn-a2", (cur) =>
      cur
        ? (failTransition(cur, {
            error: "Waiting for sign-in", now: T0 + i, retryable: false, authRequired: true, code: 401,
          }) as Rec)
        : null
    );
    // Un-park so the next iteration can claim again, as a re-login would.
    await store.updateAtomic("txn-a2", (cur) => (cur ? (resumeAuthTransition(cur, T0 + i) as Rec | null) : null));
  }

  assert.equal(store.count(), 1, "exactly one queue record throughout");
  assert.equal(store.get("txn-a2")!.localOrderId, "txn-a2");
});

test("[A3] successful re-authentication resumes sync under the ORIGINAL key", async () => {
  const store = new FakeQueueStore();
  const parked = failTransition(
    claimTransition(pending("txn-a3"), { ownerId: "ctx-A", attemptId: "a", now: T0 })!,
    { error: "Waiting for sign-in", now: T0, retryable: false, authRequired: true, code: 401 }
  );
  store.seed(parked as Rec);
  const tab = new Tab("ctx-A", store);
  assert.deepEqual(await tab.runSync(T0 + 5_000), [], "paused");

  // The cashier signs in; a later request succeeds, proving the session works.
  const resumed = resumeAuthTransition(store.get("txn-a3")!, T0 + 10_000)!;
  await store.updateAtomic("txn-a3", () => resumed as Rec);

  assert.equal(resumed.syncStatus, "pending");
  assert.equal(resumed.nextRetryAt, undefined, "due immediately");
  assert.equal(resumed.localOrderId, "txn-a3", "same identity — the server can replay");
  assert.deepEqual(resumed.items, pending("txn-a3").items);

  assert.deepEqual(await tab.runSync(T0 + 10_001), ["txn-a3"], "synchronisation resumes");
  assert.equal(store.count(), 0);
});

test("[A4] resume only applies to auth-parked records", () => {
  assert.equal(resumeAuthTransition(pending("p"), T0), null, "pending is left alone");
  assert.equal(resumeAuthTransition(pending("s", { syncStatus: "synced" }), T0), null);
  assert.equal(resumeAuthTransition(pending("c", { syncStatus: "attention" }), T0), null, "a conflict still needs a human");
  const live = claimTransition(pending("l"), { ownerId: "ctx-A", attemptId: "a", now: T0 })!;
  assert.equal(resumeAuthTransition(live, T0 + 1), null, "an in-flight attempt is untouched");
});

test("[A5] resuming in one context does not disturb another context's records", async () => {
  const store = new FakeQueueStore();
  const parkedA = failTransition(
    claimTransition(pending("txn-A"), { ownerId: "ctx-A", attemptId: "a", now: T0 })!,
    { error: "auth", now: T0, retryable: false, authRequired: true }
  );
  store.seed(parkedA as Rec);
  const liveB = claimTransition(pending("txn-B"), { ownerId: "ctx-B", attemptId: "b", now: T0 })!;
  store.seed(liveB as Rec);

  // Tab A re-authenticates and resumes only auth-parked records.
  for (const r of authRequiredRecords(store.all())) {
    await store.updateAtomic(r.localOrderId, (cur) => (cur ? (resumeAuthTransition(cur, T0 + 1) as Rec | null) : null));
  }

  assert.equal(store.get("txn-A")!.syncStatus, "pending", "A resumed");
  assert.equal(store.get("txn-B")!.syncStatus, "syncing", "B's in-flight record untouched");
  assert.equal(store.get("txn-B")!.syncOwnerId, "ctx-B", "and still owned by B");
});

// ── 409 ATTENTION STATE ─────────────────────────────────────────────────────

test("[K1] a 409 conflict parks for human attention and is never auto-retried", async () => {
  const store = new FakeQueueStore();
  const conflicted = failTransition(
    claimTransition(pending("txn-k1"), { ownerId: "ctx-A", attemptId: "a", now: T0 })!,
    {
      error: "Could not be matched to an existing order — needs review",
      now: T0, retryable: false, code: 409, category: "conflict",
    }
  );
  store.seed(conflicted as Rec);

  assert.equal(conflicted.syncStatus, "attention");
  assert.equal(conflicted.nextRetryAt, undefined, "no automatic retry is scheduled");
  assert.deepEqual(conflicted.items, pending("txn-k1").items, "full order contents preserved");
  assert.equal(conflicted.total, 9000);

  const tab = new Tab("ctx-A", store);
  for (const t of [T0 + 1_000, T0 + 10 * MAX_RETRY_DELAY_MS]) {
    assert.deepEqual(await tab.runSync(t), [], "reconnects never resend a conflict");
  }

  // Visible in the attention count, and still outstanding.
  assert.equal(attentionRecords(store.all()).length, 1);
  assert.equal(outstandingRecords(store.all(), T0).length, 1);
  assert.equal(store.count(), 1, "preserved, not deleted");

  // Cashier-safe diagnostics only: no fingerprint, no claim id, no internals.
  const message = String(conflicted.syncError);
  for (const leak of ["fingerprint", "claim", "v2|", "pos_order_claims", "ORD_"]) {
    assert.ok(!message.includes(leak), `must not expose "${leak}"`);
  }
  assert.match(message, /needs review/i);
});

test("[K2] the attention set is exactly the parked statuses", () => {
  assert.deepEqual([...ATTENTION_STATUSES].sort(), ["attention", "auth_required"]);
  assert.equal(needsAttention(pending("x", { syncStatus: "attention" })), true);
  assert.equal(needsAttention(pending("x", { syncStatus: "auth_required" })), true);
  for (const status of ["pending", "failed", "syncing", "synced"] as const) {
    assert.equal(needsAttention(pending("x", { syncStatus: status })), false, status);
  }
});

// ── MANUAL RETRY ────────────────────────────────────────────────────────────

test("[M1] manual retry bypasses backoff but still claims atomically", async () => {
  const store = new FakeQueueStore();
  const failed = failTransition(
    claimTransition(pending("txn-m1"), { ownerId: "ctx-A", attemptId: "a", now: T0 })!,
    { error: "network", now: T0, retryable: true, rand: () => 0.5 }
  );
  store.seed(failed as Rec);
  assert.equal(isWaitingForRetry(failed, T0 + 100), true);

  // The cashier presses retry while still inside the wait.
  const readied = await store.updateAtomic("txn-m1", (cur) =>
    cur ? (manualRetryTransition(cur, T0 + 100) as Rec | null) : null
  );
  assert.ok(readied);
  assert.equal(readied!.nextRetryAt, undefined, "the wait is cleared");
  assert.equal(readied!.localOrderId, "txn-m1", "same identity");

  const tab = new Tab("ctx-A", store);
  assert.deepEqual(await tab.runSync(T0 + 101), ["txn-m1"]);
  assert.equal(store.count(), 0);
});

test("[M2] manual retry never steals an in-flight attempt", () => {
  const live = claimTransition(pending("txn-m2"), { ownerId: "ctx-A", attemptId: "a", now: T0 })!;
  assert.equal(manualRetryTransition(live, T0 + 1_000), null, "a live lease is respected");
  // Once the lease lapses it may be retried.
  assert.ok(manualRetryTransition(live, T0 + LEASE_DURATION_MS + 1));
  // And a completed record is never retried.
  assert.equal(manualRetryTransition(pending("d", { syncStatus: "synced" }), T0), null);
});

test("[M3] two tabs pressing retry at once produce one claim and one request", async () => {
  const store = new FakeQueueStore();
  const failed = failTransition(
    claimTransition(pending("txn-m3"), { ownerId: "ctx-A", attemptId: "a", now: T0 })!,
    { error: "network", now: T0, retryable: true, rand: () => 0.5 }
  );
  store.seed(failed as Rec);

  const tabA = new Tab("ctx-A", store);
  const tabB = new Tab("ctx-B", store);

  // Both clear the wait, then both run — the atomic claim decides.
  await Promise.all([
    store.updateAtomic("txn-m3", (cur) => (cur ? (manualRetryTransition(cur, T0 + 50) as Rec | null) : null)),
    store.updateAtomic("txn-m3", (cur) => (cur ? (manualRetryTransition(cur, T0 + 50) as Rec | null) : null)),
  ]);
  const [a, b] = await Promise.all([tabA.runSync(T0 + 60), tabB.runSync(T0 + 60)]);

  const all = [...a, ...b];
  assert.deepEqual(all, ["txn-m3"], "exactly one tab claimed it");
  assert.equal(tabA.sent.length + tabB.sent.length, 1, "one request reached the server");
  assert.equal(store.count(), 0);
});

// ── TIMEOUT / LEASE RELATIONSHIP ────────────────────────────────────────────

test("[T1] the sync timeout cannot outlive the lease, and cleanup releases it early", async () => {
  const SYNC_TIMEOUT_MS = 30_000; // POS_SYNC_TIMEOUT_MS
  assert.ok(
    LEASE_DURATION_MS > SYNC_TIMEOUT_MS * 2,
    `a lease (${LEASE_DURATION_MS}ms) must comfortably outlive the request it guards (${SYNC_TIMEOUT_MS}ms)`
  );

  // A request that returns before expiry releases the lease immediately, rather
  // than leaving the record locked for the rest of the window.
  const store = new FakeQueueStore().seed(pending("txn-t1"));
  const tab = new Tab("ctx-A", store);
  await tab.runSync(T0, { fail: true });
  const after = store.get("txn-t1")!;
  assert.equal(after.syncStatus, "failed", "released well before the lease would have expired");
  assert.equal(after.leaseExpiresAt, undefined);
  assert.equal(hasLiveLease(after, T0 + 1), false);

  // A dead tab's lease does eventually expire.
  const dead = claimTransition(pending("txn-t1b"), { ownerId: "ctx-dead", attemptId: "a", now: T0 })!;
  assert.equal(hasLiveLease(dead, T0 + SYNC_TIMEOUT_MS + 1_000), true, "still owned while the request could be alive");
  assert.equal(isStranded(dead, T0 + LEASE_DURATION_MS + 1), true, "but reclaimable once it lapses");

  // Backoff is scheduled from the completed attempt, so attempts never overlap.
  const failedRec = failTransition(dead, { error: "timeout", now: T0 + SYNC_TIMEOUT_MS, retryable: true, rand: () => 0.5 });
  assert.ok(failedRec.nextRetryAt! > T0 + SYNC_TIMEOUT_MS, "the next attempt starts after this one finished");
  assert.equal(failedRec.lastAttemptAt, T0 + SYNC_TIMEOUT_MS);
});

// ── runner ───────────────────────────────────────────────────────────────────
(async () => {
  console.log("pos/sync-lease (Fix 5 + Fix 4)");
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
