import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";

export async function GET() {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try {
    user = await getAuthenticatedUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const snap = await getAdminDb()
      .collection("users")
      .where("restaurantSlug", "==", user.restaurantSlug)
      .get();

    const staff = snap.docs
      .map((doc) => {
        const d = doc.data();
        return {
          staffId: doc.id,
          staffName: (d.displayName as string) ?? (d.email as string) ?? "",
          role: (d.role as string) ?? "staff",
          pinSalt: (d.pinSalt as string) ?? "",
          pinHash: (d.pinHash as string) ?? "",
          isActive: !(d.disabled as boolean),
          lastSyncedAt: Date.now(),
        };
      })
      .filter((s) => s.role !== "super_admin");

    return NextResponse.json({ staff });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed to sync staff";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
