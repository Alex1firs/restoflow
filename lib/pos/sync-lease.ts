/**
 * Offline-queue synchronisation leases — stranded-record recovery (Fix 5) and
 * cross-tab ownership (Fix 4).
 *
 * ── The two problems ────────────────────────────────────────────────────────
 *
 * Stranded records. A queue record was flipped to `syncing` before its request
 * went out, but the queue only ever retrieved `pending` and `failed`. If the tab
 * closed, the browser reloaded, the terminal lost power or the request hung, that
 * record was left in `syncing` forever: invisible in Open Bills, absent from the
 * pending count, never retried. A silent LOST order — the mirror image of the
 * duplicate bug, and worse, because the cashier re-keys it by hand and the new
 * copy has a different key that nothing can dedupe.
 *
 * Cross-tab ownership. The old guard was a React ref: asynchronous, per component
 * instance, per tab. Two POS tabs — or an installed PWA plus a browser tab — read
 * the same IndexedDB records and synchronised them concurrently. Server
 * idempotency now stops that becoming duplicate ORDERS, but the clients still
 * corrupt each other's local queue state, delete records the other is processing,
 * and fire completion effects twice.
 *
 * ── One mechanism for both ──────────────────────────────────────────────────
 * A record is claimed with a LEASE, written inside a single IndexedDB readwrite
 * transaction. IndexedDB serialises transactions per origin, so a read-then-write
 * in one transaction is atomic across tabs — which is why the database claim is
 * authoritative here rather than Web Locks or BroadcastChannel. Those are useful
 * signals but are not uniformly available, and a lock that some context silently
 * lacks is not a lock.
 *
 * A lease expires. That single fact covers both problems: another tab will not
 * touch a live lease, and a dead tab's lease eventually lapses so its record
 * becomes retryable instead of stranded.
 *
 * ── Never destructive ───────────────────────────────────────────────────────
 * Recovery only ever moves a record back to a retryable state. It does not delete
 * records, does not touch `localOrderId`, and does not touch the immutable
 * transaction data (items, customPrice, notes). A record that cannot be
 * synchronised is preserved and surfaced, never discarded.
 */

/**
 * Queue record states.
 *
 * `auth_required` and `attention` are additive: they park a record OUT of the
 * automatic retry path without deleting it, so a transaction is never lost just
 * because it cannot currently be sent. Legacy records have none of these and are
 * treated as `pending`.
 */
export type QueueSyncStatus =
  | "pending"
  | "syncing"
  | "synced"
  | "failed"
  /** Session expired — paused until the cashier signs in again. */
  | "auth_required"
  /** Needs a human (409 conflict, permanent server failure, exhausted retries). */
  | "attention";

/** Lease fields added to a queue record. All optional — legacy records lack them. */
export interface SyncLeaseFields {
  /** Identifies the browser context holding the lease. */
  syncOwnerId?: string;
  /** Unique per attempt, so a stale response cannot be mistaken for the current one. */
  syncAttemptId?: string;
  syncStartedAt?: number;
  /** Past this, the lease is considered lapsed and the record is recoverable. */
  leaseExpiresAt?: number;
  attemptCount?: number;
  lastErrorAt?: number;
  syncError?: string;
  /** When the last attempt was made, and when the next one becomes due. */
  lastAttemptAt?: number;
  nextRetryAt?: number;
  /** Non-sensitive diagnostics: HTTP status and failure category. */
  lastErrorCode?: number | null;
  lastErrorCategory?: string;
  /** Canonical server response recorded on success, for support and audit. */
  syncedOrderId?: string;
  syncedOrderNumber?: number | null;
}

export interface QueueRecordLike extends SyncLeaseFields {
  localOrderId: string;
  syncStatus?: QueueSyncStatus;
  paymentStatus?: string;
}

/**
 * How long a claim is held before another context may take it.
 *
 * Must comfortably exceed the sync request timeout (POS_SYNC_TIMEOUT_MS, 30s) so
 * a slow-but-alive request is never stolen mid-flight, and must also tolerate
 * background-tab timer throttling, which Chrome reduces to roughly once a minute.
 * A lease that expires while its owner is merely backgrounded would let a second
 * tab issue the same request — harmless for order integrity now that the server
 * is idempotent, but it corrupts local queue state and duplicates UI effects.
 */
export const LEASE_DURATION_MS = 120_000;

