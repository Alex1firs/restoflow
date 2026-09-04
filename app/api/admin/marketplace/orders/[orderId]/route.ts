import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";
import { readFlags } from "@/lib/marketplace/config";
import { FirestoreMarketplaceStore } from "@/lib/marketplace/store";
import { transitionRestaurant, type RestaurantState } from "@/lib/marketplace/order";
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

  // ── Acceptance is the handoff boundary ────────────────────────────────────
  //
  // This is the moment a rider is genuinely warranted: a human at the
  // restaurant has committed to cooking the order. Requesting the delivery
  // here rather than at payment means a paid-but-rejected order never books a
  // courier, and `computeConfirmAt` inside the handoff is measured from a real
  // acceptance rather than from whenever Paystack happened to call back.
  //
  // Deliberately after the transition has committed, and deliberately
  // swallowing failures: the order IS accepted, and the restaurant must not
  // see an error — nor a rollback — because Dispatcher was briefly unreachable.
  // `externalOrderId` idempotency plus the compare-and-set on `delivery` mean a
  // repeated Accept, a retry, or the reconcile sweep all converge on one job.
  if (result.to === "accepted") {
    try {
      const { requestDeliveryForOrder } = await import("@/lib/marketplace/delivery-handoff");
      const handoff = await requestDeliveryForOrder({ db, orderId, nowMs });
      console.log(JSON.stringify({
        scope: "marketplace_acceptance", event: "delivery_handoff",
        orderId, outcome: handoff.outcome,
        ...("deliveryJobId" in handoff ? { deliveryJobId: handoff.deliveryJobId } : {}),
        ...("reason" in handoff ? { reason: handoff.reason } : {}),
      }));
    } catch (err) {
      console.error(JSON.stringify({
        scope: "marketplace_acceptance", event: "delivery_handoff_threw",
        orderId, error: err instanceof Error ? err.message : String(err),
      }));
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
