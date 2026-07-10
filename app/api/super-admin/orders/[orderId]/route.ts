import { NextResponse } from "next/server";
import { getSuperAdminUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";
import { getCampaign } from "@/lib/campaigns/store";
import { toOrderDetail } from "@/lib/orders/admin-view";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Read-only, super-admin-only single order detail. Admin SDK (bypasses rules).
// Joins restaurant name + campaign summary. Returns the FULL customer phone —
// this shape is only exposed here (super-admin) and on the list endpoint. Never writes.
export async function GET(_req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  try {
    await getSuperAdminUser();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { orderId } = await params;
  const db = getAdminDb();

  const doc = await db.collection("orders").doc(orderId).get();
  if (!doc.exists) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  const data = doc.data() as Record<string, unknown>;
  const restaurantId = String(data.restaurantId ?? "");

  const restaurantName = restaurantId
    ? ((await db.collection("restaurants").doc(restaurantId).get()).data()?.name as string | undefined) ?? null
    : null;

  const campaignId = typeof data.campaignId === "string" && data.campaignId.trim() ? data.campaignId.trim() : null;
  const campaign = campaignId ? await getCampaign(db, campaignId).catch(() => null) : null;

  const order = toOrderDetail(doc.id, data, restaurantName, campaign);
  return NextResponse.json({ order });
}
