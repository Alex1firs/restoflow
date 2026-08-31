/**
 * The ONE module in RestoFlow that talks to Dispatcher.
 *
 * Everything else — routes, the reconciler, the operations surface — goes
 * through this. A single chokepoint is what makes the integration testable with
 * a fake transport, swappable if a second logistics provider ever appears, and
 * auditable: if a food price ever reached Dispatcher, it would have to pass
 * through here, and here is where that is asserted against.
 *
 * ── Failure classification, deliberately ────────────────────────────────────
 * The governing question on every failure is NOT "what status code came back?"
 * but "do we know whether Dispatcher acted?". A timeout and a 502 look
 * different and mean the same thing: unknown. Unknown means retry with the SAME
 * idempotency key — never mint a new one, because a new key is how one order
 * becomes three delivery jobs. This is the same lesson the POS work paid for.
 */

import {
  CONTRACT_VERSION,
  type CreateDeliveryRequest,
  type CreateDeliveryResponse,
  type DeliveryCancellationRequest,
  type DeliveryCancellationResponse,
  type DeliveryQuoteRequest,
  type DeliveryQuoteResponse,
  type DeliveryTrackingResponse,
  findForbiddenKeys,
} from "./contract";
import { signedHeaders } from "./signature";

export const QUOTE_TIMEOUT_MS = 6_000;   // in a checkout path: fail fast
export const CREATE_TIMEOUT_MS = 12_000; // creates a job: give it room
export const READ_TIMEOUT_MS = 8_000;

/** Retryable because they carry no information about whether the work happened. */
const UNCERTAIN_STATUSES = [408, 425, 429, 500, 502, 503, 504];

export type ClientConfig = {
  baseUrl: string;
  apiKey: string;
  signingSecret: string;
  /** Injected so tests never touch the network and never wait on real time. */
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Bounded, jittered. Only ever applied to UNCERTAIN outcomes. */
  maxAttempts?: number;
  log?: (event: string, fields: Record<string, unknown>) => void;
};

export type CallFailure = {
  kind:
    | "unserviceable"   // a definite, meaningful "no" — not a failure to retry
    | "timeout"
    | "network"
    | "server_uncertain" // 5xx / 429: may or may not have happened
    | "server_rejected"  // 4xx: definitely did not happen, and will not
    | "conflict"         // same key, materially different payload
    | "auth"
    | "contract"         // version or shape mismatch — a deploy problem
    | "disabled";        // circuit open, or the integration flag is off
  status?: number;
  message: string;
  /** True when a retry with the same idempotency key is the correct response. */
  retryable: boolean;
};

export type CallResult<T> = { ok: true; value: T } | { ok: false; failure: CallFailure };

/**
 * Trip the breaker after this many consecutive uncertain failures, so a
 * Dispatcher outage degrades checkout in milliseconds instead of six seconds
 * per customer. Deliberately small: with one restaurant per cart, a handful of
 * failures in a row is already conclusive.
 */
const BREAKER_THRESHOLD = 5;
const BREAKER_COOLDOWN_MS = 30_000;

export class DispatcherClient {
  private readonly cfg: Required<Omit<ClientConfig, "log">> & { log: NonNullable<ClientConfig["log"]> };
  private consecutiveFailures = 0;
  private breakerOpenedAt = 0;

  constructor(config: ClientConfig) {
    this.cfg = {
      baseUrl: config.baseUrl.replace(/\/+$/, ""),
      apiKey: config.apiKey,
      signingSecret: config.signingSecret,
      fetchImpl: config.fetchImpl ?? fetch,
      now: config.now ?? (() => Date.now()),
      maxAttempts: config.maxAttempts ?? 3,
      log: config.log ?? (() => {}),
    };
  }

  /** Serviceability, fee and ETA. Never retried past the checkout budget. */
  async quote(req: DeliveryQuoteRequest): Promise<CallResult<DeliveryQuoteResponse>> {
    return this.call<DeliveryQuoteResponse>({
      path: "/v1/delivery/quote",
      body: req,
      timeoutMs: QUOTE_TIMEOUT_MS,
      correlationId: req.correlationId,
      // A quote is safe to repeat and cheap to lose; one retry is plenty inside
      // a customer-facing checkout.
      maxAttempts: 2,
    });
  }

