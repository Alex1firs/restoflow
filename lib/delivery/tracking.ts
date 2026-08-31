/**
 * The authorisation gate in front of courier location.
 *
 * A rider's live position is data about a named worker, exposed to a stranger
 * because they ordered food. Every one of those exposures needs a reason, a
 * scope and an end. This module is the reason, the scope and the end — pure, so
 * the rules can be exhaustively tested rather than reviewed and hoped about.
 *
 * The customer app NEVER reaches Dispatcher. It calls RestoFlow, RestoFlow
 * authorises here, and only then does the server-side client fetch a position.
 */

import type { DeliveryState, DriverPublicProfile, LatLng } from "./contract";
import { isTerminal } from "./contract";
import { trackingAllowed } from "./status";
import type { DeliveryOrderView } from "./store";

/** A fix older than this is shown as stale rather than drawn as if it were live. */
export const LOCATION_STALE_AFTER_MS = 90_000;
/** Older still and we withhold it: a five-minute-old pin is a lie, not data. */
export const LOCATION_MAX_AGE_MS = 5 * 60_000;

/**
 * ~11 m at the equator. Enough to watch a marker approach; not enough to be a
 * survey of where a worker stood. Applied server-side so the precise value
 * never leaves the building.
 */
const COORD_DECIMALS = 4;

export type TrackingDenial =
  | "not_found"          // wrong customer, or no such order — same answer, deliberately
  | "no_delivery"
  | "not_yet_assigned"
  | "completed";

export type TrackingDecision =
  | { allowed: true; deliveryJobId: string }
  | { allowed: false; reason: TrackingDenial };

/**
 * May this caller see this delivery's location?
 *
 * Ownership is checked against the authenticated customer, never against an id
 * supplied in the request. A customer asking for another customer's order gets
 * `not_found` — the same response as an order that does not exist, so the
 * endpoint cannot be used to discover which order ids are real.
 */
export function authorizeTracking(args: {
  order: DeliveryOrderView | null;
  requestingCustomerId: string;
}): TrackingDecision {
  const { order, requestingCustomerId } = args;

  if (!order) return { allowed: false, reason: "not_found" };
  if (!order.customerId || order.customerId !== requestingCustomerId) {
    return { allowed: false, reason: "not_found" };
  }
  if (!order.delivery) return { allowed: false, reason: "no_delivery" };

  const state = order.delivery.state;
  // Terminal first: after a delivery ends, access ends — permanently, and
  // regardless of how recently it finished.
  if (isTerminal(state)) return { allowed: false, reason: "completed" };
  if (!trackingAllowed(state)) return { allowed: false, reason: "not_yet_assigned" };

  const jobId = order.delivery.deliveryJobId;
  if (!jobId) return { allowed: false, reason: "not_yet_assigned" };

  return { allowed: true, deliveryJobId: jobId };
}

export type CustomerTrackingPayload = {
  state: DeliveryState;
  headline: string;
  detail: string | null;
  showMap: boolean;
  driver: DriverPublicProfile | null;
  location: { lat: number; lng: number; stale: boolean; recordedAt: string } | null;
  etaToDropoffMins: number | null;
};

/**
 * Build what the customer app receives.
 *
 * Withholds a position entirely once it is too old, rather than drawing a
 * marker that has not moved for five minutes — a stale pin reads as "the
 * courier is stuck outside" and generates support calls about nothing.
 */
export function buildTrackingPayload(args: {
  state: DeliveryState;
  headline: string;
  detail: string | null;
  showMap: boolean;
  driver: DriverPublicProfile | null;
  raw: (LatLng & { recordedAtMs: number }) | null;
  etaToDropoffMins: number | null;
  nowMs: number;
}): CustomerTrackingPayload {
  let location: CustomerTrackingPayload["location"] = null;

  if (args.raw) {
    const age = args.nowMs - args.raw.recordedAtMs;
    if (age <= LOCATION_MAX_AGE_MS) {
      location = {
        lat: round(args.raw.lat),
        lng: round(args.raw.lng),
        stale: age > LOCATION_STALE_AFTER_MS,
        recordedAt: new Date(args.raw.recordedAtMs).toISOString(),
      };
    }
  }

  return {
    state: args.state,
    headline: args.headline,
    detail: args.detail,
    showMap: args.showMap && location !== null,
    driver: args.driver,
    location,
    etaToDropoffMins: args.etaToDropoffMins,
  };
}

function round(v: number): number {
  const f = 10 ** COORD_DECIMALS;
  return Math.round(v * f) / f;
}

/**
 * How often the app should come back.
 *
 * Returned by the endpoint so the polling cadence is a server decision: it can
 * be widened during an incident without shipping a new build, and it naturally
 * stops the app polling a delivery that has nothing left to report.
 */
export function pollIntervalMs(state: DeliveryState): number | null {
  if (isTerminal(state)) return null;
  if (!trackingAllowed(state)) return 30_000;
  switch (state) {
    case "ARRIVING": return 5_000;
    case "EN_ROUTE_TO_CUSTOMER": return 8_000;
    default: return 15_000;
  }
}
