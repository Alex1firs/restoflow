import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { checkSubscriptionAccess } from "@/lib/subscription-guard";
import { awardLoyaltyTick } from "@/lib/loyalty";

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

  type TxResult =
    | { outcome: "error"; message: string; status: number }
    | { outcome: "already_paid" }
    | { outcome: "settled"; loyaltyPayload: { phone: string; customerName: string; total: number } | null };

  let result: TxResult;

  try {
    result = await db.runTransaction(async (tx): Promise<TxResult> => {
      const snap = await tx.get(orderRef);
      if (!snap.exists) {
        return { outcome: "error", message: "Order not found", status: 404 };
      }

      const order = snap.data()!;

      if (order.restaurantId !== user.restaurantSlug) {
        return { outcome: "error", message: "Forbidden", status: 403 };
      }

      if (order.serviceMode !== "dine_in") {
        return { outcome: "error", message: "Only dine-in orders can be settled here", status: 400 };
      }

      if (order.status === "rejected") {
        return { outcome: "error", message: "Cannot settle a cancelled order", status: 400 };
      }

      // Idempotent — already settled (second concurrent call sees the committed write)
      if (order.paymentStatus === "paid") {
        return { outcome: "already_paid" };
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

      tx.update(orderRef, update);

      const phone = (order.phone as string) ?? (order.customerPhone as string) ?? "";
      const loyaltyPayload = phone
        ? {
            phone,
            customerName: (order.customerName as string) ?? "",
            total: (order.total as number) ?? 0,
          }
        : null;

      return { outcome: "settled", loyaltyPayload };
    });
  } catch {
    console.error("Settle bill failed");
    return NextResponse.json(
      { error: "Failed to settle bill. Please try again." },
      { status: 500 }
    );
  }

  if (result.outcome === "error") {
    return NextResponse.json({ error: result.message }, { status: result.status });
  }

  if (result.outcome === "already_paid") {
    return NextResponse.json({ success: true, alreadyPaid: true });
  }

  // Award loyalty tick (fire-and-forget — never block the payment response)
  if (result.loyaltyPayload) {
    const p = result.loyaltyPayload;
    awardLoyaltyTick({
      orderId,
      restaurantSlug: user.restaurantSlug,
      phone: p.phone,
      customerName: p.customerName,
      orderTotal: p.total,
    }).catch(() => {});
  }

  return NextResponse.json({ success: true });
}
