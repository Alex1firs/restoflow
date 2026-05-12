import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-paystack-signature") ?? "";
  const secret = process.env.PAYSTACK_SECRET_KEY!;
  const expected = createHmac("sha512", secret).update(rawBody).digest("hex");

  if (signature !== expected) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: { data?: { metadata?: { project?: string } } };
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
        if (!url) console.error(`Relay: no WEBHOOK_URL_${project.toUpperCase()} configured`);
        return url ? [url] : [];
      })()
    : allTargets;

  if (targets.length === 0) {
    console.error("Relay: no targets to forward to — event dropped");
    return NextResponse.json({ received: true });
  }

  await Promise.allSettled(
    targets.map((url) =>
      fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-paystack-signature": signature,
        },
        body: rawBody,
      }).then((res) => {
        if (!res.ok) console.error(`Relay: ${url} responded ${res.status}`);
      }).catch((err) => {
        console.error(`Relay: failed to forward to ${url}:`, err);
      })
    )
  );

  return NextResponse.json({ received: true });
}
