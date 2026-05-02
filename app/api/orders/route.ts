import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { restaurantId, customerName, phone, address, note, items } =
    body as Record<string, unknown>;

  // Validate required string fields
  if (
    typeof restaurantId !== "string" || !restaurantId.trim() ||
    typeof customerName !== "string" || !customerName.trim() ||
    typeof phone !== "string" || !phone.trim() ||
    typeof address !== "string" || !address.trim()
  ) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Validate items array — only id and quantity are accepted from the client
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json(
      { error: "Order must contain at least one item" },
      { status: 400 }
    );
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

    // Verify the restaurant exists
    const restaurantDoc = await db
      .collection("restaurants")
      .doc(restaurantId.trim())
      .get();

    if (!restaurantDoc.exists) {
      return NextResponse.json({ error: "Restaurant not found" }, { status: 404 });
    }

    // Fetch all menu items for this restaurant from the database.
    // Prices are NEVER taken from the client — they come from here.
    const menuSnap = await db
      .collection("menu_items")
      .where("restaurantId", "==", restaurantId.trim())
      .get();

    const menuMap = new Map<
      string,
      { name: string; price: number; available: boolean }
    >();
    for (const doc of menuSnap.docs) {
      menuMap.set(doc.id, {
        name: doc.data().name as string,
        price: doc.data().price as number,
        available: doc.data().available as boolean,
      });
    }

    // Validate every ordered item: must belong to this restaurant and be available
    const validatedItems: {
      id: string;
      name: string;
      price: number;
      quantity: number;
    }[] = [];
    let total = 0;

    for (const item of items as { id: string; quantity: number }[]) {
      const menuItem = menuMap.get(item.id);

      if (!menuItem) {
        return NextResponse.json(
          { error: "Item not found or does not belong to this restaurant" },
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
        name: menuItem.name,
        price: menuItem.price,  // price from DB — any client-supplied price is ignored
        quantity: item.quantity,
      });

      total += menuItem.price * item.quantity;
    }

    // Write the order — total is computed server-side from verified DB prices
    const orderRef = await db.collection("orders").add({
      restaurantId: restaurantId.trim(),
      customerName: customerName.trim(),
      phone: phone.trim(),
      address: address.trim(),
      note: typeof note === "string" ? note.trim() : "",
      items: validatedItems,
      total,
      paymentMethod: "cash",
      paymentStatus: "pending",
      status: "pending",
      createdAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ orderId: orderRef.id }, { status: 201 });
  } catch (error) {
    console.error("Order creation failed:", error);
    return NextResponse.json(
      { error: "Failed to place order. Please try again." },
      { status: 500 }
    );
  }
}
