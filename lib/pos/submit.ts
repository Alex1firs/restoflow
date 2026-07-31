/**
 * POS submission outcomes — bounded requests and deterministic hand-off.
 *
 * A POS submission had no timeout. On an unstable link the request could hang
 * indefinitely: the button sat on "Submitting", the cart stayed on screen, and
 * the cashier had no way to know whether the order had been accepted. Their only
 * escape was reloading and ringing it up again.
 *
 * Every submission must now reach exactly one definite state within a bounded
 * period, and the client must never destroy transaction intent on an outcome it
 * cannot confirm.
 *
 * ── The governing rule: certainty, not status codes ─────────────────────────
 * The question is never "did the request fail?" but "do we KNOW whether the
 * server committed?". Only three answers are certain:
 *
 *   validation (4xx)  the payload was rejected before any write
 *   conflict (409)    this key already belongs to a different order
 *   teardown          nobody is watching; cart and key are still persisted
 *
 * Everything else — timeout, dropped connection, 401, and every retryable 5xx —
 * leaves the outcome UNKNOWN, so the order is preserved under its SAME
 * idempotency key and resolved later by the server's replay.
 */

/**
 * Timeout for a cashier-facing order submission.
 *
 * Chosen for real Nigerian network conditions rather than a lab: tills run on
 * mobile broadband and tethered 3G/4G where a slow-but-working request can take
 * many seconds. The server side of one order is itself several round trips —
 * Firebase session verification, a subscription read, the menu query, then the
 * transaction — so a short timeout would abort requests that were about to
 * succeed. Every false timeout pushes an order into the offline queue, delaying
 * the kitchen ticket, so this errs long.
 *
 * 20s is roughly 4-6x a healthy submission and still short enough that a cashier
 * is never left guessing. Slower than this and the cashier would start reloading
 * anyway, which is the behaviour being removed.
 */
export const POS_SUBMIT_TIMEOUT_MS = 20_000;

/**
 * Timeout for a background queue-drain request. Longer than a submission: no
 * cashier is waiting on it, and a sync that is merely slow should be allowed to
 * finish rather than be retried into more load on a weak connection. Must stay
 * well under LEASE_DURATION_MS so a lease outlives the request it guards.
 */
export const POS_SYNC_TIMEOUT_MS = 30_000;

/**
 * 5xx statuses worth retrying.
 *
 * These are the ones that plausibly mean "try again later" — including 500,
 * because this API's own catch-all converts *any* unexpected throw into a 500,
 * and some of those throws happen AFTER the Firestore transaction has committed
 * (the replay branch re-reads the order document; a proxy can also 502/504 after
 * the function returned successfully). A 500 therefore cannot be read as "no
 * order was created".
 */
export const RETRYABLE_SERVER_STATUSES: readonly number[] = [408, 425, 429, 500, 502, 503, 504];

// ── Failure classification ───────────────────────────────────────────────────

export type SubmitFailure =
  /** The device knows it has no connectivity. */
  | { kind: "offline" }
  /** Our own deadline fired. The server's outcome is UNKNOWN. */
  | { kind: "timeout" }
  /** The connection failed or dropped mid-flight. Outcome also unknown. */
  | { kind: "network" }
  /** Aborted because the component unmounted or the page navigated away. */
  | { kind: "teardown" }
  /**
   * The session could not be verified. NOT an ordinary network failure: retrying
   * on every reconnect cannot help until the cashier signs in again, and doing so
   * would be an authentication loop.
   */
  | { kind: "auth-required" }
  /** The server rejected the payload. It definitively did NOT commit. */
  | { kind: "validation"; message: string }
  /** The key already belongs to a materially different order. */
  | { kind: "conflict" }
  /** A 5xx that may or may not have committed. Preserve and retry. */
  | { kind: "server-retryable"; status: number; message: string }
  /** A 5xx that will not succeed by repetition (e.g. 501). Preserve, do not loop. */
  | { kind: "server-permanent"; status: number; message: string };

/** Where a preserved transaction should sit in the queue. */
export type HandoffState =
  /** Ordinary retry path, subject to backoff. */
  | "pending"
  /** Paused until the cashier signs in again. */
  | "auth_required"
  /** Needs a human; never retried automatically. */
  | "attention";

export type HandoffPlan =
  | { handoff: false }
  | { handoff: true; queueState: HandoffState };

/**
 * What to do with a failed submission.
 *
 * Nothing is discarded on an uncertain outcome. The three `handoff: false` cases
 * are the only ones where we KNOW the server did not commit, or where the cart and
 * key remain in place for the cashier to resubmit under the same identity.
 */
export function planHandoff(failure: SubmitFailure): HandoffPlan {
  switch (failure.kind) {
    case "offline":
    case "timeout":
    case "network":
    case "server-retryable":
      return { handoff: true, queueState: "pending" };
    case "auth-required":
      // Preserved but paused: retrying before re-authentication is a loop.
      return { handoff: true, queueState: "auth_required" };
    case "server-permanent":
      // Preserved but not looped — repetition cannot fix it.
      return { handoff: true, queueState: "attention" };
    case "teardown":
    case "validation":
    case "conflict":
      return { handoff: false };
  }
}

