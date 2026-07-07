import { type NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

function tokensMatch(a: string, b: string): boolean {
  try {
    const aBuf = Buffer.from(a, "hex");
    const bBuf = Buffer.from(b, "hex");
    if (aBuf.length === 0 || aBuf.length !== bBuf.length) return false;
    return timingSafeEqual(aBuf, bBuf);
  } catch {
    return false;
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const { orderId } = await params;
  const token = req.nextUrl.searchParams.get("t");

  if (!token) {
    return NextResponse.json({ error: "Unauthorized: Missing tracking token" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { items, note } = body as {
    items?: { id: string; quantity: number }[];
    note?: string;
  };

  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "Order must contain at least one item" }, { status: 400 });
  }

  // Validate request item structure
  for (const item of items) {
    if (
      typeof item.id !== "string" || !item.id ||
      typeof item.quantity !== "number" ||
      !Number.isInteger(item.quantity) ||
      item.quantity < 1
    ) {
      return NextResponse.json({ error: "Invalid item format in request" }, { status: 400 });
    }
  }

  const db = getAdminDb();
  const orderRef = db.collection("orders").doc(orderId);

  try {
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const orderData = orderSnap.data()!;
    const storedToken = orderData.trackingToken as string | undefined;

    // Secure timing-safe token verification
    if (!storedToken || !tokensMatch(token, storedToken)) {
      return NextResponse.json({ error: "Unauthorized: Invalid tracking token" }, { status: 401 });
    }

    // Status gatekeeper: Only allow edits if order is still pending or scheduled
    if (orderData.status !== "pending" && orderData.status !== "scheduled") {
      return NextResponse.json(
        { error: "Order is already being prepared and cannot be modified." },
        { status: 400 }
      );
    }

    // Fetch restaurant metadata to check opening hours, delivery fees, minimum orders
    const restaurantSnap = await db.collection("restaurants").doc(orderData.restaurantId as string).get();
    if (!restaurantSnap.exists) {
      return NextResponse.json({ error: "Restaurant data not found" }, { status: 404 });
    }
    const rData = restaurantSnap.data()!;

    // Load actual menu items for correct pricing
    const menuSnap = await db
      .collection("menu_items")
      .where("restaurantId", "==", orderData.restaurantId)
      .get();

    const menuMap = new Map<string, { name: string; price: number; available: boolean }>();
    for (const doc of menuSnap.docs) {
      menuMap.set(doc.id, {
        name: doc.data().name as string,
        price: doc.data().price as number,
        available: doc.data().available as boolean,
      });
    }

    const validatedItems: { id: string; menuItemId: string; name: string; price: number; quantity: number }[] = [];
    let itemsTotal = 0;

    for (const item of items) {
      const menuItem = menuMap.get(item.id);
      if (!menuItem) {
        return NextResponse.json(
          { error: `Item not found or does not belong to this restaurant` },
          { status: 400 }
        );
      }
      if (!menuItem.available) {
        return NextResponse.json(
          { error: `"${menuItem.name}" is currently unavailable` },
          { status: 400 }
        );
      }
      validatedItems.push({
        id: item.id,
        menuItemId: item.id,
        name: menuItem.name,
        price: menuItem.price,
        quantity: item.quantity,
      });
      itemsTotal += menuItem.price * item.quantity;
    }

    // Validate minimum order constraint
    const minimumOrder = (rData.minimumOrder as number) ?? 0;
    if (minimumOrder > 0 && itemsTotal < minimumOrder) {
      return NextResponse.json(
        { error: `Minimum order is ₦${minimumOrder.toLocaleString("en-NG")}. Please add more items.` },
        { status: 422 }
      );
    }

    const deliveryFee = orderData.deliveryFee ?? 0;
    const total = itemsTotal + deliveryFee;

    // Financial transaction guardrail for online-paid items
    if (orderData.paymentMethod === "online" && orderData.paymentStatus === "paid" && total !== orderData.total) {
      return NextResponse.json(
        { error: "Paid online orders cannot be modified if the total price changes. Please call support to override." },
        { status: 400 }
      );
    }

    // Update order with modified items and audit timestamp
    await orderRef.update({
      items: validatedItems,
      itemsTotal,
      total,
      note: typeof note === "string" ? note.trim() : orderData.note,
      updatedAt: FieldValue.serverTimestamp(),
      modifiedByCustomer: true,
    });

    return NextResponse.json({ success: true, itemsTotal, total });
  } catch (err) {
    console.error("Order self-editing failed:", err);
    return NextResponse.json({ error: "Failed to update your order" }, { status: 500 });
  }
}
