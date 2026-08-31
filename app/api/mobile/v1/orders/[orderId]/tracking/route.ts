import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
import { readDeliveryConfig } from "@/lib/delivery/config";
import { DispatcherClient } from "@/lib/delivery/dispatcher-client";
import { FirestoreDeliveryStore } from "@/lib/delivery/firestore-store";
import { authorizeTracking, buildTrackingPayload, pollIntervalMs } from "@/lib/delivery/tracking";
import { toCustomerFacing } from "@/lib/delivery/status";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The customer's ONLY route to courier location.
 *
 * The mobile app holds a Firebase ID token and nothing else — no Firestore
 * credentials, no Dispatcher credentials. It asks RestoFlow about an order it
 * owns; RestoFlow decides whether location may be shown, and only then reads a
 * position server-side.
 *
 * Two deliberate choices:
 *   - Bearer token, not the `__session` cookie. Customers are a different
 *     identity domain from restaurant staff, and reusing the staff session path
 *     would be the first step toward merging them.
 *   - Every denial is 404. "Not your order" and "no such order" must be
 *     indistinguishable, or the endpoint enumerates order ids.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ orderId: string }> }) {
  const cfg = readDeliveryConfig();
  if (!cfg.ok || !cfg.config.enabled) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let customerId: string;
  try {
    const decoded = await getAdminAuth().verifyIdToken(authHeader.slice(7).trim());
    customerId = decoded.uid;
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Per-customer AND per-IP: a token is cheap to obtain, an IP is cheap to
  // rotate, and the polling loop makes this the most-called route in the app.
  const { allowed } = await checkRateLimit(`track:${customerId}`, 120, 60_000);
  if (!allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  const { allowed: ipAllowed } = await checkRateLimit(`track_ip:${getClientIp(req)}`, 300, 60_000);
  if (!ipAllowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const { orderId } = await params;

  const store = new FirestoreDeliveryStore(getAdminDb());
  const order = await store.getOrder(orderId);

  const decision = authorizeTracking({ order, requestingCustomerId: customerId });

  if (!decision.allowed) {
    if (decision.reason === "not_found") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    // The order is theirs, but there is nothing to track — before assignment or
    // after completion. Return the customer-facing state without any location,
    // so the app can render a correct screen instead of an error.
    const state = order?.delivery?.state ?? "REQUESTED";
    const copy = toCustomerFacing(state);
    return NextResponse.json({
      state,
      headline: copy.headline,
      detail: copy.detail,
      showMap: false,
      driver: order?.delivery?.driver ?? null,
      location: null,
      etaToDropoffMins: order?.delivery?.etaToDropoffMins ?? null,
      pollIntervalMs: pollIntervalMs(state),
      trackingAvailable: false,
    }, { status: 200 });
  }

  const projection = order!.delivery!;
  const correlationId = projection.correlationId || randomUUID();

  const client = new DispatcherClient({
    baseUrl: cfg.config.baseUrl,
    apiKey: cfg.config.apiKey,
    signingSecret: cfg.config.signingSecret,
    log: (name, fields) => console.log(JSON.stringify({ scope: "delivery_tracking", event: name, ...fields })),
  });

  const live = await client.getTracking({ externalOrderId: orderId, correlationId });

  // A Dispatcher outage must not blank the customer's screen. Fall back to the
  // projection: they still see the correct state and their courier's details,
  // just without a moving marker.
  const raw = live.ok && live.value.location
    ? { lat: live.value.location.lat, lng: live.value.location.lng, recordedAtMs: Date.parse(live.value.location.recordedAt) }
    : null;

  const state = live.ok ? live.value.state : projection.state;
  const driver = (live.ok ? live.value.driver : null) ?? projection.driver;
  const copy = toCustomerFacing(state, { driverFirstName: driver?.firstName });

  const payload = buildTrackingPayload({
    state,
    headline: copy.headline,
    detail: copy.detail,
    showMap: copy.showMap,
    driver,
    raw: raw && Number.isFinite(raw.recordedAtMs) ? raw : null,
    etaToDropoffMins: (live.ok ? live.value.etaToDropoffMins : null) ?? projection.etaToDropoffMins,
    nowMs: Date.now(),
  });

  return NextResponse.json(
    { ...payload, pollIntervalMs: pollIntervalMs(state), trackingAvailable: true },
    { status: 200 }
  );
}
