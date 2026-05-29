import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { checkSubscriptionAccess } from "@/lib/subscription-guard";

const VALID_PAYMENT_METHODS = ["cash", "bank_transfer", "card", "unpaid"] as const;
const VALID_PAYMENT_STATUSES = ["paid", "unpaid", "part_paid", "cancelled"] as const;
const VALID_SERVICE_MODES = ["counter", "dine_in"] as const;

type PaymentMethod = (typeof VALID_PAYMENT_METHODS)[number];
type PaymentStatus = (typeof VALID_PAYMENT_STATUSES)[number];
type ServiceMode = (typeof VALID_SERVICE_MODES)[number];

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

  const {
    items,
    paymentMethod,
    paymentStatus,
    customerName,
    note,
    staffName,
    serviceMode,
    tableLabel,
  } = body as Record<string, unknown>;

  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "Order must contain at least one item" }, { status: 400 });
  }

  if (!VALID_PAYMENT_METHODS.includes(paymentMethod as PaymentMethod)) {
    return NextResponse.json({ error: "Invalid payment method" }, { status: 400 });
  }

  if (!VALID_PAYMENT_STATUSES.includes(paymentStatus as PaymentStatus)) {
    return NextResponse.json({ error: "Invalid payment status" }, { status: 400 });
  }

  const resolvedServiceMode: ServiceMode = VALID_SERVICE_MODES.includes(serviceMode as ServiceMode)
    ? (serviceMode as ServiceMode)
    : "counter";

  const resolvedTableLabel =
    resolvedServiceMode === "dine_in" && typeof tableLabel === "string"
      ? tableLabel.trim()
      : "";

  if (resolvedServiceMode === "dine_in" && !resolvedTableLabel) {
    return NextResponse.json(
      { error: "Table number is required for dine-in orders" },
      { status: 400 }
    );
  }

  try {
    const db = getAdminDb();
    const restaurantSlug = user.restaurantSlug;

    const menuSnap = await db
      .collection("prepared_items")
      .where("restaurantId", "==", restaurantSlug)
      .get();

    const menuMap = new Map<string, any>();
    for (const doc of menuSnap.docs) {
      menuMap.set(doc.id, { id: doc.id, ...doc.data() });
    }

    const validatedItems: any[] = [];
    let itemsTotal = 0;

    for (const item of items as any[]) {
      if (
        typeof item.id !== "string" ||
        !item.id ||
        typeof item.quantity !== "number" ||
        !Number.isInteger(item.quantity) ||
        item.quantity < 1
      ) {
        return NextResponse.json({ error: "Invalid item in order" }, { status: 400 });
      }
      const dbItem = menuMap.get(item.id);
      if (!dbItem) {
        return NextResponse.json(
          { error: "Item not found or does not belong to this restaurant" },
          { status: 400 }
        );
      }
      if (dbItem.available === false) {
        return NextResponse.json(
          { error: `"${dbItem.name}" is currently unavailable` },
          { status: 400 }
        );
      }

      // Calculate unit price: size base price or base price + sum(modifiers)
      let unitPrice = 0;
      if (item.customPrice !== undefined && item.customPrice !== null) {
        if (!dbItem.allowCustomPrice) {
          return NextResponse.json(
            { error: `Custom pricing is not enabled for "${dbItem.name}"` },
            { status: 400 }
          );
        }
        unitPrice = Number(item.customPrice);
      } else {
        const base = item.selectedSize ? Number(item.selectedSize.price) : Number(dbItem.basePrice ?? dbItem.price ?? 0);
        const mods = Array.isArray(item.selectedModifiers)
          ? item.selectedModifiers.reduce((sum: number, m: any) => sum + Number(m.price || 0), 0)
          : 0;
        unitPrice = base + mods;
      }

      validatedItems.push({
        id: item.id,
        name: dbItem.name,
        price: unitPrice,
        basePrice: dbItem.basePrice ?? dbItem.price ?? 0,
        quantity: item.quantity,
        selectedSize: item.selectedSize || null,
        selectedModifiers: item.selectedModifiers || [],
        customPrice: item.customPrice || null,
        itemNote: item.itemNote || "",
        kitchenStation: item.kitchenStation || dbItem.kitchenStation || "kitchen",
      });
      itemsTotal += unitPrice * item.quantity;
    }

    const total = itemsTotal;
    const isDineIn = resolvedServiceMode === "dine_in";

    const auditLog = (body as any).auditLog || [];
    auditLog.push({
      action: "order_created",
      staffId: user.uid,
      staffName: typeof staffName === "string" ? staffName.trim() : "Staff",
      timestamp: new Date().toISOString(),
      details: `Created counter POS order with ${validatedItems.length} items. Total: ₦${itemsTotal.toLocaleString("en-NG")}`,
    });

    const orderRef = await db.collection("orders").add({
      restaurantId: restaurantSlug,
      customerName:
        typeof customerName === "string" && customerName.trim()
          ? customerName.trim()
          : isDineIn
          ? resolvedTableLabel
          : "Walk-in Customer",
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
      deliveryType: isDineIn ? "dine_in" : "counter",
      orderType: "normal",
      orderSource: "counter",
      serviceMode: resolvedServiceMode,
      ...(isDineIn ? { tableLabel: resolvedTableLabel } : {}),
      staffId: user.uid,
      staffName: typeof staffName === "string" ? staffName.trim() : "",
      createdAt: FieldValue.serverTimestamp(),
      auditLog,
    });

    return NextResponse.json(
      {
        orderId: orderRef.id,
        items: validatedItems,
        itemsTotal,
        total,
        serviceMode: resolvedServiceMode,
        tableLabel: resolvedTableLabel,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("POS order creation failed:", error);
    return NextResponse.json({ error: "Failed to create order. Please try again." }, { status: 500 });
  }
}
