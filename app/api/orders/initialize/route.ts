import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { checkIsOpen } from "@/lib/restaurant-utils";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { restaurantId, customerName, phone, address, note, items, deliveryType } =
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

    if (!checkIsOpen(rData.openingHours as Parameters<typeof checkIsOpen>[0])) {
      return NextResponse.json({ error: "The restaurant is currently closed." }, { status: 422 });
    }

    const subaccountCode = rData.paystackSubaccountCode as string | undefined;
    if (!subaccountCode) {
      return NextResponse.json({ error: "Online payments are not set up for this restaurant." }, { status: 422 });
    }

    const deliveryFee = (rData.deliveryFee as number) ?? 0;
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
    const amountKobo = Math.round(total * 100);
    const callbackUrl = `${process.env.NEXT_PUBLIC_APP_URL}/r/${restaurantId.trim()}/payment/callback`;

    const paystackRes = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: "orders@restoflow.app",
        amount: amountKobo,
        currency: "NGN",
        subaccount: subaccountCode,
        bearer: "subaccount",
        callback_url: callbackUrl,
        metadata: { paymentType: "order", restaurantId: restaurantId.trim() },
      }),
    });

    if (!paystackRes.ok) {
      console.error("Paystack init error:", await paystackRes.text());
      return NextResponse.json({ error: "Payment provider error. Please try again." }, { status: 502 });
    }

    const { data: paystackData } = await paystackRes.json();
    const reference = paystackData.reference as string;
    const authorizationUrl = paystackData.authorization_url as string;

    await db.collection("pending_payments").doc(reference).set({
      restaurantId: restaurantId.trim(),
      customerName: customerName.trim(),
      phone: phone.trim(),
      address: address.trim(),
      note: typeof note === "string" ? note.trim() : "",
      items: validatedItems,
      itemsTotal,
      deliveryFee,
      total,
      deliveryType: deliveryType === "pickup" ? "pickup" : "delivery",
      createdAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ authorizationUrl, reference });
  } catch (error) {
    console.error("Order initialize failed:", error);
    return NextResponse.json({ error: "Failed to initialize payment. Please try again." }, { status: 500 });
  }
}
