import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { checkSubscriptionAccess } from "@/lib/subscription-guard";
import {
  commitPosOrder,
  createPosOrderUnkeyed,
  orderFingerprint,
  type FingerprintItem,
  validateLocalOrderId,
  type FirestoreLike,
} from "@/lib/pos/idempotency";

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
    waiterName,
    pricingMode,
    localOrderId,
  } = body as Record<string, unknown>;

  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "Order must contain at least one item" }, { status: 400 });
  }

  // Idempotency key. Optional DURING THE ROLLOUT ONLY: the POS is an installable
  // PWA, so a terminal may still be running a cached bundle that predates this
  // field, and rejecting those would take a live till offline mid-service.
  //
  // A request without a key has NO duplicate protection, so this is a temporary
  // state with a defined end: once the legacy-client warning below stops
  // appearing in logs, set POS_REQUIRE_IDEMPOTENCY_KEY=true to close it.
  // See docs/POS_IDEMPOTENCY_ROLLOUT.md.
  const hasKey = localOrderId !== undefined && localOrderId !== null && localOrderId !== "";
  if (hasKey) {
    const keyError = validateLocalOrderId(localOrderId);
    if (keyError) {
      return NextResponse.json({ error: keyError }, { status: 400 });
    }
  } else if (process.env.POS_REQUIRE_IDEMPOTENCY_KEY === "true") {
    console.warn(
      `POS legacy client REJECTED (enforcement on). restaurant=${user.restaurantSlug} staffId=${user.uid}`
    );
    return NextResponse.json(
      { error: "This point-of-sale app is out of date. Please reload the page to continue." },
      { status: 426 }
    );
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
        const resolvedPricingMode = typeof pricingMode === "string" ? pricingMode : "regular";
        const resolvedBasePrice = (resolvedPricingMode === "indoor" && dbItem.indoorPrice && dbItem.indoorPrice > 0)
          ? dbItem.indoorPrice
          : Number(dbItem.price ?? dbItem.basePrice ?? 0);

        const base = item.selectedSize ? Number(item.selectedSize.price) : resolvedBasePrice;
        const mods = Array.isArray(item.selectedModifiers)
          ? item.selectedModifiers.reduce((sum: number, m: any) => sum + Number(m.price || 0), 0)
          : 0;
        unitPrice = base + mods;
      }

      validatedItems.push({
        id: item.id,
        menuItemId: dbItem.menuItemId ?? null,
        name: dbItem.name,
        price: unitPrice,
        basePrice: dbItem.price ?? dbItem.basePrice ?? 0,
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

    const buildOrderData = (orderNumber: number) => ({
      restaurantId: restaurantSlug,
      ...(hasKey ? { localOrderId: localOrderId as string } : {}),
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
      waiterName: typeof waiterName === "string" ? waiterName.trim() : null,
      pricingMode: typeof pricingMode === "string" ? pricingMode : "regular",
      staffId: user.uid,
      staffName: typeof staffName === "string" ? staffName.trim() : "",
      createdAt: FieldValue.serverTimestamp(),
      auditLog,
      orderNumber,
    });

    const result = hasKey
      ? await commitPosOrder({
          db: db as unknown as FirestoreLike,
          restaurantId: restaurantSlug,
          localOrderId: localOrderId as string,
          fingerprint: orderFingerprint({
            items: items as FingerprintItem[],
            serviceMode: resolvedServiceMode,
            tableLabel: resolvedTableLabel,
            note: typeof note === "string" ? note.trim() : "",
            pricingMode: typeof pricingMode === "string" ? pricingMode : "regular",
          }),
          source: "online",
          buildOrderData,
        })
      : await (async () => {
          // Deployment signal: a terminal on a cached pre-idempotency bundle has
          // NO duplicate protection. Tracked so the compatibility window can be
          // closed once this stops appearing. See docs/POS_IDEMPOTENCY_ROLLOUT.md
          console.warn(
            `POS legacy client: order created without localOrderId. restaurant=${restaurantSlug} staffId=${user.uid}`
          );
          return createPosOrderUnkeyed({
            db: db as unknown as FirestoreLike,
            restaurantId: restaurantSlug,
            buildOrderData,
          });
        })();

    // A claim with no order behind it. Never paper over it by writing a
    // replacement — that is how duplicates come back.
    if (result.outcome === "missing_order") {
      console.error(
        `POS INTEGRITY: claim resolves to a missing order. restaurant=${restaurantSlug} localOrderId=${localOrderId} orderId=${result.orderId || "(empty)"}`
      );
      return NextResponse.json(
        { error: "Could not complete this order. Please contact support." },
        { status: 500 }
      );
    }

    // Same key, materially different order. Never overwrite, never duplicate.
    if (result.outcome === "conflict") {
      console.error(
        `POS idempotency conflict: restaurant=${restaurantSlug} localOrderId=${localOrderId} existingOrderId=${result.orderId}`
      );
      return NextResponse.json(
        { error: "This order reference is already in use for a different order.", conflict: true },
        { status: 409 }
      );
    }

    // Replay: return the canonical order that already exists. No order number
    // was consumed and nothing was written.
    if (result.outcome === "replayed") {
      const existing = await db.collection("orders").doc(result.orderId).get();
      const data = existing.data() ?? {};
      return NextResponse.json(
        {
          orderId: result.orderId,
          items: data.items ?? validatedItems,
          itemsTotal: data.itemsTotal ?? itemsTotal,
          total: data.total ?? total,
          serviceMode: data.serviceMode ?? resolvedServiceMode,
          tableLabel: data.tableLabel ?? resolvedTableLabel,
          orderNumber: data.orderNumber ?? result.orderNumber,
          replayed: true,
        },
        { status: 200 }
      );
    }

    return NextResponse.json(
      {
        orderId: result.orderId,
        items: validatedItems,
        itemsTotal,
        total,
        serviceMode: resolvedServiceMode,
        tableLabel: resolvedTableLabel,
        orderNumber: result.orderNumber,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("POS order creation failed:", error);
    return NextResponse.json({ error: "Failed to create order. Please try again." }, { status: 500 });
  }
}
