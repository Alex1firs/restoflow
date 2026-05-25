import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { checkIsOpen } from "@/lib/restaurant-utils";
import { sendNewOrderAlert } from "@/lib/notifications";
import { sendCustomerNotification } from "@/lib/customer-notifications";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  const { allowed } = await checkRateLimit(`orders:${getClientIp(request)}`, 10, 60_000);
  if (!allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { restaurantId, customerName, phone, address, note, items, deliveryType, orderType, scheduledFor } =
    body as Record<string, unknown>;

  if (
    typeof restaurantId !== "string" || !restaurantId.trim() ||
    typeof customerName !== "string" || !customerName.trim() ||
    typeof phone !== "string" || !phone.trim() ||
    typeof address !== "string" || !address.trim()
  ) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "Order must contain at least one item" }, { status: 400 });
  }

  for (const item of items) {
    if (
      typeof item.id !== "string" || !item.id ||
      typeof item.quantity !== "number" ||
      !Number.isInteger(item.quantity) ||
      item.quantity < 1
    ) {
      return NextResponse.json({ error: "Invalid item in order" }, { status: 400 });
    }
  }

  try {
    const db = getAdminDb();

    const restaurantDoc = await db.collection("restaurants").doc(restaurantId.trim()).get();
    if (!restaurantDoc.exists) {
      return NextResponse.json({ error: "Restaurant not found" }, { status: 404 });
    }

    const rData = restaurantDoc.data()!;

    if (rData.status !== "live") {
      return NextResponse.json({ error: "Restaurant is not currently accepting orders." }, { status: 403 });
    }

    // Subscription guard — inline to reuse the already-fetched restaurant doc
    const GRACE_DAYS = 3;
    const subEndRaw = rData.subscriptionEndDate as { toDate?: () => Date; seconds?: number } | undefined;
    if (subEndRaw) {
      const subEnd = subEndRaw.toDate ? subEndRaw.toDate() : new Date((subEndRaw.seconds ?? 0) * 1000);
      const graceEndsAt = new Date(subEnd.getTime() + GRACE_DAYS * 86_400_000);
      if (graceEndsAt < new Date()) {
        return NextResponse.json(
          { error: "This restaurant is not currently accepting online orders." },
          { status: 503 }
        );
      }
    } else if (rData.subscriptionStatus === "expired") {
      return NextResponse.json(
        { error: "This restaurant is not currently accepting online orders." },
        { status: 503 }
      );
    }

    const isScheduled = orderType === "scheduled";

    // Check opening hours
    if (!isScheduled && !checkIsOpen(rData.openingHours as Parameters<typeof checkIsOpen>[0])) {
      return NextResponse.json({ error: "The restaurant is currently closed." }, { status: 422 });
    }

    if (isScheduled) {
      if (typeof scheduledFor !== "string" || !scheduledFor) {
        return NextResponse.json({ error: "Please choose a time for your scheduled order" }, { status: 400 });
      }
      
      const date = new Date(scheduledFor);
      if (isNaN(date.getTime()) || date < new Date()) {
        return NextResponse.json({ error: "Please choose a valid future time" }, { status: 400 });
      }

      // Check if scheduled time is within opening hours for that day
      const dayStr = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][date.getDay()];
      const hours = (rData.openingHours as Record<string, {open: boolean, from: string, to: string}>)?.[dayStr];
      if (!hours || !hours.open) {
        return NextResponse.json({ error: "The restaurant is closed on the selected day" }, { status: 422 });
      }
      
      const timeStr = date.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
      if (timeStr < hours.from || timeStr > hours.to) {
        return NextResponse.json({ error: "Please choose a time within opening hours" }, { status: 422 });
      }
    }

    const resolvedDeliveryType = deliveryType === "pickup" ? "pickup" : "delivery";
    const deliveryFee = resolvedDeliveryType === "delivery" ? ((rData.deliveryFee as number) ?? 0) : 0;
    const minimumOrder = (rData.minimumOrder as number) ?? 0;

    const menuSnap = await db
      .collection("menu_items")
      .where("restaurantId", "==", restaurantId.trim())
      .get();

    const menuMap = new Map<string, { name: string; price: number; available: boolean }>();
    for (const doc of menuSnap.docs) {
      menuMap.set(doc.id, {
        name: doc.data().name as string,
        price: doc.data().price as number,
        available: doc.data().available as boolean,
      });
    }

    const validatedItems: { id: string; name: string; price: number; quantity: number }[] = [];
    let itemsTotal = 0;

    for (const item of items as { id: string; quantity: number }[]) {
      const menuItem = menuMap.get(item.id);
      if (!menuItem) {
        return NextResponse.json({ error: "Item not found or does not belong to this restaurant" }, { status: 400 });
      }
      if (!menuItem.available) {
        return NextResponse.json({ error: `"${menuItem.name}" is currently unavailable` }, { status: 400 });
      }
      validatedItems.push({ id: item.id, name: menuItem.name, price: menuItem.price, quantity: item.quantity });
      itemsTotal += menuItem.price * item.quantity;
    }

    if (minimumOrder > 0 && itemsTotal < minimumOrder) {
      return NextResponse.json(
        { error: `Minimum order is ₦${minimumOrder.toLocaleString("en-NG")}. Please add more items.` },
        { status: 422 }
      );
    }

    const total = itemsTotal + deliveryFee;

    const trackingToken = randomBytes(16).toString("hex");

    const orderRef = await db.collection("orders").add({
      restaurantId: restaurantId.trim(),
      customerName: customerName.trim(),
      phone: phone.trim(),
      address: address.trim(),
      note: typeof note === "string" ? note.trim() : "",
      items: validatedItems,
      itemsTotal,
      deliveryFee,
      total,
      paymentMethod: "cash",
      paymentStatus: "pending",
      status: isScheduled ? "scheduled" : "pending",
      deliveryType: resolvedDeliveryType,
      orderType: isScheduled ? "scheduled" : "normal",
      ...(isScheduled ? { scheduledFor } : {}),
      trackingToken,
      createdAt: FieldValue.serverTimestamp(),
    });

    const orderId = orderRef.id;
    const restaurantName = (rData.name as string | undefined) ?? restaurantId.trim();
    const itemsSummary = validatedItems.map((i) => `${i.quantity}× ${i.name}`).join(", ");

    sendNewOrderAlert({
      restaurantSlug: restaurantId.trim(),
      total,
      paymentMethod: "cash",
      paymentStatus: "pending",
      customerName: customerName.trim(),
    }).catch(() => {});

    sendCustomerNotification("created", {
      orderId,
      customerName: customerName.trim(),
      customerPhone: phone.trim(),
      restaurantName,
      restaurantAddress: rData.address as string | undefined,
      total,
      itemsSummary,
      paymentMethod: "cash",
      deliveryType: resolvedDeliveryType,
    }).catch(() => {});

    return NextResponse.json({ orderId, trackingToken }, { status: 201 });
  } catch {
    console.error("Order creation failed");
    return NextResponse.json({ error: "Failed to place order. Please try again." }, { status: 500 });
  }
}
