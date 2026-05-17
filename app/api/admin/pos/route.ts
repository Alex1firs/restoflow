import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

const VALID_PAYMENT_METHODS = ["cash", "bank_transfer", "card", "unpaid"] as const;
const VALID_PAYMENT_STATUSES = ["paid", "unpaid", "part_paid", "cancelled"] as const;

type PaymentMethod = (typeof VALID_PAYMENT_METHODS)[number];
type PaymentStatus = (typeof VALID_PAYMENT_STATUSES)[number];

export async function POST(request: NextRequest) {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try {
    user = await getAuthenticatedUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { items, paymentMethod, paymentStatus, customerName, note, staffName } =
    body as Record<string, unknown>;

  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "Order must contain at least one item" }, { status: 400 });
  }

  if (!VALID_PAYMENT_METHODS.includes(paymentMethod as PaymentMethod)) {
    return NextResponse.json({ error: "Invalid payment method" }, { status: 400 });
  }

  if (!VALID_PAYMENT_STATUSES.includes(paymentStatus as PaymentStatus)) {
    return NextResponse.json({ error: "Invalid payment status" }, { status: 400 });
  }

  try {
    const db = getAdminDb();
    const restaurantSlug = user.restaurantSlug;

    const menuSnap = await db
      .collection("menu_items")
      .where("restaurantId", "==", restaurantSlug)
      .get();

    const menuMap = new Map<string, { name: string; price: number; available: boolean }>();
    for (const doc of menuSnap.docs) {
      const d = doc.data();
      menuMap.set(doc.id, {
        name: d.name as string,
        price: d.price as number,
        available: (d.available as boolean) ?? true,
      });
    }

    const validatedItems: { id: string; name: string; price: number; quantity: number }[] = [];
    let itemsTotal = 0;

    for (const item of items as { id: string; quantity: number }[]) {
      if (
        typeof item.id !== "string" ||
        !item.id ||
        typeof item.quantity !== "number" ||
        !Number.isInteger(item.quantity) ||
        item.quantity < 1
      ) {
        return NextResponse.json({ error: "Invalid item in order" }, { status: 400 });
      }
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

    const total = itemsTotal;

    const orderRef = await db.collection("orders").add({
      restaurantId: restaurantSlug,
      customerName: typeof customerName === "string" && customerName.trim() ? customerName.trim() : "Walk-in Customer",
      phone: "",
      address: "",
      note: typeof note === "string" ? note.trim() : "",
      items: validatedItems,
      itemsTotal,
      deliveryFee: 0,
      total,
      paymentMethod,
      paymentStatus,
      status: "pending",
      deliveryType: "counter",
      orderType: "normal",
      orderSource: "counter",
      staffId: user.uid,
      staffName: typeof staffName === "string" ? staffName.trim() : "",
      createdAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json(
      { orderId: orderRef.id, items: validatedItems, itemsTotal, total },
      { status: 201 }
    );
  } catch (error) {
    console.error("POS order creation failed:", error);
    return NextResponse.json({ error: "Failed to create order. Please try again." }, { status: 500 });
  }
}
