/**
 * Paystack webhook signature verification for the shared relay.
 *
 * ── The defect this exists to fix ───────────────────────────────────────────
 * The relay verified every event against a single `PAYSTACK_SECRET_KEY`.
 * Paystack signs TEST events with the TEST secret and LIVE events with the LIVE
 * secret, and this relay's secret is the live one — so every test event was
 * rejected 401 at the signature gate, before `metadata.project` was ever read
 * and before any forward was attempted.
 *
 * CintaMart's test payments were the visible symptom: three successful Paystack
 * TEST charges, none of which reached `WEBHOOK_URL_CINTAMART`. Each was settled
 * by the buyer's browser callback instead, which is a recovery path, not a
 * substitute for delivery.
 *
 * Verification now accepts an event signed by EITHER configured secret. Live
 * behaviour is unchanged: the live secret is still tried, still first, and an
 * event it signs still matches exactly as before.
 */
import { createHmac, timingSafeEqual } from "crypto";

/** Which secret matched. Internal only — never returned to a caller. */
export type SignatureSource = "live" | "test";

export interface SignatureCheck {
  ok: boolean;
  /** For server-side logging only. Never put this in an HTTP response. */
  source?: SignatureSource;
  reason?: "missing_signature" | "no_secrets_configured" | "invalid_signature";
}

/**
 * Constant-time comparison of two hex digests.
 *
 * `timingSafeEqual` throws when the buffers differ in length, so length is
 * checked first — and a length mismatch is itself a mismatch, returned without
 * comparing. Paystack's signature is a 128-character SHA-512 hex digest, so an
 * attacker cannot use length alone to learn anything about the secret.
 */
function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Verify `signature` against the raw body using each configured secret.
 *
 * The RAW body is required: re-serialising JSON changes bytes (key order,
 * whitespace, unicode escaping) and the digest with it. The caller must pass
 * exactly what arrived on the wire.
 *
 * With no secrets configured this returns `ok: false`. It must never fall open —
 * a relay that forwards unsigned events is worse than one that forwards none.
 */
export function verifyPaystackSignature(
  rawBody: string,
  signature: string | null | undefined,
  secrets: { live?: string | null; test?: string | null },
): SignatureCheck {
  if (!signature) return { ok: false, reason: "missing_signature" };

  const candidates: Array<{ source: SignatureSource; secret: string }> = [];
  // Live first: it is the overwhelmingly common case in production, and trying
  // it first keeps the existing path's behaviour identical.
  if (secrets.live) candidates.push({ source: "live", secret: secrets.live });
  if (secrets.test) candidates.push({ source: "test", secret: secrets.test });

  if (candidates.length === 0) return { ok: false, reason: "no_secrets_configured" };

  let match: SignatureSource | undefined;
  for (const { source, secret } of candidates) {
    const expected = createHmac("sha512", secret).update(rawBody).digest("hex");
    // Deliberately no early break: every candidate is compared so the work done
    // does not reveal which secret matched, or how many were tried.
    if (safeEqualHex(signature, expected) && !match) match = source;
  }

  return match ? { ok: true, source: match } : { ok: false, reason: "invalid_signature" };
}

/**
 * Where a verified event should be forwarded.
 *
 * Unchanged in behaviour from the original inline logic, with one correction:
 * targets are de-duplicated. Two env vars holding the same URL would otherwise
 * cause the same event to be POSTed twice, which for a payment webhook means a
 * duplicate delivery the receiver has to defend against.
 */
export function resolveTargets(
  project: string | undefined,
  env: Record<string, string | undefined>,
): string[] {
  const urls = project
    ? [env[`WEBHOOK_URL_${project.toUpperCase()}`]]
    : Object.entries(env)
        .filter(([key, val]) => key.startsWith("WEBHOOK_URL_") && val)
        .map(([, val]) => val);

  return Array.from(new Set(urls.filter((u): u is string => typeof u === "string" && u.length > 0)));
}
