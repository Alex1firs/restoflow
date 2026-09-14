import type { DeliveryProjection } from "@/lib/delivery/projection";

/**
 * A Connect delivery — the whole record of a logistics-only job.
 *
 * ── Why this is not an order ─────────────────────────────────────────────────
 * There is no basket, no payment, no menu item and no marketplace state
 * machine, because the food order happened somewhere RestoFlow cannot see. A
 * Connect delivery that lived in `orders` would have to carry a dozen fields
 * that are permanently null, and every marketplace query would have to learn to
 * exclude it. It gets its own collection, and its own lifecycle.
 */

export const CONNECT_DELIVERY_STATES = [
  "draft",             // being composed by the partner
  "quoted",            // Dispatcher has priced it; the quote can still expire
  "awaiting_payment",  // a payment intent exists; the amount is frozen
  "paid",              // money confirmed by webhook; dispatch is now owed
  "requested",         // handed to Dispatcher; the delivery projection takes over
  "delivered",         // terminal, success
  "failed",            // terminal, failure
  "cancelled",         // terminal, cancelled

  // ── Paid, but no courier ────────────────────────────────────────────────────
  // Reached only when reconciliation has PROVEN no Dispatcher job exists. The
  // customer's money is held and somebody owes them an answer, so it is an
  // explicit state rather than an order that quietly stops moving.
  "payment_held_unfulfilled",
  "refund_pending",    // a refund obligation exists; the adapter has been asked
  "refunded",          // terminal; Paystack confirmed
  "refund_failed",     // terminal for the machine, open for a human
] as const;
export type ConnectDeliveryState = (typeof CONNECT_DELIVERY_STATES)[number];

/** Who pays for THIS delivery. Chosen per delivery; there is no wallet either way. */
export type ConnectPayer = "customer" | "restaurant";

/**
 * The frozen money.
 *
 * Written when the payment intent is created and never recomputed. Once a payer
 * has been shown a number, that number is what the webhook checks against — a
 * later re-quote must not silently change what somebody already agreed to pay.
 */
export type ConnectPaymentIntent = {
  reference: string;
  payer: ConnectPayer;
  amountMinor: number;
  dispatcherCostMinor: number;
  marginMinor: number;
  quoteId: string;
  createdAtMs: number;
  authorizationUrl: string | null;
  paidAtMs: number | null;
};

export type ConnectRefund = {
  /** Deterministic: one per payment reference, forever. */
  id: string;
  reference: string;
  amountMinor: number;
  reason: string;
  status: "pending" | "succeeded" | "failed";
  providerReference: string | null;
  requestedAtMs: number;
  settledAtMs: number | null;
  lastError: string | null;
};

/** A confirmed point. The address is what a human reads; the pin is authoritative. */
export type ConnectPlace = {
  address: string;
  location: { lat: number; lng: number };
  contactPhone: string;
  instructions: string | null;
};

export type ConnectQuote = {
  quoteId: string;
  dispatcherCostMinor: number;
  marginBps: number;
  marginMinor: number;
  /** What the partner pays. The only figure the partner is shown. */
  partnerPriceMinor: number;
  distanceKm: number | null;
  etaToPickupMins: number | null;
  etaToDropoffMins: number | null;
  /** Epoch ms. A quote past this is refused, never assumed still valid. */
  expiresAtMs: number;
  quotedAtMs: number;
};

export type ConnectDelivery = {
  id: string;
  restaurantId: string;
  state: ConnectDeliveryState;

  pickup: ConnectPlace & { name: string };
  /** The recipient. Only the first name ever reaches Dispatcher. */
  dropoff: ConnectPlace & { name: string };

  /** Free text for the rider. Never itemised — RestoFlow does not know the items. */
  packageDescription: string;
  /** ISO-8601. When the partner says it will be ready. */
  readyAt: string;

  quote: ConnectQuote | null;
  payer: ConnectPayer | null;
  payment: ConnectPaymentIntent | null;
  refund: ConnectRefund | null;

  /** The same projection the marketplace uses, once Dispatcher owns the job. */
  delivery: DeliveryProjection | null;

  /** Set when the delivery is handed over, so the tracking link can be issued. */
  trackingToken: string | null;

  createdAtMs: number;
  updatedAtMs: number;
  createdByUid: string;
  /** Correlation id for the Dispatcher call that created the job. */
  correlationId: string | null;
};
