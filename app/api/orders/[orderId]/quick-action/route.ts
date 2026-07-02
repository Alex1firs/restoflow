import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

export async function POST(req: NextRequest, { params }: { params: Promise<{ orderId: string }> }) {
  try {
    const { orderId } = await params;
    const body = await req.json().catch(() => null);
    
    if (!body || !body.pin || !body.actionType || !body.slug) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    
    const { pin, actionType, slug } = body;
    const db = getAdminDb();
    
    const restaurantRef = db.collection("restaurants").doc(slug);
    const restaurantSnap = await restaurantRef.get();
    
    if (!restaurantSnap.exists) {
      return NextResponse.json({ error: "Restaurant not found" }, { status: 404 });
    }
    
    const restaurantData = restaurantSnap.data()!;
    
    if (!restaurantData.whatsappCheckoutEnabled) {
      return NextResponse.json({ error: "Quick actions are disabled for this restaurant" }, { status: 403 });
    }
    
    if (restaurantData.whatsappAdminPin !== pin) {
      return NextResponse.json({ error: "Invalid PIN" }, { status: 401 });
    }
    
    const orderRef = db.collection("orders").doc(orderId);
    const orderSnap = await orderRef.get();
    
    if (!orderSnap.exists) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }
    
    const orderData = orderSnap.data()!;
    if (orderData.restaurantId !== slug) {
      return NextResponse.json({ error: "Order does not belong to this restaurant" }, { status: 403 });
    }
    
    if (actionType === "accept") {
      await orderRef.update({
        paymentStatus: "paid",
        status: "pending",
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else if (actionType === "reject") {
      await orderRef.update({
        status: "voided",
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
    
    return NextResponse.json({ success: true });
    
  } catch (error) {
    console.error("Quick action failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