/** Convenience for call sites that only need the boolean. */
export function shouldHandOffToQueue(failure: SubmitFailure): boolean {
  return planHandoff(failure).handoff;
}

/** Classifies a non-OK HTTP response from either POS route. */
export function classifyResponseFailure(status: number, message: string): SubmitFailure {
  if (status === 401 || status === 403) return { kind: "auth-required" };
  if (status === 409) return { kind: "conflict" };
  if (status >= 500 || status === 408 || status === 425 || status === 429) {
    return RETRYABLE_SERVER_STATUSES.includes(status)
      ? { kind: "server-retryable", status, message }
      : { kind: "server-permanent", status, message };
  }
  // Everything else in the 4xx range is a definite rejection of the payload,
  // including 426 (client too old to be trusted with an idempotency key).
  return { kind: "validation", message };
}

export interface ThrownContext {
  /** navigator.onLine at the moment of failure. */
  online: boolean;
  /** Our deadline fired. */
  timedOut: boolean;
  /** The component unmounted / the page navigated away. */
  tornDown: boolean;
}

/**
 * Classifies a thrown error from `fetch`.
 *
 * Order matters. An abort is reported the same way whether it came from our
 * deadline or from teardown, so the caller's own flags disambiguate — without
 * them, a component unmount would be misread as a timeout and would queue an
 * order nobody asked to queue.
 */
export function classifyThrownFailure(error: unknown, ctx: ThrownContext): SubmitFailure {
  if (ctx.tornDown) return { kind: "teardown" };
  if (ctx.timedOut) return { kind: "timeout" };
  if (!ctx.online) return { kind: "offline" };

  const name = (error as { name?: unknown } | null)?.name;
  if (name === "AbortError") {
    // Aborted, but neither flag is set: something else cancelled it. Treat it as
    // teardown rather than inventing a queue entry.
    return { kind: "teardown" };
  }
  // fetch rejects with a TypeError when the connection cannot be made or dies.
  return { kind: "network" };
}

/** Short, non-sensitive category recorded on the queue record for diagnostics. */
export function errorCategoryOf(failure: SubmitFailure): string {
  return failure.kind;
}

export function errorCodeOf(failure: SubmitFailure): number | null {
  if (failure.kind === "server-retryable" || failure.kind === "server-permanent") return failure.status;
  if (failure.kind === "auth-required") return 401;
  if (failure.kind === "conflict") return 409;
  return null;
}

// ── Cashier-facing copy ──────────────────────────────────────────────────────
// Never mentions timeouts, aborts, status codes, fingerprints or claim ids, and
// never asserts an outcome that has not been confirmed.

export function messageForQueuedHandoff(failure: SubmitFailure): string {
  switch (failure.kind) {
    case "offline":
      return "Offline — the order is saved and will sync automatically.";
    case "auth-required":
      return "Your session has expired. This order is safely preserved. Please sign in again to complete synchronisation.";
    case "server-retryable":
      // Deliberately does NOT say the order reached the restaurant, and does NOT
      // say it failed. A 5xx here can happen after the order was committed.
      return "We could not confirm the server response. Your order has been preserved and can be retried safely.";
    case "server-permanent":
      return "This order needs attention. It has been preserved — please ask a manager to review it.";
    case "timeout":
    case "network":
    default:
      return "Network is slow — the order is saved and will sync automatically. Do not ring it up again.";
  }
}

/** Cashier-facing copy for a failure that was NOT queued. */
export function messageForFailure(failure: SubmitFailure): string {
  switch (failure.kind) {
    case "conflict":
      return "This order was already recorded. Please check Open Bills before ringing it up again.";
    case "validation":
      return failure.message || "Please check the order and try again.";
    case "teardown":
      return "";
    default:
      return "Could not save the order. Please try again.";
  }
}

/**
 * Copy for when the local hand-off itself failed. Must never claim the order was
 * saved, because it was not.
 */
export const HANDOFF_FAILED_MESSAGE =
  "Could not save this order on the device. The cart has been kept — please try again.";

// ── Bounded fetch ────────────────────────────────────────────────────────────

export interface BoundedRequest {
  signal: AbortSignal;
  /** True once our deadline has fired. */
  timedOut: () => boolean;
  /** Abort because the component is unmounting or the page is navigating. */
  teardown: () => void;
  tornDown: () => boolean;
  /** Always call this to release the timer. */
  dispose: () => void;
}

/**
 * Creates an abort signal that fires after `timeoutMs`, and can also be aborted
 * for teardown, keeping the two causes distinguishable.
 */
export function createBoundedRequest(timeoutMs: number): BoundedRequest {
  const controller = new AbortController();
  let didTimeout = false;
  let didTeardown = false;

  const timer = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);

  return {
    signal: controller.signal,
    timedOut: () => didTimeout,
    tornDown: () => didTeardown,
    teardown: () => {
      if (didTimeout) return; // the deadline already decided the outcome
      didTeardown = true;
      clearTimeout(timer);
      controller.abort();
    },
    dispose: () => clearTimeout(timer),
  };
}
