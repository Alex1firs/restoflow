import "server-only";
import { getAdminDb } from "@/lib/firebase-admin";
import { toCustomerFacing } from "@/lib/delivery/status";
import type { ConnectDelivery } from "./types";

/**
 * What a guest holding the token may see.
 *
 * ── The token grants one delivery, and only part of it ───────────────────────
 * Whoever has the link is the customer — there is no account, so possession is
 * the whole credential. That makes the projection the security boundary: it
 * returns what a person needs to pay and to follow their food, and nothing that
 * would help anybody else.
 *
 * Never returned: the Dispatcher cost, RestoFlow's margin, the pickup code, the
 * partner's internal ids, or the word Dispatcher. The receiving code is
 * withheld until the courier is actually on the way — it is the customer's
 * proof at the door, not a number to leave lying in a browser tab for an hour
 * beforehand.
 */
export type GuestView = {
  id: string;
  restaurant: { name: string; logoUrl: string | null };
  destination: string;
  amountMinor: number | null;
  paid: boolean;
  checkoutUrl: string | null;
  /**
   * What to tell the person when there is no courier and there will not be one.
   *
   * Without this a held or refunded delivery still read "we're finding you a
   * courier", which is the single worst thing to show somebody whose money we
   * are holding — it is both untrue and reassuring.
   */
  problem: { headline: string; detail: string } | null;
  /** Present only once the delivery is genuinely under way. */
  tracking: {
    headline: string;
    detail: string | null;
    etaMins: number | null;
    driverFirstName: string | null;
    receivingCode: string | null;
  } | null;
};

/** States where handing over the receiving code is useful rather than premature. */
const CODE_VISIBLE_FROM = ["PICKED_UP", "EN_ROUTE_TO_CUSTOMER", "ARRIVING"];

export async function guestView(id: string, token: string): Promise<GuestView | null> {
  if (!token) return null;
  const db = getAdminDb();
  const snap = await db.collection("connect_deliveries").doc(id).get();
  if (!snap.exists) return null;

  const d = snap.data() as ConnectDelivery;
  // Constant-time is overkill for a 128-bit random token, but a mismatch must
  // be indistinguishable from a missing delivery or the id becomes enumerable.
  if (!d.trackingToken || d.trackingToken !== token) return null;

  const rSnap = await db.collection("restaurants").doc(d.restaurantId).get();
  const r = rSnap.data() ?? {};

  const paid = !!d.payment?.paidAtMs;
  let tracking: GuestView["tracking"] = null;

  let problem: GuestView["problem"] = null;
  if (d.state === "payment_held_unfulfilled") {
    problem = {
      headline: "We couldn't complete this delivery",
      detail: "Your payment was received and is being returned. You don't need to do anything.",
    };
  } else if (d.state === "refund_pending") {
    problem = { headline: "Refund on its way", detail: "We've started returning your payment." };
  } else if (d.state === "refunded") {
    problem = {
      headline: "Refunded",
      detail: "Your payment has been returned. It can take a few days to appear.",
    };
  } else if (d.state === "refund_failed") {
    // Never "something went wrong" — somebody's money is involved and a person
    // is already dealing with it.
    problem = { headline: "Refund in progress", detail: "Our team is completing your refund." };
  }

  if (d.delivery) {
    const copy = toCustomerFacing(d.delivery.state, {
      restaurantName: String(r.name ?? "the restaurant"),
      driverFirstName: d.delivery.driver?.firstName,
    });
    let receivingCode: string | null = null;
    if (CODE_VISIBLE_FROM.includes(d.delivery.state)) {
      const h = await db.collection("connect_handover").doc(id).get();
      receivingCode = (h.data()?.receivingCode as string | undefined) ?? null;
    }
    tracking = {
      headline: copy.headline,
      detail: copy.detail,
      etaMins: d.delivery.etaToDropoffMins,
      driverFirstName: d.delivery.driver?.firstName ?? null,
      receivingCode,
    };
  }

  return {
    id: d.id,
    restaurant: {
      name: String(r.name ?? "Your restaurant"),
      logoUrl: (r.logo as string | undefined) ?? null,
    },
    // A short summary, not the full address — the person reading already knows
    // where they live, and a link forwarded by mistake should not publish it.
    destination: d.dropoff.address.split(",").slice(0, 2).join(",").trim(),
    amountMinor: d.payment?.amountMinor ?? d.quote?.partnerPriceMinor ?? null,
    paid,
    checkoutUrl: paid ? null : d.payment?.authorizationUrl ?? null,
    problem,
    tracking,
  };
}
