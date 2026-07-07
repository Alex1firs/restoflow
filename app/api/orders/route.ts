import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { checkIsOpen } from "@/lib/restaurant-utils";
import { sendNewOrderAlert } from "@/lib/notifications";
import { sendCustomerNotification } from "@/lib/customer-notifications";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { recordServerEvent } from "@/lib/analytics/rollup";
import { GRACE_DAYS } from "@/lib/constants";

export async function POST(request: NextRequest) {
  const { allowed } = await checkRateLimit(`orders:${getClientIp(request)}`, 10, 60_000);
  if (!allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { restaurantId, customerName, phone, address, note, items, deliveryType, orderType, scheduledFor, serviceMode, tableLabel, deliveryZoneId, paymentMethod } =
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

    const isDineIn = serviceMode === "dine_in" || deliveryType === "dine_in";
    const resolvedDeliveryType = isDineIn ? "dine_in" : deliveryType === "pickup" ? "pickup" : "delivery";
    
    let deliveryFee = 0;
    let deliveryZoneName = null;
    
    if (resolvedDeliveryType === "delivery") {
      if (deliveryZoneId && typeof deliveryZoneId === "string" && Array.isArray(rData.deliveryZones)) {
        const zone = rData.deliveryZones.find((z: any) => z.id === deliveryZoneId);
        if (zone) {
          deliveryFee = typeof zone.fee === "number" ? zone.fee : Number(zone.fee);
          deliveryZoneName = zone.name;
        } else {
          deliveryFee = (rData.deliveryFee as number) ?? 0;
        }
      } else {
        deliveryFee = (rData.deliveryFee as number) ?? 0;
      }
    }

    if (resolvedDeliveryType === "delivery" && rData.payOnDeliveryEnabled === false) {
      return NextResponse.json({ error: "Pay on delivery is not enabled for this restaurant." }, { status: 422 });
    }

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

    let orderNumber: number;
    const orderRef = db.collection("orders").doc();
    const orderId = orderRef.id;

    await db.runTransaction(async (transaction) => {
      const rRef = db.collection("restaurants").doc(restaurantId.trim());
      const rDoc = await transaction.get(rRef);
      if (!rDoc.exists) {
        throw new Error("Restaurant not found");
      }
      const rDataObj = rDoc.data()!;
      const currentCounter = (rDataObj.orderCounter as number | undefined) ?? 99;
      orderNumber = currentCounter + 1;

      transaction.update(rRef, { orderCounter: orderNumber });
      transaction.set(orderRef, {
        restaurantId: restaurantId.trim(),
        customerName: customerName.trim(),
        phone: phone.trim(),
        address: address.trim(),
        note: typeof note === "string" ? note.trim() : "",
        items: validatedItems,
        itemsTotal,
        deliveryFee,
        total,
        paymentMethod: paymentMethod === "whatsapp" ? "whatsapp" : "cash",
        paymentStatus: paymentMethod === "whatsapp" ? "unpaid" : "pending",
        status: isScheduled ? "scheduled" : "pending",
        deliveryType: resolvedDeliveryType,
        orderType: isScheduled ? "scheduled" : "normal",
        ...(isDineIn ? { serviceMode: "dine_in", tableLabel: typeof tableLabel === "string" ? tableLabel.trim() : "" } : {}),
        ...(deliveryZoneName ? { deliveryZoneName } : {}),
        ...(isScheduled ? { scheduledFor } : {}),
        trackingToken,
        createdAt: FieldValue.serverTimestamp(),
        orderNumber,
      });
    });
    const restaurantName = (rData.name as string | undefined) ?? restaurantId.trim();
    const itemsSummary = validatedItems.map((i) => `${i.quantity}× ${i.name}`).join(", ");

    sendNewOrderAlert({
      restaurantSlug: restaurantId.trim(),
      total,
      paymentMethod: paymentMethod === "whatsapp" ? "whatsapp" : "cash",
      paymentStatus: paymentMethod === "whatsapp" ? "unpaid" : "pending",
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
      paymentMethod: paymentMethod === "whatsapp" ? "whatsapp" : "cash",
      deliveryType: resolvedDeliveryType,
    }).catch(() => {});

    // Funnel analytics (money-truth, non-blocking, never throws)
    await recordServerEvent(restaurantId.trim(), "order_submitted", {
      method: paymentMethod === "whatsapp" ? "whatsapp" : "cash",
      fulfillment: resolvedDeliveryType,
    });

    return NextResponse.json({ orderId, trackingToken }, { status: 201 });
  } catch {
    console.error("Order creation failed");
    return NextResponse.json({ error: "Failed to place order. Please try again." }, { status: 500 });
  }
}
