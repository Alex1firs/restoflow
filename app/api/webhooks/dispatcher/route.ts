import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { readDeliveryConfig } from "@/lib/delivery/config";
import { verifySignature } from "@/lib/delivery/signature";
import { validateEvent, HEADERS, type DeliveryEvent } from "@/lib/delivery/contract";
import { FirestoreDeliveryStore } from "@/lib/delivery/firestore-store";
import { ingestEvent } from "@/lib/delivery/ingest";
import { FirestoreMarketplaceStore } from "@/lib/marketplace/store";
import { customerEventForDeliveryState, customerMessage } from "@/lib/marketplace/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Dispatcher → RestoFlow event receiver.
 *
 * ── Order of operations is the security model ────────────────────────────────
 * Signature and timestamp are verified against the RAW body before it is parsed
 * as JSON, so an unsigned caller never reaches the parser, let alone the
 * database. `req.text()` (not `req.json()`) is what makes that possible — the
 * bytes we verify must be the bytes that were signed.
 *
 * ── Why almost everything returns 200 ────────────────────────────────────────
 * A non-2xx tells Dispatcher to redeliver. That is right for "we could not
 * process this", and wrong for "we processed it and it was a duplicate", or
 * "this event is for an order we do not have". Redelivering those forever
 * fills a dead-letter queue with events nobody will ever act on. So: 401 for
 * anything unauthenticated, 400 for a malformed body that will never parse,
 * 500 only for a genuine internal fault worth retrying, and 200 for every
 * outcome that is settled — including the ones that changed nothing.
 */
export async function POST(req: NextRequest) {
  const cfg = readDeliveryConfig();
  if (!cfg.ok) {
    console.error("[dispatcher-webhook] integration misconfigured:", cfg.missing.join(", "));
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }
  if (!cfg.config.enabled) {
    return NextResponse.json({ error: "Not enabled" }, { status: 404 });
  }

  const rawBody = await req.text();

  const verdict = verifySignature({
    secret: cfg.config.inboundSecret,
    rawBody,
    signatureHeader: req.headers.get(HEADERS.signature),
    timestampHeader: req.headers.get(HEADERS.timestamp),
    nowMs: Date.now(),
  });

  if (!verdict.ok) {
    // The specific code is logged for the operator and deliberately NOT
    // returned: distinguishing "wrong secret" from "expired" from "malformed"
    // on the wire turns this endpoint into an oracle for a forger.
    console.warn(`[dispatcher-webhook] rejected: ${verdict.code}`);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const shape = validateEvent(parsed);
  if (!shape.ok) {
    // Signed but wrong shape means the two sides disagree about the contract —
    // a deploy-ordering problem, not an attack. Loud, and not retried.
    console.error(`[dispatcher-webhook] contract violation: ${shape.error}`);
    return NextResponse.json({ error: shape.error }, { status: 400 });
  }

  const event = parsed as DeliveryEvent;

  try {
    const db = getAdminDb();
    const result = await ingestEvent(event, {
      store: new FirestoreDeliveryStore(db),
      nowMs: Date.now(),
      log: (name, fields) => console.log(JSON.stringify({ scope: "dispatcher_webhook", event: name, ...fields })),

      /**
       * Tell the customer, for the handful of events that are actually news.
       *
       * Enqueued, never sent inline: a slow push provider must not hold up a
       * webhook Dispatcher is timing, and the outbox is deduplicated so a
       * redelivered event cannot send the same message twice. `ingestEvent`
       * swallows anything thrown here — the state IS applied, and returning
       * non-2xx would make Dispatcher redeliver an event we already have.
       */
      onStateChange: async ({ orderId, projection }) => {
        const customerEvent = customerEventForDeliveryState(projection.state);
        if (!customerEvent) return;

        const snap = await db.collection("orders").doc(orderId).get();
        const order = snap.data();
        if (!order || order.orderSource !== "marketplace") return;

        await new FirestoreMarketplaceStore(db).enqueueNotification({
          orderId, audience: "customer", event: customerEvent,
          payload: customerMessage({
            event: customerEvent,
            orderId,
            orderCode: String(order.marketplaceOrderCode ?? ""),
            restaurantName: String(order.restaurantName ?? order.restaurantId ?? ""),
            driverFirstName: projection.driver?.firstName,
            deliveryState: projection.state,
          }) as unknown as Record<string, unknown>,
          nowMs: Date.now(),
        });
      },
    });

    return NextResponse.json({ received: true, outcome: result.outcome }, { status: 200 });
  } catch (err) {
    // The one case worth a retry: we could not talk to our own database.
    console.error("[dispatcher-webhook] ingest failed", {
      eventId: event.eventId,
      externalOrderId: event.externalOrderId,
      correlationId: event.correlationId,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
