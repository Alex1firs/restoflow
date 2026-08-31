/**
 * Request and event signing for the RestoFlow ⇄ Dispatcher boundary.
 *
 * An API key alone is a bearer secret: whoever holds it is RestoFlow. Signing
 * adds two properties a bearer secret cannot give on its own —
 *
 *   1. A leaked key is not sufficient to forge a call, because the signing
 *      secret is separate and never travels on the wire.
 *   2. A captured call cannot be replayed later, because the timestamp is
 *      inside the signed material and is range-checked on arrival.
 *
 * Both directions use the same scheme so there is one implementation to reason
 * about, one set of tests, and one mirrored copy in the Dispatcher repo
 * (functions/integration/signature.js).
 *
 * Signed material is `${timestamp}.${rawBody}` — the raw bytes as received, NOT
 * a re-serialised object. Re-serialising is the classic way a signature check
 * passes on the sender and fails on the receiver (key order, unicode escaping,
 * float formatting), so every caller must keep the exact string it sent or read.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/** How far apart the two clocks may be before a request is refused. */
export const DEFAULT_CLOCK_SKEW_MS = 5 * 60_000;

export const SIGNATURE_PREFIX = "v1=";

/** Deterministic signature over (timestamp, rawBody) with a shared secret. */
export function computeSignature(secret: string, timestampMs: number, rawBody: string): string {
  const mac = createHmac("sha256", secret);
  mac.update(`${timestampMs}.${rawBody}`);
  return SIGNATURE_PREFIX + mac.digest("hex");
}

export type VerifyInput = {
  secret: string;
  rawBody: string;
  /** The header value exactly as received. */
  signatureHeader: string | null | undefined;
  /** The header value exactly as received. */
  timestampHeader: string | null | undefined;
  nowMs: number;
  skewMs?: number;
};

export type VerifyResult =
  | { ok: true; timestampMs: number }
  | { ok: false; code: VerifyFailure; message: string };

export type VerifyFailure =
  | "missing_signature"
  | "missing_timestamp"
  | "malformed_timestamp"
  | "expired"
  | "future"
  | "malformed_signature"
  | "mismatch";

/**
 * Verify a signed request or event.
 *
 * Order matters: cheap structural checks first, the constant-time comparison
 * last. Every failure is a distinct code so an operator can tell a clock-skew
 * problem (fixable) from a wrong-secret problem (also fixable, differently)
 * from an actual forgery attempt — but the CALLER must collapse them to one
 * generic 401 on the wire, because distinguishing them to an attacker turns the
 * endpoint into an oracle.
 */
export function verifySignature(input: VerifyInput): VerifyResult {
  const { secret, rawBody, signatureHeader, timestampHeader, nowMs } = input;
  const skewMs = input.skewMs ?? DEFAULT_CLOCK_SKEW_MS;

  if (!signatureHeader) return fail("missing_signature", "signature header absent");
  if (!timestampHeader) return fail("missing_timestamp", "timestamp header absent");

  const timestampMs = Number(timestampHeader);
  if (!Number.isFinite(timestampMs) || !Number.isInteger(timestampMs) || timestampMs <= 0) {
    return fail("malformed_timestamp", "timestamp is not an integer epoch-ms value");
  }

  const age = nowMs - timestampMs;
  if (age > skewMs) return fail("expired", `request is ${Math.round(age / 1000)}s old`);
  // A timestamp in the future is not merely odd — it would extend the replay
  // window arbitrarily, so it is refused with the same firmness as an old one.
  if (age < -skewMs) return fail("future", "timestamp is too far in the future");

  if (!signatureHeader.startsWith(SIGNATURE_PREFIX)) {
    return fail("malformed_signature", "unrecognised signature version");
  }

  const expected = computeSignature(secret, timestampMs, rawBody);

  // Buffers must be equal length before timingSafeEqual, and that length check
  // is itself non-constant-time — which is fine: the length of a hex digest is
  // public. Comparing the digests rather than the raw headers keeps the compare
  // fixed-width regardless of what an attacker sends.
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signatureHeader, "utf8");
  if (a.length !== b.length) return fail("mismatch", "signature does not match");
  if (!timingSafeEqual(a, b)) return fail("mismatch", "signature does not match");

  return { ok: true, timestampMs };
}

function fail(code: VerifyFailure, message: string): VerifyResult {
  return { ok: false, code, message };
}

/** Headers a signed outbound call must carry. */
export function signedHeaders(args: {
  secret: string;
  apiKey: string;
  rawBody: string;
  nowMs: number;
  correlationId: string;
  contractVersion: string;
  idempotencyKey?: string;
}): Record<string, string> {
  const h: Record<string, string> = {
    "content-type": "application/json",
    "x-rf-api-key": args.apiKey,
    "x-rf-timestamp": String(args.nowMs),
    "x-rf-signature": computeSignature(args.secret, args.nowMs, args.rawBody),
    "x-rf-correlation-id": args.correlationId,
    "x-rf-contract-version": args.contractVersion,
  };
  if (args.idempotencyKey) h["x-rf-idempotency-key"] = args.idempotencyKey;
  return h;
}