  /**
   * Create (or replay) the delivery job.
   *
   * `externalOrderId` is the idempotency key and is sent in the header as well
   * as the body. It is NEVER regenerated: every retry for this order, in this
   * process or a later one, carries the same value.
   */
  async createDelivery(req: CreateDeliveryRequest): Promise<CallResult<CreateDeliveryResponse>> {
    const leaked = findForbiddenKeys(req);
    if (leaked.length > 0) {
      // Refuse to send rather than leak. Dispatcher computes rider commission
      // from the money field we give it, so a food total arriving here would
      // silently pay commission on the food.
      this.cfg.log("dispatcher_payload_blocked", { correlationId: req.correlationId, keys: leaked });
      return { ok: false, failure: { kind: "contract", message: `payload contains forbidden keys: ${leaked.join(", ")}`, retryable: false } };
    }
    return this.call<CreateDeliveryResponse>({
      path: "/v1/deliveries",
      body: req,
      timeoutMs: CREATE_TIMEOUT_MS,
      correlationId: req.correlationId,
      idempotencyKey: req.externalOrderId,
    });
  }

  /** Release a drafted job to riders. Idempotent on the Dispatcher side. */
  async confirmDelivery(args: { externalOrderId: string; correlationId: string }): Promise<CallResult<CreateDeliveryResponse>> {
    return this.call<CreateDeliveryResponse>({
      path: `/v1/deliveries/${encodeURIComponent(args.externalOrderId)}/confirm`,
      body: { contractVersion: CONTRACT_VERSION, correlationId: args.correlationId, externalOrderId: args.externalOrderId },
      timeoutMs: CREATE_TIMEOUT_MS,
      correlationId: args.correlationId,
      idempotencyKey: `${args.externalOrderId}:confirm`,
    });
  }

  async cancelDelivery(req: DeliveryCancellationRequest): Promise<CallResult<DeliveryCancellationResponse>> {
    return this.call<DeliveryCancellationResponse>({
      path: `/v1/deliveries/${encodeURIComponent(req.externalOrderId)}/cancel`,
      body: req,
      timeoutMs: CREATE_TIMEOUT_MS,
      correlationId: req.correlationId,
      idempotencyKey: `${req.externalOrderId}:cancel`,
    });
  }

  /** Authoritative read. Used by the reconciler and by the tracking gateway. */
  async getDelivery(args: { externalOrderId: string; correlationId: string }): Promise<CallResult<CreateDeliveryResponse>> {
    return this.call<CreateDeliveryResponse>({
      path: `/v1/deliveries/${encodeURIComponent(args.externalOrderId)}`,
      method: "GET",
      timeoutMs: READ_TIMEOUT_MS,
      correlationId: args.correlationId,
    });
  }

