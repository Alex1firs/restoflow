// Signing, replay protection and tamper detection.
// Run: npx tsx lib/delivery/__tests__/signature.test.ts

import assert from "node:assert/strict";
import { computeSignature, verifySignature, signedHeaders, DEFAULT_CLOCK_SKEW_MS } from "../signature";

let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`  ✓ ${name}`); };
console.log("delivery/signature");

const SECRET = "s3cret-shared-with-dispatcher";
const NOW = 1_756_000_000_000;
const BODY = JSON.stringify({ eventId: "evt-1", state: "PICKED_UP" });

const verify = (over: Partial<Parameters<typeof verifySignature>[0]> = {}) =>
  verifySignature({
    secret: SECRET, rawBody: BODY, nowMs: NOW,
    signatureHeader: computeSignature(SECRET, NOW, BODY),
    timestampHeader: String(NOW),
    ...over,
  });

test("[1] a correctly signed request verifies", () => {
  const r = verify();
  assert.equal(r.ok, true);
  assert.equal((r as { timestampMs: number }).timestampMs, NOW);
});

test("[2] signature is deterministic and secret-dependent", () => {
  assert.equal(computeSignature(SECRET, NOW, BODY), computeSignature(SECRET, NOW, BODY));
  assert.notEqual(computeSignature(SECRET, NOW, BODY), computeSignature("other", NOW, BODY));
  assert.match(computeSignature(SECRET, NOW, BODY), /^v1=[0-9a-f]{64}$/);
});

test("[3] a tampered body fails — even a single character", () => {
  const r = verify({ rawBody: BODY.replace("PICKED_UP", "DELIVERED") });
  assert.equal(r.ok, false);
  assert.equal((r as { code: string }).code, "mismatch");
});

test("[4] a wrong secret fails", () => {
  const r = verifySignature({
    secret: "wrong", rawBody: BODY, nowMs: NOW,
    signatureHeader: computeSignature(SECRET, NOW, BODY), timestampHeader: String(NOW),
  });
  assert.equal(r.ok, false);
  assert.equal((r as { code: string }).code, "mismatch");
});

test("[5] REPLAY: a valid capture is refused once outside the skew window", () => {
  const old = NOW - DEFAULT_CLOCK_SKEW_MS - 1_000;
  const r = verifySignature({
    secret: SECRET, rawBody: BODY, nowMs: NOW,
    signatureHeader: computeSignature(SECRET, old, BODY), timestampHeader: String(old),
  });
  assert.equal(r.ok, false);
  assert.equal((r as { code: string }).code, "expired");
});

test("[6] a request just inside the window is still accepted", () => {
  const recent = NOW - DEFAULT_CLOCK_SKEW_MS + 1_000;
  const r = verifySignature({
    secret: SECRET, rawBody: BODY, nowMs: NOW,
    signatureHeader: computeSignature(SECRET, recent, BODY), timestampHeader: String(recent),
  });
  assert.equal(r.ok, true);
});

test("[7] a far-future timestamp is refused — it would extend the replay window", () => {
  const future = NOW + DEFAULT_CLOCK_SKEW_MS + 1_000;
  const r = verifySignature({
    secret: SECRET, rawBody: BODY, nowMs: NOW,
    signatureHeader: computeSignature(SECRET, future, BODY), timestampHeader: String(future),
  });
  assert.equal(r.ok, false);
  assert.equal((r as { code: string }).code, "future");
});

test("[8] the timestamp is inside the signed material — it cannot be moved", () => {
  // Take a valid old signature and simply relabel it as fresh.
  const old = NOW - 60_000;
  const r = verifySignature({
    secret: SECRET, rawBody: BODY, nowMs: NOW,
    signatureHeader: computeSignature(SECRET, old, BODY),
    timestampHeader: String(NOW), // lying about when it was signed
  });
  assert.equal(r.ok, false);
  assert.equal((r as { code: string }).code, "mismatch");
});

test("[9] missing and malformed headers each get their own code", () => {
  assert.equal((verify({ signatureHeader: null }) as { code: string }).code, "missing_signature");
  assert.equal((verify({ timestampHeader: null }) as { code: string }).code, "missing_timestamp");
  assert.equal((verify({ timestampHeader: "not-a-number" }) as { code: string }).code, "malformed_timestamp");
  assert.equal((verify({ timestampHeader: "1.5" }) as { code: string }).code, "malformed_timestamp");
  assert.equal((verify({ signatureHeader: "v2=abc" }) as { code: string }).code, "malformed_signature");
});

test("[10] a truncated signature of the wrong length is refused, not compared", () => {
  const r = verify({ signatureHeader: "v1=abcd" });
  assert.equal(r.ok, false);
  assert.equal((r as { code: string }).code, "mismatch");
});

test("[11] signedHeaders produces a self-consistent, verifiable set", () => {
  const h = signedHeaders({
    secret: SECRET, apiKey: "key-1", rawBody: BODY, nowMs: NOW,
    correlationId: "corr-1", contractVersion: "1.0.0", idempotencyKey: "RF-1",
  });
  assert.equal(h["x-rf-api-key"], "key-1");
  assert.equal(h["x-rf-idempotency-key"], "RF-1");
  assert.equal(h["x-rf-correlation-id"], "corr-1");
  const r = verifySignature({
    secret: SECRET, rawBody: BODY, nowMs: NOW,
    signatureHeader: h["x-rf-signature"], timestampHeader: h["x-rf-timestamp"],
  });
  assert.equal(r.ok, true);
});

test("[12] the signing secret never appears in the headers", () => {
  const h = signedHeaders({
    secret: SECRET, apiKey: "key-1", rawBody: BODY, nowMs: NOW,
    correlationId: "corr-1", contractVersion: "1.0.0",
  });
  assert.equal(JSON.stringify(h).includes(SECRET), false);
});

console.log(`\n${passed} checks passed\n`);
