import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { checkSubscriptionAccess } from "@/lib/subscription-guard";

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

  const { tabId, items, staffName } = body as Record<string, unknown>;

  if (typeof tabId !== "string" || !tabId) {
    return NextResponse.json({ error: "tabId is required" }, { status: 400 });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "Items are required" }, { status: 400 });
  }

  const db = getAdminDb();
  const tabRef = db.collection("orders").doc(tabId);

  try {
    const tabSnap = await tabRef.get();
    if (!tabSnap.exists) {
      return NextResponse.json({ error: "Tab not found" }, { status: 404 });
    }

    const tab = tabSnap.data()!;

    if (tab.restaurantId !== user.restaurantSlug) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (tab.serviceMode !== "dine_in") {
      return NextResponse.json({ error: "Tab must be a dine-in order" }, { status: 400 });
    }
    if (tab.paymentStatus === "paid") {
      return NextResponse.json({ error: "Cannot add items to a settled bill" }, { status: 400 });
    }
    if (tab.status === "rejected") {
      return NextResponse.json({ error: "Cannot add items to a cancelled tab" }, { status: 400 });
    }

    // Validate items against trusted server-side menu pricing
    const menuSnap = await db
      .collection("menu_items")
      .where("restaurantId", "==", user.restaurantSlug)
      .get();

    const menuMap = new Map<string, any>();
    for (const doc of menuSnap.docs) {
      menuMap.set(doc.id, { id: doc.id, ...doc.data() });
    }

    const validatedItems: any[] = [];
    let addOnTotal = 0;

    for (const item of items as any[]) {
      if (
        typeof item.id !== "string" || !item.id ||
        typeof item.quantity !== "number" || !Number.isInteger(item.quantity) || item.quantity < 1
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

      // Calculate unit price
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
      addOnTotal += unitPrice * item.quantity;
    }

    // Merge items into the tab's accumulating item list
    const existingItems = (tab.items as any[]) ?? [];
    const mergedItems = [...existingItems];
    for (const newItem of validatedItems) {
      const idx = mergedItems.findIndex((i) => {
        if (i.id !== newItem.id) return false;
        
        // Match size name
        const sizeA = i.selectedSize?.name || null;
        const sizeB = newItem.selectedSize?.name || null;
        if (sizeA !== sizeB) return false;

        // Match custom price
        if (i.customPrice !== newItem.customPrice) return false;

        // Match note
        if ((i.itemNote || "") !== (newItem.itemNote || "")) return false;

        // Match modifiers list
        const modsA = Array.isArray(i.selectedModifiers) ? i.selectedModifiers.map((m: any) => `${m.groupName}:${m.name}`).sort().join(",") : "";
        const modsB = Array.isArray(newItem.selectedModifiers) ? newItem.selectedModifiers.map((m: any) => `${m.groupName}:${m.name}`).sort().join(",") : "";
        if (modsA !== modsB) return false;

        return true;
      });

      if (idx >= 0) {
        mergedItems[idx] = { ...mergedItems[idx], quantity: mergedItems[idx].quantity + newItem.quantity };
      } else {
        mergedItems.push(newItem);
      }
    }
    const newItemsTotal = mergedItems.reduce((s, i) => s + i.price * i.quantity, 0);

    const resolvedStaffName = typeof staffName === "string" ? staffName.trim() : "";
    const existingBatches = Array.isArray(tab.itemBatches) ? (tab.itemBatches as unknown[]) : [];
    const batchIndex = existingBatches.length;

    // Atomic batch write: update main tab + create kitchen add-on ticket
    const writeBatch = db.batch();

    writeBatch.update(tabRef, {
      items: mergedItems,
      itemsTotal: newItemsTotal,
      total: newItemsTotal,
      itemBatches: [
        ...existingBatches,
        {
          batchIndex,
          addedAt: new Date().toISOString(),
          staffId: user.uid,
          staffName: resolvedStaffName,
          items: validatedItems,
          addOnTotal,
        },
      ],
      lastAddedAt: FieldValue.serverTimestamp(),
      lastAddedByStaffId: user.uid,
      lastAddedByStaffName: resolvedStaffName,
    });

    // Kitchen-only ticket: has its own status lifecycle, total=0 to avoid double-counting
    const kitchenRef = db.collection("orders").doc();
    writeBatch.set(kitchenRef, {
      restaurantId: user.restaurantSlug,
      parentTabId: tabId,
      orderType: "addon",
      tableLabel: tab.tableLabel ?? "",
      serviceMode: "dine_in",
      deliveryType: "dine_in",
      orderSource: "counter",
      customerName: tab.customerName ?? "",
      items: validatedItems,
      itemsTotal: addOnTotal,
      total: 0,
      paymentMethod: "unpaid",
      paymentStatus: "unpaid",
      status: "pending",
      note: "",
      phone: "",
      address: "",
      staffId: user.uid,
      staffName: resolvedStaffName,
      deliveryFee: 0,
      batchIndex,
      createdAt: FieldValue.serverTimestamp(),
    });

    await writeBatch.commit();

    return NextResponse.json({
      success: true,
      tabId,
      kitchenTicketId: kitchenRef.id,
      addedItems: validatedItems,
      addOnTotal,
      newTotal: newItemsTotal,
      newItemsTotal,
      batchIndex,
    });
  } catch (error) {
    console.error("Add to tab failed:", error);
    return NextResponse.json(
      { error: "Failed to add items to tab. Please try again." },
      { status: 500 }
    );
  }
}
