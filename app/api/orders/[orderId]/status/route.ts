import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { sendCustomerNotification, type CustomerEventType } from "@/lib/customer-notifications";
import { checkSubscriptionAccess } from "@/lib/subscription-guard";

type ValidStatus = "preparing" | "ready" | "completed" | "rejected";

const VALID: ValidStatus[] = ["preparing", "ready", "completed", "rejected"];

function resolveEvent(status: ValidStatus, deliveryType?: string): CustomerEventType {
  if (status === "ready") {
    return deliveryType === "pickup" ? "ready_pickup" : "ready_delivery";
  }
  if (status === "rejected") return "cancelled";
  return status as CustomerEventType;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try {
    user = await getAuthenticatedUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { orderId } = await params;

  const subscriptionBlock = await checkSubscriptionAccess(user.restaurantSlug);
  if (subscriptionBlock) return subscriptionBlock;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { status, voidReason, voidedByStaffName, requestCancellation, declineCancellation } = body as {
    status?: string;
    voidReason?: string;
    voidedByStaffName?: string;
    requestCancellation?: boolean;
    declineCancellation?: boolean;
  };

  const db = getAdminDb();
  const orderRef = db.collection("orders").doc(orderId);

  try {
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const order = orderSnap.data()!;

    // Ensure this order belongs to the authenticated restaurant
    if (order.restaurantId !== user.restaurantSlug) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (requestCancellation) {
      if (!voidReason?.trim()) {
        return NextResponse.json({ error: "Cancellation reason is required" }, { status: 400 });
      }
      await orderRef.update({
        cancellationRequested: true,
        cancellationReason: voidReason.trim(),
        cancellationRequestedBy: (voidedByStaffName || "Staff").trim(),
        cancellationRequestedAt: FieldValue.serverTimestamp(),
      });
      return NextResponse.json({ success: true });
    }

    if (declineCancellation) {
      if (user.role !== "owner" && user.role !== "manager") {
        return NextResponse.json({ error: "Forbidden: Only owners and managers can decline cancellation requests." }, { status: 403 });
      }
      await orderRef.update({
        cancellationRequested: false,
        cancellationReason: null,
        cancellationRequestedBy: null,
        cancellationRequestedAt: null,
      });
      return NextResponse.json({ success: true });
    }

    if (!status || !VALID.includes(status as ValidStatus)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    // Idempotency — skip if already at this status
    if (order.status === status) {
      return NextResponse.json({ success: true });
    }

    // Ensure role restrictions for approving cancellation requests
    if (status === "rejected" && order.cancellationRequested) {
      const isManagerOverride = voidReason?.toLowerCase().includes("override") || voidReason?.toLowerCase().includes("pin");
      if (!isManagerOverride && user.role !== "owner" && user.role !== "manager") {
        return NextResponse.json({ error: "Forbidden: Only owners and managers can approve cancellation requests." }, { status: 403 });
      }
    }

    // Timestamp each stage for future kitchen performance metrics
    const timestampField: Record<string, string> = {
      preparing: "preparingAt",
      ready: "readyAt",
      completed: "completedAt",
      rejected: "rejectedAt",
    };
    const extraFields: Record<string, unknown> = { status };
    if (timestampField[status as ValidStatus]) {
      extraFields[timestampField[status as ValidStatus]] = FieldValue.serverTimestamp();
    }

    if (status === "rejected") {
      if (voidReason) {
        extraFields.voidReason = voidReason.trim();
      } else if (order.cancellationReason) {
        extraFields.voidReason = order.cancellationReason;
      }
      if (voidedByStaffName) {
        extraFields.voidedByStaffName = voidedByStaffName.trim();
      } else if (order.cancellationRequestedBy) {
        extraFields.voidedByStaffName = order.cancellationRequestedBy;
      }
      extraFields.voidedByStaffId = user.uid;
      extraFields.cancellationRequested = false;
      extraFields.cancellationReason = null;
      extraFields.cancellationRequestedBy = null;
      extraFields.cancellationRequestedAt = null;
    }

    await orderRef.update(extraFields);

    // Fire customer notification (non-blocking)
    const restaurantSnap = await db.collection("restaurants").doc(order.restaurantId as string).get();
    const rData = restaurantSnap.data() ?? {};

    const itemsSummary = (order.items as { name: string; quantity: number }[])
      .map((i) => `${i.quantity}× ${i.name}`)
      .join(", ");

    sendCustomerNotification(resolveEvent(status as ValidStatus, order.deliveryType as string | undefined), {
      orderId,
      customerName: order.customerName as string,
      customerPhone: order.phone as string,
      restaurantName: (rData.name as string | undefined) ?? (order.restaurantId as string),
      restaurantAddress: rData.address as string | undefined,
      total: order.total as number,
      itemsSummary,
      paymentMethod: order.paymentMethod as "online" | "cash",
      deliveryType: order.deliveryType as "delivery" | "pickup" | undefined,
    }).catch(() => {});

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Status update failed:", err);
    return NextResponse.json({ error: "Failed to update status" }, { status: 500 });
  }
}
