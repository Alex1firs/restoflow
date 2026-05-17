import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { checkSubscriptionAccess } from "@/lib/subscription-guard";

const VALID_METHODS = ["cash", "bank_transfer", "card"] as const;
type SettleMethod = (typeof VALID_METHODS)[number];

export async function POST(request: NextRequest) {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try {
    user = await getAuthenticatedUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const subscriptionBlock = await checkSubscriptionAccess(user.restaurantSlug);
  if (subscriptionBlock) return subscriptionBlock;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { orderId, paymentMethod, settlementNote, staffName } = body as Record<string, unknown>;

  if (typeof orderId !== "string" || !orderId) {
    return NextResponse.json({ error: "orderId is required" }, { status: 400 });
  }

  if (!VALID_METHODS.includes(paymentMethod as SettleMethod)) {
    return NextResponse.json(
      { error: "Payment method must be cash, bank_transfer, or card" },
      { status: 400 }
    );
  }

  const db = getAdminDb();
  const orderRef = db.collection("orders").doc(orderId);

  try {
    const snap = await orderRef.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const order = snap.data()!;

    if (order.restaurantId !== user.restaurantSlug) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (order.serviceMode !== "dine_in") {
      return NextResponse.json(
        { error: "Only dine-in orders can be settled here" },
        { status: 400 }
      );
    }

    if (order.status === "rejected") {
      return NextResponse.json({ error: "Cannot settle a cancelled order" }, { status: 400 });
    }

    // Idempotent — already settled
    if (order.paymentStatus === "paid") {
      return NextResponse.json({ success: true, alreadyPaid: true });
    }

    const update: Record<string, unknown> = {
      paymentStatus: "paid",
      paymentMethod,
      paidAt: FieldValue.serverTimestamp(),
      settledByStaffId: user.uid,
      settledByStaffName: typeof staffName === "string" ? staffName.trim() : "",
    };

    if (typeof settlementNote === "string" && settlementNote.trim()) {
      update.settlementNote = settlementNote.trim();
    }

    await orderRef.update(update);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Settle bill failed:", error);
    return NextResponse.json(
      { error: "Failed to settle bill. Please try again." },
      { status: 500 }
    );
  }
}