  /** Narrow location projection. The only path by which a position reaches a customer. */
  async getTracking(args: { externalOrderId: string; correlationId: string }): Promise<CallResult<DeliveryTrackingResponse>> {
    return this.call<DeliveryTrackingResponse>({
      path: `/v1/deliveries/${encodeURIComponent(args.externalOrderId)}/tracking`,
      method: "GET",
      timeoutMs: READ_TIMEOUT_MS,
      correlationId: args.correlationId,
      maxAttempts: 1, // a polled endpoint: the next poll is the retry
    });
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private breakerOpen(): boolean {
    if (this.consecutiveFailures < BREAKER_THRESHOLD) return false;
    if (this.cfg.now() - this.breakerOpenedAt > BREAKER_COOLDOWN_MS) {
      // Cooldown elapsed: allow exactly one probe through. If it fails the
      // counter stays at threshold and the breaker re-opens immediately.
      this.consecutiveFailures = BREAKER_THRESHOLD - 1;
      return false;
    }
    return true;
  }

  private recordFailure() {
    this.consecutiveFailures++;
    if (this.consecutiveFailures === BREAKER_THRESHOLD) this.breakerOpenedAt = this.cfg.now();
  }

  private recordSuccess() {
    this.consecutiveFailures = 0;
  }

  private async call<T>(args: {
    path: string;
    body?: unknown;
    method?: "GET" | "POST";
    timeoutMs: number;
    correlationId: string;
    idempotencyKey?: string;
    maxAttempts?: number;
  }): Promise<CallResult<T>> {
    if (this.breakerOpen()) {
      this.cfg.log("dispatcher_breaker_open", { correlationId: args.correlationId, path: args.path });
      return { ok: false, failure: { kind: "disabled", message: "Dispatcher is unavailable", retryable: true } };
    }

    const method = args.method ?? "POST";
    // Serialise ONCE. The signature covers these exact bytes, so re-stringifying
    // for the request body would be a subtle way to sign something we did not send.
    const rawBody = method === "GET" ? "" : JSON.stringify(args.body ?? {});
    const attempts = args.maxAttempts ?? this.cfg.maxAttempts;

    let last: CallFailure = { kind: "network", message: "no attempt made", retryable: true };

    for (let attempt = 1; attempt <= attempts; attempt++) {
      const outcome = await this.attempt<T>({ ...args, method, rawBody, attempt });

      if (outcome.ok) {
        this.recordSuccess();
        return outcome;
      }

      last = outcome.failure;
      if (!outcome.failure.retryable) {
        // A definite answer is not a breaker event: Dispatcher is healthy and
        // told us something true. Only uncertainty counts against it.
        if (outcome.failure.kind !== "unserviceable") this.cfg.log("dispatcher_call_rejected", { correlationId: args.correlationId, path: args.path, kind: outcome.failure.kind, status: outcome.failure.status });
        return outcome;
      }

      if (attempt < attempts) {
        await sleep(backoffMs(attempt));
      }
    }

    this.recordFailure();
    this.cfg.log("dispatcher_call_failed", {
      correlationId: args.correlationId, path: args.path, attempts, kind: last.kind, status: last.status,
    });
    return { ok: false, failure: last };
  }

  private async attempt<T>(args: {
    path: string; method: "GET" | "POST"; rawBody: string;
    timeoutMs: number; correlationId: string; idempotencyKey?: string; attempt: number;
  }): Promise<CallResult<T>> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, args.timeoutMs);

    try {
      const now = this.cfg.now();
      const headers = signedHeaders({
        secret: this.cfg.signingSecret,
        apiKey: this.cfg.apiKey,
        rawBody: args.rawBody,
        nowMs: now,
        correlationId: args.correlationId,
        contractVersion: CONTRACT_VERSION,
        idempotencyKey: args.idempotencyKey,
      });
      headers["x-rf-attempt"] = String(args.attempt);

      const res = await this.cfg.fetchImpl(`${this.cfg.baseUrl}${args.path}`, {
        method: args.method,
        headers,
        body: args.method === "GET" ? undefined : args.rawBody,
        signal: controller.signal,
      });

      if (res.ok) {
        const value = (await res.json()) as T;
        return { ok: true, value };
      }

      const status = res.status;
      const text = await res.text().catch(() => "");

      if (status === 401 || status === 403) {
        return { ok: false, failure: { kind: "auth", status, message: "Dispatcher rejected our credentials", retryable: false } };
      }
      if (status === 409) {
        return { ok: false, failure: { kind: "conflict", status, message: "same order reference, different delivery payload", retryable: false } };
      }
      if (status === 422) {
        return { ok: false, failure: { kind: "unserviceable", status, message: text || "not serviceable", retryable: false } };
      }
      if (status === 426) {
        return { ok: false, failure: { kind: "contract", status, message: "contract version rejected by Dispatcher", retryable: false } };
      }
      if (UNCERTAIN_STATUSES.includes(status)) {
        return { ok: false, failure: { kind: "server_uncertain", status, message: text || `Dispatcher returned ${status}`, retryable: true } };
      }
      return { ok: false, failure: { kind: "server_rejected", status, message: text || `Dispatcher returned ${status}`, retryable: false } };

    } catch (err) {
      // An abort from OUR timer is a timeout; an abort from anywhere else is a
      // teardown we must not mistake for one. Keeping them distinguishable is
      // what stops a deploy-time cancellation from being retried as an outage.
      if (timedOut) {
        return { ok: false, failure: { kind: "timeout", message: `no response within ${args.timeoutMs}ms`, retryable: true } };
      }
      const message = err instanceof Error ? err.message : "network failure";
      return { ok: false, failure: { kind: "network", message, retryable: true } };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** 250ms, 750ms, 2s — with ±20% jitter so retries from many orders do not align. */
export function backoffMs(attempt: number): number {
  const base = [250, 750, 2_000][Math.min(attempt - 1, 2)];
  const jitter = base * 0.2 * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(base + jitter));
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
