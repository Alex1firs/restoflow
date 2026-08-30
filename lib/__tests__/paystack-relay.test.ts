/**
 * Paystack relay signature + routing tests.
 * Run: npx tsx lib/__tests__/paystack-relay.test.ts
 *
 * These cover the production defect where the relay verified every event
 * against a single `PAYSTACK_SECRET_KEY`. Paystack signs TEST events with the
 * TEST secret and LIVE events with the LIVE secret, so every test event was
 * rejected 401 at the signature gate — before `metadata.project` was read and
 * before any forward was attempted. Three successful CintaMart TEST payments
 * produced no webhook delivery at all.
 *
 * The live path is the one that must not move: Dispatcher's real money flows
 * through it, so "a live signature is still accepted, unchanged" is asserted
 * first and in isolation.
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { resolveTargets, verifyPaystackSignature } from "../paystack-relay-signature";

const LIVE = "sk_live_pretend_secret_value";
const TEST = "sk_test_pretend_secret_value";

const body = (project?: string) =>
  JSON.stringify({
    event: "charge.success",
    data: { reference: "PSK-ORD-20260830-V6P4A0-50D0", metadata: project ? { project } : {} },
  });

const sign = (raw: string, secret: string) =>
  createHmac("sha512", secret).update(raw).digest("hex");

let passed = 0;
const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

// ── Live behaviour must be identical to before ──────────────────────────────
test("a valid LIVE signature is accepted", () => {
  const raw = body("dispatcher");
  const r = verifyPaystackSignature(raw, sign(raw, LIVE), { live: LIVE, test: TEST });
  assert.equal(r.ok, true);
  assert.equal(r.source, "live");
});

test("a valid LIVE signature is accepted when no test secret is configured", () => {
  // The exact deployed shape today. This is the assertion that proves the
  // change cannot break Dispatcher's live traffic.
  const raw = body("dispatcher");
  const r = verifyPaystackSignature(raw, sign(raw, LIVE), { live: LIVE, test: undefined });
  assert.equal(r.ok, true);
  assert.equal(r.source, "live");
});

test("a valid LIVE signature is accepted when the test secret is empty string", () => {
  const raw = body();
  assert.equal(verifyPaystackSignature(raw, sign(raw, LIVE), { live: LIVE, test: "" }).ok, true);
});

// ── The fix ─────────────────────────────────────────────────────────────────
test("a valid TEST signature is accepted", () => {
  const raw = body("cintamart");
  const r = verifyPaystackSignature(raw, sign(raw, TEST), { live: LIVE, test: TEST });
  assert.equal(r.ok, true);
  assert.equal(r.source, "test");
});

test("a TEST signature is rejected when no test secret is configured — the original bug", () => {
  const raw = body("cintamart");
  const r = verifyPaystackSignature(raw, sign(raw, TEST), { live: LIVE });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "invalid_signature");
});

// ── Rejections ──────────────────────────────────────────────────────────────
test("an invalid signature is rejected", () => {
  const raw = body("cintamart");
  const r = verifyPaystackSignature(raw, sign(raw, "sk_someone_elses_secret"), { live: LIVE, test: TEST });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "invalid_signature");
});

test("a missing signature is rejected", () => {
  assert.equal(verifyPaystackSignature(body(), null, { live: LIVE, test: TEST }).reason, "missing_signature");
  assert.equal(verifyPaystackSignature(body(), undefined, { live: LIVE, test: TEST }).reason, "missing_signature");
  assert.equal(verifyPaystackSignature(body(), "", { live: LIVE, test: TEST }).reason, "missing_signature");
});

test("with NO secrets configured nothing is accepted — it must not fall open", () => {
  const raw = body();
  const r = verifyPaystackSignature(raw, sign(raw, LIVE), {});
  assert.equal(r.ok, false);
  assert.equal(r.reason, "no_secrets_configured");
  // And a forged signature is equally refused.
  assert.equal(verifyPaystackSignature(raw, "deadbeef", {}).ok, false);
});

test("a signature of the wrong length is rejected without throwing", () => {
  // timingSafeEqual throws on unequal buffers; the length guard must catch it.
  const raw = body();
  assert.equal(verifyPaystackSignature(raw, "abc123", { live: LIVE, test: TEST }).ok, false);
});

// ── Raw body integrity ──────────────────────────────────────────────────────
test("verification is over the exact bytes — re-serialising breaks it", () => {
  // Why the route must never JSON.parse then re-stringify before verifying.
  const raw = '{"event":"charge.success","data":{"reference":"R1","metadata":{"project":"cintamart"}}}';
  const signature = sign(raw, TEST);
  assert.equal(verifyPaystackSignature(raw, signature, { live: LIVE, test: TEST }).ok, true);

  const reserialised = JSON.stringify(JSON.parse(raw));
  const spaced = JSON.stringify(JSON.parse(raw), null, 2);
  assert.notEqual(spaced, raw);
  assert.equal(verifyPaystackSignature(spaced, signature, { live: LIVE, test: TEST }).ok, false);
  // Even a byte-identical round trip is only safe by luck; assert the property
  // that matters rather than the coincidence.
  assert.equal(
    verifyPaystackSignature(reserialised, signature, { live: LIVE, test: TEST }).ok,
    reserialised === raw,
  );
});

// ── Routing ─────────────────────────────────────────────────────────────────
const ENV = {
  WEBHOOK_URL_CINTAMART: "https://api.cintamart.com/webhooks/paystack",
  WEBHOOK_URL_DISPATCHER: "https://dispatcher.example/hook",
  UNRELATED: "ignore-me",
};

test("project=cintamart routes ONLY to WEBHOOK_URL_CINTAMART", () => {
  assert.deepEqual(resolveTargets("cintamart", ENV), ["https://api.cintamart.com/webhooks/paystack"]);
});

test("project matching is case-insensitive on the tag", () => {
  assert.deepEqual(resolveTargets("CintaMart", ENV), ["https://api.cintamart.com/webhooks/paystack"]);
});

test("an unknown project routes nowhere — unchanged behaviour", () => {
  assert.deepEqual(resolveTargets("nosuchproject", ENV), []);
});

test("an untagged event still broadcasts to every configured target — unchanged", () => {
  const t = resolveTargets(undefined, ENV);
  assert.equal(t.length, 2);
  assert.ok(t.includes("https://api.cintamart.com/webhooks/paystack"));
  assert.ok(t.includes("https://dispatcher.example/hook"));
  assert.ok(!t.includes("ignore-me"));
});

test("duplicate URLs across env vars forward only once", () => {
  const dupes = {
    WEBHOOK_URL_A: "https://same.example/hook",
    WEBHOOK_URL_B: "https://same.example/hook",
  };
  assert.deepEqual(resolveTargets(undefined, dupes), ["https://same.example/hook"]);
});

test("empty or missing target values are skipped", () => {
  assert.deepEqual(resolveTargets("cintamart", { WEBHOOK_URL_CINTAMART: "" }), []);
  assert.deepEqual(resolveTargets(undefined, { WEBHOOK_URL_X: undefined }), []);
});

(async () => {
  for (const [name, fn] of tests) {
    try {
      fn();
      passed += 1;
      console.log(`  ok  ${name}`);
    } catch (err) {
      console.error(`  FAIL  ${name}`);
      console.error(err);
      process.exit(1);
    }
  }
  console.log(`\n${passed}/${tests.length} passed`);
})();
