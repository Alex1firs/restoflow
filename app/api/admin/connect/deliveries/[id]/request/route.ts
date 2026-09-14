import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { authoriseConnect } from "@/lib/connect/http";
import { requestConnectDelivery } from "@/lib/connect/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Accept the quote and dispatch a courier.
 *
 * Idempotent: the Connect delivery id is the same value Dispatcher dedupes on,
 * so a double-tap or a retried request converges on one job. The response says
 * which happened rather than hiding it.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authoriseConnect();
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  const result = await requestConnectDelivery({
    db: getAdminDb(),
    restaurantId: auth.caller.restaurantId,
    deliveryId: id,
  });

  if (!result.ok) {
    // A quote that has expired is a 409: the request was well formed, the world
    // moved. The partner must re-quote rather than be told to fix their input.
    const status = result.reason === "not_found" ? 404 : result.reason === "quote_expired" ? 409 : 422;
    return NextResponse.json({ error: result.reason, detail: result.detail }, { status });
  }

  return NextResponse.json({
    id: result.delivery.id,
    state: result.delivery.state,
    replayed: result.replayed,
    // Shown to the restaurant so staff can check the rider at the door.
    pickupCode: result.delivery.delivery?.pickupCode ?? null,
    deliveryState: result.delivery.delivery?.state ?? null,
  });
}