/** Refresh cadence for a long-running sync, well inside the lease. */
export const LEASE_RENEW_MS = 20_000;

/** Statuses a sync run is allowed to pick up. Deliberately excludes the parked ones. */
export const RETRYABLE_STATUSES: readonly QueueSyncStatus[] = ["pending", "failed"];

/** Statuses that need a human and must never be retried automatically. */
export const ATTENTION_STATUSES: readonly QueueSyncStatus[] = ["auth_required", "attention"];

/**
 * Backoff schedule, in milliseconds, indexed by the attempt that just failed.
 *
 * Tuned for a restaurant on unstable connectivity: the first retries are quick
 * enough that a brief drop-out resolves itself while the customer is still at the
 * counter, but repeated failures back off so a weak link is not hammered. The last
 * value is the bounded maximum and repeats indefinitely.
 *
 *   1st failure -> ~12s     2nd -> ~30s     3rd -> ~60s
 *   4th -> ~2.5min          5th and beyond -> ~5min (cap)
 */
export const RETRY_SCHEDULE_MS: readonly number[] = [12_000, 30_000, 60_000, 150_000, 300_000];

/** Maximum backoff, i.e. the cap the schedule saturates at. */
export const MAX_RETRY_DELAY_MS = RETRY_SCHEDULE_MS[RETRY_SCHEDULE_MS.length - 1];

/**
 * Attempts before a record is parked for human attention.
 *
 * It is NEVER deleted — it stops being retried automatically and becomes visible
 * as needing attention, so a genuine transaction cannot silently disappear.
 */
export const MAX_AUTO_ATTEMPTS = 8;

/** +/- 20% jitter, so many terminals reconnecting together do not synchronise. */
export const RETRY_JITTER_RATIO = 0.2;

/**
 * When the next attempt becomes due after `attemptCount` failures.
 *
 * `rand` is injectable so tests are deterministic. Jitter is symmetric and the
 * result is clamped, so it can never be negative or exceed the cap.
 */
export function computeNextRetryAt(
  attemptCount: number,
  now: number,
  rand: () => number = Math.random
): number {
  const index = Math.min(Math.max(attemptCount, 1), RETRY_SCHEDULE_MS.length) - 1;
  const base = RETRY_SCHEDULE_MS[index];
  const jitter = base * RETRY_JITTER_RATIO * (rand() * 2 - 1);
  const delay = Math.min(Math.max(Math.round(base + jitter), 1_000), MAX_RETRY_DELAY_MS);
  return now + delay;
}

/** True when a record is parked awaiting a human or a sign-in. */
export function needsAttention(record: QueueRecordLike): boolean {
  return ATTENTION_STATUSES.includes(record.syncStatus ?? "pending");
}

/** True when backoff still has this record waiting. */
export function isWaitingForRetry(record: QueueRecordLike, now: number): boolean {
  return typeof record.nextRetryAt === "number" && record.nextRetryAt > now;
}

// ── Lease state ──────────────────────────────────────────────────────────────

export function isRetryable(record: QueueRecordLike): boolean {
  const status = record.syncStatus ?? "pending";
  return RETRYABLE_STATUSES.includes(status);
}

/** A lease that is still held by a live owner. */
export function hasLiveLease(record: QueueRecordLike, now: number): boolean {
  if ((record.syncStatus ?? "pending") !== "syncing") return false;
  // A legacy `syncing` record has no lease at all, so nothing is holding it.
  if (typeof record.leaseExpiresAt !== "number") return false;
  return record.leaseExpiresAt > now;
}

/**
 * A record stuck in `syncing` that no live context is holding.
 *
 * Covers both the lapsed-lease case and the legacy case: records written before
 * leases existed have `syncing` with no metadata and would otherwise be stranded
 * forever. With no credible active owner, they are recoverable.
 */
export function isStranded(record: QueueRecordLike, now: number): boolean {
  if ((record.syncStatus ?? "pending") !== "syncing") return false;
  return !hasLiveLease(record, now);
}

/** Why a record was skipped or recovered — surfaced for diagnostics, not to cashiers. */
export type RecoveryReason = "lease-expired" | "legacy-no-lease";

export function recoveryReasonFor(record: QueueRecordLike): RecoveryReason {
  return typeof record.leaseExpiresAt === "number" ? "lease-expired" : "legacy-no-lease";
}

