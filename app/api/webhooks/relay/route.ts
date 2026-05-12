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

  const project = (event.data?.metadata?.project ?? "rest").toUpperCase();
  const targetUrl = process.env[`WEBHOOK_URL_${project}`];

  if (!targetUrl) {
    console.error(`Relay: no WEBHOOK_URL_${project} configured — event dropped`);
    // Still return 200 so Paystack doesn't retry indefinitely
    return NextResponse.json({ received: true });
  }

  try {
    const res = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-paystack-signature": signature,
      },
      body: rawBody,
    });
    if (!res.ok) {
      console.error(`Relay: ${targetUrl} responded ${res.status}`);
    }
  } catch (err) {
    console.error(`Relay: failed to forward to ${targetUrl}:`, err);
  }

  return NextResponse.json({ received: true });
}
