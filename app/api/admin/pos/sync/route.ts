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

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const {
    localOrderId,
    items,
    paymentMethod,
    paymentStatus,
    customerName,
    note,
    cashierId,
    cashierName,
    deviceId,
    terminalName,
    serviceMode,
    tableLabel,
    waiterName,
    pricingMode,
    createdAt,
  } = body;

  if (!localOrderId) {
    return NextResponse.json({ error: "Missing unique localOrderId" }, { status: 400 });
  }

  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "Order must contain at least one item" }, { status: 400 });
  }

  const db = getAdminDb();
  const restaurantSlug = user.restaurantSlug;

  try {
    // ── 1. DUPLICATE CHECK ───────────────────────────────────────────────────
    const dupSnap = await db
      .collection("orders")
      .where("restaurantId", "==", restaurantSlug)
      .where("localOrderId", "==", localOrderId)
      .limit(1)
      .get();

    if (!dupSnap.empty) {
      const existingDoc = dupSnap.docs[0];
      return NextResponse.json({
        success: true,
        duplicated: true,
        orderId: existingDoc.id,
        total: existingDoc.data().total,
      }, { status: 200 });
    }

    // ── 2. SCHEMA & PRICING INTEGRITY REVALIDATION ────────────────────────────
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
    let priceAuditAlert = false;
    const auditWarnings: string[] = [];

    for (const item of items) {
      const dbItem = menuMap.get(item.id);
      if (!dbItem) {
        return NextResponse.json({ error: `Menu item not found: ${item.name || item.id}` }, { status: 400 });
      }

      // Revalidate item price using server catalog rules
      let serverUnitPrice = 0;
      if (item.customPrice !== undefined && item.customPrice !== null) {
        if (!dbItem.allowCustomPrice) {
          return NextResponse.json({ error: `Custom pricing not allowed for ${dbItem.name}` }, { status: 400 });
        }
        serverUnitPrice = Number(item.customPrice);
      } else {
        const resolvedPricingMode = typeof pricingMode === "string" ? pricingMode : "regular";
        const resolvedBasePrice = (resolvedPricingMode === "indoor" && dbItem.indoorPrice && dbItem.indoorPrice > 0)
          ? dbItem.indoorPrice
          : Number(dbItem.price ?? dbItem.basePrice ?? 0);

        const base = item.selectedSize ? Number(item.selectedSize.price) : resolvedBasePrice;
        const mods = Array.isArray(item.selectedModifiers)
          ? item.selectedModifiers.reduce((sum: number, m: any) => sum + Number(m.price || 0), 0)
          : 0;
        serverUnitPrice = base + mods;
      }

      // Check if price charged offline differs from server's current catalog price
      const offlineUnitPrice = Number(item.price);
      if (offlineUnitPrice !== serverUnitPrice) {
        priceAuditAlert = true;
        auditWarnings.push(
          `Offline price mismatch on "${dbItem.name}": Charged ₦${offlineUnitPrice.toLocaleString("en-NG")} instead of server ₦${serverUnitPrice.toLocaleString("en-NG")}`
        );
      }

      validatedItems.push({
        id: item.id,
        name: dbItem.name,
        price: offlineUnitPrice, // We respect the transaction amount but flag the warning
        basePrice: dbItem.price ?? dbItem.basePrice ?? 0,
        quantity: item.quantity,
        selectedSize: item.selectedSize || null,
        selectedModifiers: item.selectedModifiers || [],
        customPrice: item.customPrice || null,
        itemNote: item.itemNote || "",
        kitchenStation: item.kitchenStation || dbItem.kitchenStation || "kitchen",
      });
      itemsTotal += offlineUnitPrice * item.quantity;
    }

    // Prepare audit logs
    const auditLog: any[] = [];
    auditLog.push({
      action: "offline_order_created",
      staffId: cashierId || user.uid,
      staffName: cashierName || "Offline Staff",
      timestamp: new Date(createdAt || Date.now()).toISOString(),
      details: `Created offline POS order. Cashier: ${cashierName || "Unknown"}. Terminal: ${terminalName || "Unknown"}. Device ID: ${deviceId || "Unknown"}.`,
    });

    auditLog.push({
      action: "offline_order_synced",
      staffId: user.uid,
      staffName: "POS System",
      timestamp: new Date().toISOString(),
      details: `Synchronized transaction to Firestore. Total: ₦${itemsTotal.toLocaleString("en-NG")}`,
    });

    if (priceAuditAlert) {
      auditWarnings.forEach((warning) => {
        auditLog.push({
          action: "price_discrepancy_warning",
          staffId: "system",
          staffName: "System Auditor",
          timestamp: new Date().toISOString(),
          details: warning,
        });
      });
    }

    const resolvedServiceMode: ServiceMode = VALID_SERVICE_MODES.includes(serviceMode as ServiceMode)
      ? (serviceMode as ServiceMode)
      : "counter";

    const resolvedTableLabel = resolvedServiceMode === "dine_in" && typeof tableLabel === "string"
      ? tableLabel.trim()
      : "";

    const isDineIn = resolvedServiceMode === "dine_in";

    let orderNumber = 0;
    const orderRef = db.collection("orders").doc();

    await db.runTransaction(async (transaction) => {
      const rRef = db.collection("restaurants").doc(restaurantSlug);
      const rDoc = await transaction.get(rRef);
      if (!rDoc.exists) {
        throw new Error("Restaurant not found");
      }
      const rDataObj = rDoc.data()!;
      const currentCounter = (rDataObj.orderCounter as number | undefined) ?? 99;
      orderNumber = currentCounter + 1;

      transaction.update(rRef, { orderCounter: orderNumber });
      transaction.set(orderRef, {
        restaurantId: restaurantSlug,
        localOrderId,
        customerName: typeof customerName === "string" && customerName.trim()
          ? customerName.trim()
          : isDineIn ? resolvedTableLabel : "Walk-in Customer",
        phone: "",
        address: "",
        note: typeof note === "string" ? note.trim() : "",
        items: validatedItems,
        itemsTotal,
        deliveryFee: 0,
        total: itemsTotal,
        paymentMethod: VALID_PAYMENT_METHODS.includes(paymentMethod as PaymentMethod) ? paymentMethod : "cash",
        paymentStatus: VALID_PAYMENT_STATUSES.includes(paymentStatus as PaymentStatus) ? paymentStatus : "paid",
        status: "pending",
        deliveryType: isDineIn ? "dine_in" : "counter",
        orderType: "normal",
        orderSource: "counter",
        serviceMode: resolvedServiceMode,
        ...(isDineIn ? { tableLabel: resolvedTableLabel } : {}),
        waiterName: typeof waiterName === "string" ? waiterName.trim() : null,
        pricingMode: typeof pricingMode === "string" ? pricingMode : "regular",
        staffId: cashierId || user.uid,
        staffName: cashierName || "Offline Staff",
        deviceId: deviceId || "unknown",
        terminalName: terminalName || "Terminal",
        createdAt: createdAt ? new Date(createdAt) : new Date(),
        syncedAt: FieldValue.serverTimestamp(),
        priceAuditAlert,
        auditLog,
        orderNumber,
      });
    });

    return NextResponse.json({
      success: true,
      orderId: orderRef.id,
      items: validatedItems,
      itemsTotal,
      total: itemsTotal,
      priceAuditAlert,
      orderNumber,
    }, { status: 201 });
  } catch (error) {
    console.error("POS offline sync failed:", error);
    return NextResponse.json({ error: "Sync failed. Retry in progress." }, { status: 500 });
  }
}
