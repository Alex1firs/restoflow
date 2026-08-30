import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { resolveTargets, verifyPaystackSignature } from "@/lib/paystack-relay-signature";

export async function POST(req: NextRequest) {
  // The RAW body, captured before anything parses it. Every downstream step —
  // our own HMAC and the receiver's independent one — is computed over these
  // exact bytes, so it is never re-serialised.
  const rawBody = await req.text();

  const signature = req.headers.get("x-paystack-signature");

  // Paystack signs TEST events with the TEST secret and LIVE events with the
  // LIVE secret. Verifying against only one meant every event of the other kind
  // was rejected here, before routing — which is why CintaMart's test payments
  // never arrived. Either secret is now accepted; neither is logged, and which
  // one matched is never disclosed in a response.
  const check = verifyPaystackSignature(rawBody, signature, {
    live: process.env.PAYSTACK_SECRET_KEY,
    test: process.env.PAYSTACK_TEST_SECRET_KEY,
  });

  if (!check.ok) {
    // Observability for the failure that hid this bug for three payments: a 401
    // returned before any dead-letter write, so a misconfigured relay looked
    // healthy from Paystack's side while delivering nothing.
    //
    // The body is UNSIGNED at this point and therefore untrusted, so nothing is
    // parsed out of it. A SHA-256 fingerprint and byte length are enough to
    // correlate a rejection with a Paystack delivery attempt without storing
    // payment data.
    await writeDeadLetter({
      event: null,
      rawBody: "",
      reason: `invalid_signature:${check.reason ?? "unknown"}`,
      route: "/api/webhooks/relay",
      bodySha256: createHash("sha256").update(rawBody).digest("hex"),
      bodyBytes: Buffer.byteLength(rawBody),
    });

    // HTTP semantics unchanged: one opaque 401, whatever the reason.
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: { event?: string; data?: { metadata?: { project?: string } } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Only now, on a VERIFIED event, is the payload trusted enough to route on.
  const project = event.data?.metadata?.project;
  const targets = resolveTargets(project, process.env);

  // If no targets are configured, write to dead-letter so the event is not lost.
  // Paystack retries on non-2xx, but we return 200 to avoid infinite retries for
  // misconfiguration — the dead-letter collection is the recovery path.
  if (targets.length === 0) {
    await writeDeadLetter({ event, rawBody, reason: project ? `no WEBHOOK_URL_${project?.toUpperCase()} configured` : "no WEBHOOK_URL_* targets configured" });
    return NextResponse.json({ received: true });
  }

  const results = await Promise.allSettled(
    targets.map((url) =>
      fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-paystack-signature": signature,
        },
        body: rawBody,
      }).then((res) => {
        if (!res.ok) throw new Error(`target ${url} responded ${res.status}`);
      })
    )
  );

  // Write failed forwards to dead-letter for manual recovery
  const failures = results
    .map((r, i) => (r.status === "rejected" ? { url: targets[i], reason: r.reason?.message ?? String(r.reason) } : null))
    .filter(Boolean) as { url: string; reason: string }[];

  if (failures.length > 0) {
    await writeDeadLetter({ event, rawBody, reason: "forward failed", failures });
  }

  return NextResponse.json({ received: true });
}

async function writeDeadLetter(payload: {
  event: unknown;
  rawBody: string;
  reason: string;
  route?: string;
  /** Correlates a rejection with a delivery attempt without storing the payload. */
  bodySha256?: string;
  bodyBytes?: number;
  failures?: { url: string; reason: string }[];
}) {
  try {
    await getAdminDb().collection("relay_dead_letter").add({
      ...payload,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch {
    // Dead-letter write itself failed — nothing more we can do
  }
}
