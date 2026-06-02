import { type NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";

export async function GET(req: NextRequest) {
  const restaurantId = req.nextUrl.searchParams.get("restaurantId");
  if (!restaurantId) {
    return NextResponse.json({ error: "Missing restaurantId parameter" }, { status: 400 });
  }

  try {
    const db = getAdminDb();
    const snap = await db
      .collection("menu_items")
      .where("restaurantId", "==", restaurantId)
      .where("available", "==", true)
      .get();

    const items = snap.docs.map((doc) => ({
      id: doc.id,
      name: doc.data().name as string,
      price: doc.data().price as number,
      category: doc.data().category as string,
      description: doc.data().description as string,
    }));

    return NextResponse.json({ items });
  } catch (err) {
    console.error("Failed to fetch menu items for customer edit:", err);
    return NextResponse.json({ error: "Failed to fetch menu items" }, { status: 500 });
  }
}