// ── Transitions (pure — the caller persists them atomically) ─────────────────

/**
 * The claim to write when taking ownership. Returns null when the record must not
 * be claimed, which is what makes the operation safe to run inside an IndexedDB
 * transaction: read, ask, write only if allowed.
 *
 * A `synced` record is never re-claimed, so a completed transaction cannot be
 * resurrected and sent again.
 */
export function claimTransition<T extends QueueRecordLike>(
  record: T,
  input: { ownerId: string; attemptId: string; now: number }
): (T & SyncLeaseFields) | null {
  const { ownerId, attemptId, now } = input;
  const status = record.syncStatus ?? "pending";

  if (status === "synced") return null;
  // Parked records are never picked up automatically: retrying an auth-required
  // record before sign-in is a loop, and a conflict needs a human.
  if (needsAttention(record)) return null;
  if (status === "syncing" && hasLiveLease(record, now)) return null;
  if (status !== "syncing" && !isRetryable(record)) return null;

  return {
    ...record,
    syncStatus: "syncing",
    syncOwnerId: ownerId,
    syncAttemptId: attemptId,
    syncStartedAt: now,
    leaseExpiresAt: now + LEASE_DURATION_MS,
    attemptCount: (record.attemptCount ?? 0) + 1,
  };
}

/**
 * Moves a stranded record back to a retryable state. Preserves the key, the
 * items, customPrice, notes and the attempt count; only lease fields are cleared.
 */
export function recoverTransition<T extends QueueRecordLike>(
  record: T,
  now: number
): (T & SyncLeaseFields) | null {
  if (!isStranded(record, now)) return null;
  const recovered = {
    ...record,
    syncStatus: "failed" as const,
    lastErrorAt: now,
    syncError:
      recoveryReasonFor(record) === "legacy-no-lease"
        ? "Interrupted before this device recorded progress — will retry"
        : "Interrupted mid-sync — will retry",
  };
  delete recovered.syncOwnerId;
  delete recovered.syncAttemptId;
  delete recovered.syncStartedAt;
  delete recovered.leaseExpiresAt;
  // Interrupted, not rejected — it becomes due immediately rather than inheriting
  // a backoff window it never earned.
  delete recovered.nextRetryAt;
  return recovered;
}

/** Records the canonical server response on success. */
export function completeTransition<T extends QueueRecordLike>(
  record: T,
  input: { orderId: string; orderNumber: number | null; now: number }
): T & SyncLeaseFields {
  const done = {
    ...record,
    syncStatus: "synced" as const,
    syncedOrderId: input.orderId,
    syncedOrderNumber: input.orderNumber,
  };
  delete done.syncOwnerId;
  delete done.syncAttemptId;
  delete done.leaseExpiresAt;
  delete done.syncError;
  // Confirmed: retry scheduling and diagnostics no longer apply.
  delete done.nextRetryAt;
  delete done.lastErrorCode;
  delete done.lastErrorCategory;
  return done;
}

export interface FailInput {
  error: string;
  now: number;
  /** False for outcomes repetition cannot fix (conflict, permanent server error). */
  retryable: boolean;
  /** Park awaiting sign-in rather than scheduling a retry. */
  authRequired?: boolean;
  code?: number | null;
  category?: string;
  rand?: () => number;
}

/**
 * Releases the lease after a failed attempt and decides what happens next.
 *
 * Always preserves `localOrderId` and the whole transaction payload. A record is
 * never deleted here, and never left in `syncing`, which is what stranded orders
 * in the first place.
 */
export function failTransition<T extends QueueRecordLike>(
  record: T,
  input: FailInput
): T & SyncLeaseFields {
  const attempts = record.attemptCount ?? 1;
  const parkForAuth = input.authRequired === true;
  const exhausted = attempts >= MAX_AUTO_ATTEMPTS;
  const park = parkForAuth || !input.retryable || exhausted;

  const next = {
    ...record,
    syncStatus: parkForAuth ? ("auth_required" as const) : park ? ("attention" as const) : ("failed" as const),
    syncError: input.error,
    lastErrorAt: input.now,
    lastAttemptAt: input.now,
    lastErrorCode: input.code ?? null,
    lastErrorCategory: input.category ?? (park ? "parked" : "retryable"),
  };
  delete next.syncOwnerId;
  delete next.syncAttemptId;
  delete next.leaseExpiresAt;

  if (park) {
    // No schedule: a parked record waits for sign-in or a human, not a timer.
    delete next.nextRetryAt;
  } else {
    next.nextRetryAt = computeNextRetryAt(attempts, input.now, input.rand);
  }
  return next;
}

