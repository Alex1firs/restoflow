import { NextRequest, NextResponse } from "next/server";
import { getSuperAdminUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";
import { readFlags } from "@/lib/marketplace/config";
import { toOpsRow, availableActions, buildTimeline } from "@/lib/marketplace/ops-view";
import { FirestoreMarketplaceStore, ORDER_SOURCE_MARKETPLACE, LEDGER } from "@/lib/marketplace/store";
import { summarise } from "@/lib/marketplace/ledger";
import { TIMELINE } from "@/lib/delivery/firestore-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One order: the row, the combined timeline, and the money. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ orderId: string }> }) {
  if (!readFlags().enabled) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    await getSuperAdminUser();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { orderId } = await params;
  const db = getAdminDb();

  const snap = await db.collection("orders").doc(orderId).get();
  if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const d = snap.data() ?? {};
  if (d.orderSource !== ORDER_SOURCE_MARKETPLACE) {
    // A POS order is not a marketplace order and must not render in this view.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const [deliveryEvents, ledger] = await Promise.all([
    db.collection(TIMELINE).where("orderId", "==", orderId).get()
      .then((s) => s.docs.map((x) => x.data() as Record<string, unknown>))
      .catch(() => []),
    new FirestoreMarketplaceStore(db).ledgerFor(orderId).catch(() => []),
  ]);

  const nowMs = Date.now();
  const row = toOpsRow(orderId, d, nowMs);

  return NextResponse.json({
    order: { ...row, actions: availableActions(row) },
    timeline: buildTimeline(d, deliveryEvents),
    // Derived from the entries, never from a stored balance.
    financials: ledger.length
      ? { ...summarise(ledger, d.pricing as never), currency: "NGN" }
      : null,
    ledgerEntries: ledger.length,
    pricing: d.pricing ?? null,
    delivery: d.delivery ?? null,
    ledgerCollection: LEDGER,
  });
}
