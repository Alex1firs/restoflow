import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";
import { readFlags } from "@/lib/marketplace/config";
import { FirestoreMarketplaceStore } from "@/lib/marketplace/store";
import { transitionRestaurant, type RestaurantState } from "@/lib/marketplace/order";
import { computeConfirmAt } from "@/lib/delivery/projection";
import {
  customerEventForRestaurantState, customerMessage,
} from "@/lib/marketplace/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The restaurant's accept / reject / preparing / ready actions.
 *
 * Uses the SAME `getAuthenticatedUser()` session that every existing admin
 * route uses — cashier authentication is untouched, and a marketplace action is
 * scoped to the caller's own restaurant by the transaction, not by this route
 * being careful.
 */
const ACTIONS: Record<string, RestaurantState> = {
  accept: "accepted",
  reject: "rejected",
  preparing: "preparing",
  ready: "ready",
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ orderId: string }> }) {
  const flags = readFlags();
  if (!flags.enabled) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try {
    user = await getAuthenticatedUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const action = String((body as { action?: unknown } | null)?.action ?? "");
  const to = ACTIONS[action];
  if (!to) return NextResponse.json({ error: "Unknown action" }, { status: 400 });

  if (to === "rejected") {
    const reason = String((body as { reason?: unknown } | null)?.reason ?? "").trim();
    // A rejection triggers a full refund, so it needs an attributable reason.
    if (!reason) return NextResponse.json({ error: "A reason is required to reject an order" }, { status: 400 });
  }

  const { orderId } = await params;
  const nowMs = Date.now();
  const db = getAdminDb();
  const store = new FirestoreMarketplaceStore(db);

  const result = await store.transitionRestaurantState({
    orderId,
    restaurantId: user.restaurantSlug,
    to,
    by: user.uid,
    reason: String((body as { reason?: unknown } | null)?.reason ?? "") || undefined,
    nowMs,
    decide: (from, target) => {
      const r = transitionRestaurant(from, target);
      return r.ok ? { ok: true, next: r.next } : { ok: false, reason: r.reason };
    },
  });

  if (!result.ok) {
    // "belongs to another restaurant" is reported as 404, not 403: confirming
    // that an order exists but is somebody else's is itself a disclosure.
    const status = /another restaurant|not found|not a marketplace/.test(result.reason) ? 404 : 409;
    return NextResponse.json({ error: result.reason }, { status });
  }

  // On acceptance, schedule when the courier should be released. The job is
  // already reserved as a draft; this is the moment riders start being offered
  // it, so a 25-minute prep does not have a rider waiting for 20 of them.
  if (to === "accepted") {
    try {
      const snap = await db.collection("orders").doc(orderId).get();
      const d = snap.data() ?? {};
      const confirmAt = computeConfirmAt({
        acceptedAtMs: nowMs,
        prepMins: Number(d.fulfillment?.prepMins ?? 25),
        etaToPickupMins: typeof d.delivery?.etaToPickupMins === "number" ? d.delivery.etaToPickupMins : null,
        nowMs,
      });
      await store.setDeliveryConfirmAt(orderId, confirmAt);
    } catch (err) {
      // The order IS accepted. A scheduling failure must not undo that — the
      // restaurant's "ready" signal is the backstop, and the sweep retries.
      console.error("[marketplace] failed to schedule dispatch", { orderId, error: String(err) });
    }
  }

  const customerEvent = customerEventForRestaurantState(result.to);
  if (customerEvent) {
    const snap = await db.collection("orders").doc(orderId).get();
    const d = snap.data() ?? {};
    await store.enqueueNotification({
      orderId, audience: "customer", event: customerEvent,
      payload: customerMessage({
        event: customerEvent, orderId,
        orderCode: String(d.marketplaceOrderCode ?? ""),
        restaurantName: user.restaurantSlug,
      }) as unknown as Record<string, unknown>,
      nowMs,
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true, from: result.from, to: result.to });
}