/**
 * Returns an auth-parked record to the ordinary retry path once the session is
 * known to work again. Never touches the identity or the payload.
 */
export function resumeAuthTransition<T extends QueueRecordLike>(
  record: T,
  now: number
): (T & SyncLeaseFields) | null {
  if ((record.syncStatus ?? "pending") !== "auth_required") return null;
  const resumed = {
    ...record,
    syncStatus: "pending" as const,
    lastAttemptAt: now,
    syncError: undefined as string | undefined,
  };
  delete resumed.syncError;
  // Due immediately: the cashier just proved the session works.
  delete resumed.nextRetryAt;
  return resumed;
}

/**
 * Cashier-initiated retry. Bypasses the backoff wait but NOT the lease: the
 * caller still has to win the atomic claim, so two tabs cannot both retry, and a
 * record with a live lease is left alone.
 */
export function manualRetryTransition<T extends QueueRecordLike>(
  record: T,
  now: number
): (T & SyncLeaseFields) | null {
  const status = record.syncStatus ?? "pending";
  if (status === "synced") return null;
  // An in-flight attempt owns the record; a manual retry must not steal it.
  if (hasLiveLease(record, now)) return null;
  const ready = {
    ...record,
    syncStatus: "pending" as const,
    lastAttemptAt: now,
  };
  delete ready.nextRetryAt;
  delete ready.syncOwnerId;
  delete ready.syncAttemptId;
  delete ready.leaseExpiresAt;
  return ready;
}

// ── Cashier-visible accounting ───────────────────────────────────────────────

/**
 * Records the cashier should see as outstanding.
 *
 * Includes stranded `syncing` records: leaving them out of this count is precisely
 * how a lost order became invisible. Excludes records currently being synced by a
 * live context — those are in progress, not outstanding — and `synced` ones.
 */
export function outstandingRecords<T extends QueueRecordLike>(records: T[], now: number): T[] {
  return records.filter((r) => {
    const status = r.syncStatus ?? "pending";
    if (status === "synced") return false;
    // Parked and backing-off records stay visible — invisibility is what turned a
    // stuck record into a silently lost order.
    if (status === "syncing") return isStranded(r, now);
    return true;
  });
}

/**
 * Records a sync run may attempt now: retryable, off backoff, not parked, or
 * stranded and thus reclaimable.
 */
export function claimableRecords<T extends QueueRecordLike>(records: T[], now: number): T[] {
  return records.filter((r) => {
    const status = r.syncStatus ?? "pending";
    if (status === "synced") return false;
    if (needsAttention(r)) return false;
    // A stranded record was interrupted, not rejected, so backoff does not apply.
    if (status === "syncing") return isStranded(r, now);
    if (!isRetryable(r)) return false;
    return !isWaitingForRetry(r, now);
  });
}

/** Records parked for a human or a sign-in — the cashier-visible attention count. */
export function attentionRecords<T extends QueueRecordLike>(records: T[]): T[] {
  return records.filter((r) => needsAttention(r));
}

/** Records paused specifically on authentication. */
export function authRequiredRecords<T extends QueueRecordLike>(records: T[]): T[] {
  return records.filter((r) => (r.syncStatus ?? "pending") === "auth_required");
}

// ── Owner identity ───────────────────────────────────────────────────────────

/**
 * Identifies this browser context for the lifetime of the page.
 *
 * Per-context rather than per-device: an installed PWA window and a browser tab
 * must be distinguishable, or they could not tell each other's leases apart.
 * Held in memory only — a reloaded page is a new context and must not inherit a
 * lease it is no longer servicing.
 */
let cachedOwnerId: string | null = null;

export function syncOwnerId(): string {
  if (cachedOwnerId) return cachedOwnerId;
  const rand =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Math.random().toString(36).slice(2)}${Date.now()}`;
  cachedOwnerId = `ctx-${rand}`;
  return cachedOwnerId;
}

export function newAttemptId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `att-${crypto.randomUUID()}`;
  }
  return `att-${Math.random().toString(36).slice(2)}${Date.now()}`;
}
