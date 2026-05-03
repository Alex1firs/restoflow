import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";
import { sendCustomerNotification, type CustomerEventType } from "@/lib/customer-notifications";

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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { status } = body as { status?: string };
  if (!status || !VALID.includes(status as ValidStatus)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

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

    // Idempotency — skip if already at this status
    if (order.status === status) {
      return NextResponse.json({ success: true });
    }

    await orderRef.update({ status });

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
