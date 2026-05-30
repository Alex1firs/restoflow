import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";

export async function POST(request: NextRequest) {
  let user;
  try {
    user = await getAuthenticatedUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { name } = body;
  if (!name || typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "Waiter name is required" }, { status: 400 });
  }

  const db = getAdminDb();
  try {
    const docRef = await db.collection("waiters").add({
      restaurantId: user.restaurantSlug,
      name: name.trim(),
      createdAt: new Date(),
    });
    return NextResponse.json({ id: docRef.id, name: name.trim() });
  } catch (e: any) {
    console.error("Failed to add waiter:", e);
    return NextResponse.json({ error: "Failed to add waiter" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  let user;
  try {
    user = await getAuthenticatedUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "Waiter ID is required" }, { status: 400 });
  }

  const db = getAdminDb();
  try {
    const docRef = db.collection("waiters").doc(id);
    const docSnap = await docRef.get();
    if (!docSnap.exists) {
      return NextResponse.json({ error: "Waiter not found" }, { status: 404 });
    }

    if (docSnap.data()?.restaurantId !== user.restaurantSlug) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    await docRef.delete();
    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error("Failed to delete waiter:", e);
    return NextResponse.json({ error: "Failed to delete waiter" }, { status: 500 });
  }
}
