import { NextRequest, NextResponse } from "next/server";
import { getSuperAdminUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";
import { readFlags } from "@/lib/marketplace/config";
import { toOpsRow, availableActions } from "@/lib/marketplace/ops-view";
import { ORDER_SOURCE_MARKETPLACE } from "@/lib/marketplace/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The marketplace operations board.
 *
 * Super-admin gated: marketplace operations spans every restaurant, so it is a
 * platform function, not a restaurant one. A restaurant sees only its own
 * marketplace orders, through the screens it already uses.
 *
 * Renders entirely from the order documents — the delivery projection is
 * already mirrored onto each one — so the board never blocks on a Dispatcher
 * call and stays usable during a Dispatcher outage.
 */
export async function GET(req: NextRequest) {
  if (!readFlags().enabled) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    await getSuperAdminUser();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const limit = Math.min(Number(sp.get("limit") ?? 100), 200);
  const restaurantId = sp.get("restaurantId");
  const attentionOnly = sp.get("attention") === "1";

  let q = getAdminDb().collection("orders")
    .where("orderSource", "==", ORDER_SOURCE_MARKETPLACE)
    .orderBy("createdAtMs", "desc")
    .limit(limit);

  if (restaurantId) q = q.where("restaurantId", "==", restaurantId) as typeof q;

  const snap = await q.get();
  const nowMs = Date.now();

  const rows = snap.docs
    .map((doc) => {
      const row = toOpsRow(doc.id, doc.data() ?? {}, nowMs);
      return { ...row, actions: availableActions(row) };
    })
    .filter((r) => (attentionOnly ? r.needsAttention : true));

  return NextResponse.json({
    rows,
    counts: {
      total: rows.length,
      attention: rows.filter((r) => r.needsAttention).length,
      live: rows.filter((r) => r.deliveryState && !["DELIVERED", "CANCELLED", "DELIVERY_FAILED"].includes(r.deliveryState)).length,
    },
  });
}
