import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

export async function POST() {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try {
    user = await getAuthenticatedUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (user.role !== "owner") {
    return NextResponse.json({ error: "Only the owner can disconnect Google" }, { status: 403 });
  }

  const db = getAdminDb();

  await Promise.all([
    db.collection("google_tokens").doc(user.restaurantSlug).delete(),
    db.collection("restaurants").doc(user.restaurantSlug).update({
      "googleBusiness.connected": false,
      "googleBusiness.connectedEmail": FieldValue.delete(),
      "googleBusiness.googleUserId": FieldValue.delete(),
      "googleBusiness.profileStatus": "not_connected",
      "googleBusiness.lastSyncError": FieldValue.delete(),
    }),
  ]);

  return NextResponse.json({ success: true });
}
