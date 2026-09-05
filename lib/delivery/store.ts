/**
 * Storage port for the delivery integration.
 *
 * The orchestration (ingest.ts, reconcile.ts) depends only on this interface,
 * never on firebase — so the whole event pipeline is unit-testable with an
 * in-memory fake, exactly as lib/discovery does. The real adapter lives in
 * firestore-store.ts.
 */

import type { DeliveryProjection } from "./projection";
import type { RestaurantProgress } from "./status";

/** The narrow slice of a marketplace order this subsystem may see. */
export type DeliveryOrderView = {
  orderId: string;
  restaurantId: string;
  /**
   * The restaurant's display name, when the order carries one.
   *
   * Null for orders written before the field existed — the customer-facing
   * copy falls back to "the restaurant" rather than printing an internal slug,
   * so an old order reads a little generically instead of wrongly.
   */
  restaurantName: string | null;
  /**
   * The two fixed ends of the journey, for the customer's map.
   *
   * The pickup is the restaurant's own published location and the dropoff is
   * the address this customer chose, so neither tells them anything they did
   * not already supply or could not already see. The RIDER's position stays
   * behind `authorizeTracking` and the staleness gate, as it always has.
   */
  pickup: { lat: number; lng: number } | null;
  dropoff: { lat: number; lng: number } | null;
  /** Firebase Auth uid of the owning customer. The IDOR check hangs off this. */
  customerId: string;
  restaurantProgress: RestaurantProgress;
  delivery: DeliveryProjection | null;
};

export interface DeliveryStore {
  /** By RestoFlow order id. Null when absent — never throws for a missing order. */
  getOrder(orderId: string): Promise<DeliveryOrderView | null>;

  /**
   * Reserve an event id, returning false when it has already been recorded.
   *
   * MUST be atomic (a transactional create, not a read-then-write): duplicate
   * webhooks arrive concurrently, not politely spaced, and a non-atomic check
   * lets both copies through.
   */
  claimEvent(eventId: string, meta: { orderId: string; deliveryJobId: string; sequence: number; nowMs: number }): Promise<boolean>;

  /**
   * Write a projection, but only if the stored sequence is still what we read.
   *
   * The compare-and-set is what makes concurrent event processing safe without
   * a lock. Returns false when another writer got there first; the caller
   * re-reads and re-decides rather than clobbering.
   */
  writeProjection(orderId: string, expectedSequence: number, next: DeliveryProjection): Promise<boolean>;

  /** Append to the order's support-facing timeline. Never overwrites. */
  appendTimeline(orderId: string, entry: TimelineEntry): Promise<void>;

  /** Live deliveries whose projection has gone quiet, for the reconciler. */
  findStaleDeliveries(olderThanMs: number, limit: number): Promise<DeliveryOrderView[]>;

  /** Orders whose delivery job should now be released to riders. */
  findDueForConfirm(nowMs: number, limit: number): Promise<Array<DeliveryOrderView & { confirmAt: number }>>;
}

export type TimelineEntry = {
  at: number;
  source: "dispatcher" | "restoflow" | "reconciler" | "operator";
  event: string;
  state: string | null;
  correlationId: string;
  detail: string | null;
};
