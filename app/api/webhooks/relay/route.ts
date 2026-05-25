import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import { serverEnv } from "@/lib/env";
import { getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  const signature = req.headers.get("x-paystack-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 401 });
  }

  // serverEnv.PAYSTACK_SECRET_KEY throws immediately if the var is unset.
  const secret = serverEnv.PAYSTACK_SECRET_KEY;
  const expected = createHmac("sha512", secret).update(rawBody).digest("hex");

  if (signature !== expected) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: { event?: string; data?: { metadata?: { project?: string } } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const project = event.data?.metadata?.project;

  // Collect all registered webhook targets from env (WEBHOOK_URL_*)
  const allTargets = Object.entries(process.env)
    .filter(([key, val]) => key.startsWith("WEBHOOK_URL_") && val)
    .map(([, url]) => url as string);

  // If project is specified, route only to that target; otherwise broadcast to all
  const targets = project
    ? (() => {
        const url = process.env[`WEBHOOK_URL_${project.toUpperCase()}`];
        return url ? [url] : [];
      })()
    : allTargets;

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
