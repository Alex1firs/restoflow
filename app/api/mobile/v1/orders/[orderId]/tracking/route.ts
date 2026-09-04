import { getAdminDb } from "@/lib/firebase-admin";
import { readDeliveryConfig } from "@/lib/delivery/config";
import { DispatcherClient } from "@/lib/delivery/dispatcher-client";
import { FirestoreDeliveryStore } from "@/lib/delivery/firestore-store";
import { authorizeTracking, buildTrackingPayload, pollIntervalMs } from "@/lib/delivery/tracking";
import { toCustomerFacing } from "@/lib/delivery/status";
import { withCustomer, notFound } from "@/lib/marketplace/mobile-api";
import { toCustomerStage } from "@/lib/marketplace/customer-view";
import type { RestaurantState } from "@/lib/marketplace/order";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The customer's ONLY route to courier location.
 *
 * The app holds a Firebase ID token and nothing else — no Firestore
 * credentials, no Dispatcher credentials. It asks RestoFlow about an order it
 * owns; RestoFlow decides whether location may be shown and only then reads a
 * position server-side.
 *
 * Ownership comes from the verified token. Every denial is 404, so the endpoint
 * cannot be used to discover which order ids are real.
 */
export function GET(req: Request, ctx: { params: Promise<{ orderId: string }> }) {
  return withCustomer(async ({ customer }) => {
    const cfg = readDeliveryConfig();
    if (!cfg.ok || !cfg.config.enabled) return notFound();

    const { orderId } = await ctx.params;
    const db = getAdminDb();
    const store = new FirestoreDeliveryStore(db);
    const order = await store.getOrder(orderId);

    const decision = authorizeTracking({ order, requestingCustomerId: customer.id });

    if (!decision.allowed) {
      if (decision.reason === "not_found") return notFound();

      // The order IS theirs, but there is nothing to track — before assignment
      // or after completion. Return the customer-facing state with no location,
      // so the app renders a correct screen rather than an error.
      const state = order?.delivery?.state ?? "REQUESTED";
      const restaurantState = (order?.restaurantProgress ?? "placed") as RestaurantState;
      const { stage, problem } = toCustomerStage(restaurantState, order?.delivery?.state ?? null);
      const copy = toCustomerFacing(state);
      return {
        orderId, stage, problem,
        headline: copy.headline, detail: copy.detail,
        showMap: false,
        courier: order?.delivery?.driver ?? null,
        courierLocation: null,
        restaurantLocation: null,
        destination: null,
        etaMins: order?.delivery?.etaToDropoffMins ?? null,
        pollIntervalMs: pollIntervalMs(state),
        canMessageCourier: false,
        canCallCourier: false,
        trackingAvailable: false,
      };
    }

    const projection = order!.delivery!;
    const correlationId = projection.correlationId || randomUUID();

    const client = new DispatcherClient({
      baseUrl: cfg.config.baseUrl, apiKey: cfg.config.apiKey, signingSecret: cfg.config.signingSecret,
      log: (event, fields) => console.log(JSON.stringify({ scope: "delivery_tracking", event, ...fields })),
    });

    const live = await client.getTracking({ externalOrderId: orderId, correlationId });

    // A Dispatcher outage must not blank the screen: fall back to the
    // projection, so the customer still sees the right state and their
    // courier's details, just without a moving marker.
    const raw = live.ok && live.value.location
      ? {
          lat: live.value.location.lat,
          lng: live.value.location.lng,
          recordedAtMs: Date.parse(live.value.location.recordedAt),
        }
      : null;

    const state = live.ok ? live.value.state : projection.state;
    const driver = (live.ok ? live.value.driver : null) ?? projection.driver;
    const restaurantState = (order!.restaurantProgress ?? "placed") as RestaurantState;
    const { stage, problem } = toCustomerStage(restaurantState, state);
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

    return {
      orderId, stage, problem,
      ...payload,
      restaurantLocation: null,
      destination: null,
      pollIntervalMs: pollIntervalMs(state),
      canMessageCourier: copy.showContact,
      // Masked calling is a later phase; the seam is in the contract.
      canCallCourier: false,
      trackingAvailable: true,
    };
  })(req);
}
