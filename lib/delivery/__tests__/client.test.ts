// The Dispatcher client: timeouts, uncertainty, idempotency keys, breaker.
// Run: npx tsx lib/delivery/__tests__/client.test.ts

import assert from "node:assert/strict";
import { CONTRACT_VERSION, type CreateDeliveryRequest } from "../contract";
import { DispatcherClient, backoffMs } from "../dispatcher-client";
import { verifySignature } from "../signature";

let passed = 0;
const test = async (name: string, fn: () => Promise<void> | void) => { await fn(); passed++; console.log(`  ✓ ${name}`); };
console.log("delivery/dispatcher-client");

const SECRET = "shared-signing-secret";
const T0 = 1_756_000_000_000;

type Call = { url: string; headers: Record<string, string>; body: string };

/** Records every attempt and replays a scripted sequence of responses. */
function fakeFetch(script: Array<{ status: number; body?: unknown } | "timeout" | "network">) {
  const calls: Call[] = [];
  let i = 0;
  const impl = (async (url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    calls.push({ url: String(url), headers, body: String(init.body ?? "") });
    const step = script[Math.min(i++, script.length - 1)];
    if (step === "timeout") {
      // Never resolves; the client's AbortController is what ends it.
      return new Promise<Response>((_, reject) => {
        (init.signal as AbortSignal).addEventListener("abort", () => reject(new Error("aborted")));
      });
    }
    if (step === "network") throw new Error("ECONNREFUSED");
    return {
      ok: step.status >= 200 && step.status < 300,
      status: step.status,
      json: async () => step.body ?? {},
      text: async () => JSON.stringify(step.body ?? {}),
    } as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const client = (fetchImpl: typeof fetch, over: Record<string, unknown> = {}) =>
  new DispatcherClient({
    baseUrl: "https://dispatcher.test/api", apiKey: "key-1", signingSecret: SECRET,
    fetchImpl, now: () => T0, ...over,
  });

const req = (over: Partial<CreateDeliveryRequest> = {}): CreateDeliveryRequest => ({
  contractVersion: CONTRACT_VERSION, correlationId: "corr-1", externalOrderId: "RF-1",
  quoteId: "QT-1", serviceType: "FOOD_STANDARD",
  pickup: { name: "Trisha's", address: "1 Rd", location: { lat: 6.45, lng: 3.39 }, contactPhone: "+2348000000000" },
  dropoff: { name: "Amaka", address: "2 Rd", location: { lat: 6.46, lng: 3.40 }, contactPhone: "+2348111111111" },
  readyAt: "2026-09-01T18:20:00Z", deliveryFeeMinor: 145000,
  paymentCollection: "NONE", packageDescription: "Hot food · 2 bags",
  ...over,
});

async function main() {

await test("[1] a successful create returns the job and signs the exact bytes sent", async () => {
  const f = fakeFetch([{ status: 201, body: { deliveryJobId: "DJ-1", replayed: false } }]);
  const r = await client(f.impl).createDelivery(req());
  assert.equal(r.ok, true);
  const call = f.calls[0];
  const v = verifySignature({
    secret: SECRET, rawBody: call.body, nowMs: T0,
    signatureHeader: call.headers["x-rf-signature"], timestampHeader: call.headers["x-rf-timestamp"],
  });
  assert.equal(v.ok, true, "the signature must cover the body actually transmitted");
});

await test("[2] the idempotency key is the marketplace order id", async () => {
  const f = fakeFetch([{ status: 201, body: {} }]);
  await client(f.impl).createDelivery(req({ externalOrderId: "RF-777" }));
  assert.equal(f.calls[0].headers["x-rf-idempotency-key"], "RF-777");
  assert.equal(f.calls[0].headers["x-rf-correlation-id"], "corr-1");
  assert.equal(f.calls[0].headers["x-rf-contract-version"], CONTRACT_VERSION);
});

await test("[3] RETRY REUSES THE KEY — this is what stops one order becoming three jobs", async () => {
  const f = fakeFetch([{ status: 503 }, { status: 503 }, { status: 201, body: { deliveryJobId: "DJ-1" } }]);
  const r = await client(f.impl).createDelivery(req({ externalOrderId: "RF-9" }));
  assert.equal(r.ok, true);
  assert.equal(f.calls.length, 3);
  const keys = new Set(f.calls.map((c) => c.headers["x-rf-idempotency-key"]));
  assert.deepEqual([...keys], ["RF-9"], "every attempt must carry the SAME key");
});

await test("[4] a timeout is uncertain and is retried", async () => {
  const f = fakeFetch(["timeout", { status: 201, body: { deliveryJobId: "DJ-1" } }]);
  const r = await client(f.impl).createDelivery(req());
  assert.equal(r.ok, true);
  assert.equal(f.calls.length, 2);
});

await test("[5] a timeout that never recovers reports `timeout`, not `network`", async () => {
  const f = fakeFetch(["timeout"]);
  const r = await client(f.impl, { maxAttempts: 1 }).createDelivery(req());
  assert.equal(r.ok, false);
  assert.equal((r as { failure: { kind: string } }).failure.kind, "timeout");
  assert.equal((r as { failure: { retryable: boolean } }).failure.retryable, true);
});

await test("[6] DEFINITE answers are never retried", async () => {
  for (const [status, kind] of [[401, "auth"], [409, "conflict"], [422, "unserviceable"], [426, "contract"], [400, "server_rejected"]] as const) {
    const f = fakeFetch([{ status }]);
    const r = await client(f.impl).createDelivery(req());
    assert.equal(r.ok, false, String(status));
    assert.equal((r as { failure: { kind: string } }).failure.kind, kind, String(status));
    assert.equal((r as { failure: { retryable: boolean } }).failure.retryable, false, String(status));
    assert.equal(f.calls.length, 1, `${status} must not be retried`);
  }
});

await test("[7] UNCERTAIN statuses are retried up to the attempt cap", async () => {
  for (const status of [408, 429, 500, 502, 503, 504]) {
    const f = fakeFetch([{ status }]);
    const r = await client(f.impl, { maxAttempts: 2 }).createDelivery(req());
    assert.equal(r.ok, false);
    assert.equal((r as { failure: { kind: string } }).failure.kind, "server_uncertain", String(status));
    assert.equal(f.calls.length, 2, String(status));
  }
});

await test("[8] a 409 conflict surfaces as a conflict, never as a duplicate create", async () => {
  const f = fakeFetch([{ status: 409 }]);
  const r = await client(f.impl).createDelivery(req());
  assert.equal((r as { failure: { kind: string } }).failure.kind, "conflict");
  assert.equal(f.calls.length, 1);
});

await test("[9] THE MONEY GUARD: a leaky payload is blocked BEFORE the network", async () => {
  const f = fakeFetch([{ status: 201, body: {} }]);
  const leaky = { ...req(), itemsTotal: 1_200_000 } as unknown as CreateDeliveryRequest;
  const r = await client(f.impl).createDelivery(leaky);
  assert.equal(r.ok, false);
  assert.equal((r as { failure: { kind: string } }).failure.kind, "contract");
  assert.equal(f.calls.length, 0, "nothing may leave the building");
});

await test("[10] no food or settlement field appears in a real serialised request", async () => {
  const f = fakeFetch([{ status: 201, body: {} }]);
  await client(f.impl).createDelivery(req());
  const sent = f.calls[0].body;
  for (const forbidden of ["itemsTotal", "restaurantPayable", "markup", "platformMargin", "customerId", "paymentReference"]) {
    assert.equal(sent.includes(forbidden), false, forbidden);
  }
  assert.equal(sent.includes("deliveryFeeMinor"), true, "the delivery fee IS sent — it is the only money field");
});

await test("[11] CIRCUIT BREAKER: repeated uncertainty stops calling out", async () => {
  const f = fakeFetch([{ status: 503 }]);
  const c = client(f.impl, { maxAttempts: 1 });
  for (let i = 0; i < 5; i++) await c.createDelivery(req());
  const callsBefore = f.calls.length;
  const r = await c.createDelivery(req());
  assert.equal((r as { failure: { kind: string } }).failure.kind, "disabled");
  assert.equal(f.calls.length, callsBefore, "the breaker must short-circuit the network");
});

await test("[12] the breaker allows a probe after the cooldown", async () => {
  const f = fakeFetch([{ status: 503 }]);
  let now = T0;
  const c = client(f.impl, { maxAttempts: 1, now: () => now });
  for (let i = 0; i < 5; i++) await c.createDelivery(req());
  assert.equal((await c.createDelivery(req())).ok, false);
  const before = f.calls.length;
  now = T0 + 31_000; // past the cooldown
  await c.createDelivery(req());
  assert.ok(f.calls.length > before, "one probe must be let through");
});

await test("[13] a definite failure does NOT count toward the breaker", async () => {
  const f = fakeFetch([{ status: 422 }]);
  const c = client(f.impl, { maxAttempts: 1 });
  for (let i = 0; i < 8; i++) await c.createDelivery(req());
  const r = await c.createDelivery(req());
  assert.equal((r as { failure: { kind: string } }).failure.kind, "unserviceable");
  assert.notEqual((r as { failure: { kind: string } }).failure.kind, "disabled");
});

await test("[14] a success resets the breaker's failure run", async () => {
  const f = fakeFetch([{ status: 503 }, { status: 503 }, { status: 503 }, { status: 201, body: {} }, { status: 503 }]);
  const c = client(f.impl, { maxAttempts: 1 });
  for (let i = 0; i < 5; i++) await c.createDelivery(req());
  const r = await c.createDelivery(req());
  assert.notEqual((r as { failure?: { kind: string } }).failure?.kind, "disabled");
});

await test("[15] a quote uses a short budget and at most two attempts", async () => {
  const f = fakeFetch([{ status: 503 }, { status: 503 }]);
  const r = await client(f.impl).quote({
    contractVersion: CONTRACT_VERSION, correlationId: "c1", externalRef: "cart-1",
    serviceType: "FOOD_STANDARD", pickup: { lat: 6.45, lng: 3.39 }, dropoff: { lat: 6.5, lng: 3.4 },
  });
  assert.equal(r.ok, false);
  assert.equal(f.calls.length, 2, "checkout cannot afford three rounds");
});

await test("[16] an unserviceable quote is a definite answer, not a failure to retry", async () => {
  const f = fakeFetch([{ status: 422, body: { serviceable: false, reason: "OUT_OF_RANGE" } }]);
  const r = await client(f.impl).quote({
    contractVersion: CONTRACT_VERSION, correlationId: "c1", externalRef: "cart-1",
    serviceType: "FOOD_STANDARD", pickup: { lat: 6.45, lng: 3.39 }, dropoff: { lat: 6.9, lng: 3.9 },
  });
  assert.equal((r as { failure: { kind: string } }).failure.kind, "unserviceable");
  assert.equal(f.calls.length, 1);
});

await test("[17] GET reads sign an empty body and send none", async () => {
  const f = fakeFetch([{ status: 200, body: { state: "EN_ROUTE_TO_CUSTOMER" } }]);
  await client(f.impl).getTracking({ externalOrderId: "RF-1", correlationId: "c1" });
  assert.equal(f.calls[0].body, "");
  assert.match(f.calls[0].url, /\/v1\/deliveries\/RF-1\/tracking$/);
});

await test("[18] path parameters are encoded, never interpolated raw", async () => {
  const f = fakeFetch([{ status: 200, body: {} }]);
  await client(f.impl).getDelivery({ externalOrderId: "RF/../admin", correlationId: "c1" });
  assert.equal(f.calls[0].url.includes("RF/../admin"), false);
  assert.match(f.calls[0].url, /RF%2F\.\.%2Fadmin/);
});

await test("[19] confirm and cancel carry their own idempotency keys", async () => {
  const f = fakeFetch([{ status: 200, body: {} }, { status: 200, body: {} }]);
  const c = client(f.impl);
  await c.confirmDelivery({ externalOrderId: "RF-1", correlationId: "c1" });
  await c.cancelDelivery({ contractVersion: CONTRACT_VERSION, correlationId: "c1", externalOrderId: "RF-1", cancelledBy: "CUSTOMER", reason: "changed mind" });
  assert.equal(f.calls[0].headers["x-rf-idempotency-key"], "RF-1:confirm");
  assert.equal(f.calls[1].headers["x-rf-idempotency-key"], "RF-1:cancel");
});

await test("[20] backoff grows and stays inside its jitter band", () => {
  for (const [attempt, base] of [[1, 250], [2, 750], [3, 2000]] as const) {
    for (let i = 0; i < 50; i++) {
      const ms = backoffMs(attempt);
      assert.ok(ms >= base * 0.8 - 1 && ms <= base * 1.2 + 1, `attempt ${attempt}: ${ms}`);
    }
  }
});

}

main().then(() => {
  console.log(`\n${passed} checks passed\n`);
}).catch((err) => { console.error(err); process.exit(1); });
