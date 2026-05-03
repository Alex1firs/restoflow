import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ staffId: string }> }) {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try { user = await getAuthenticatedUser(); } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }

  if (user.role !== "owner") return NextResponse.json({ error: "Only the owner can manage staff" }, { status: 403 });

  const { staffId } = await params;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const staffDoc = await getAdminDb().collection("users").doc(staffId).get();
  if (!staffDoc.exists) return NextResponse.json({ error: "Staff not found" }, { status: 404 });

  const staffData = staffDoc.data()!;
  if (staffData.restaurantSlug !== user.restaurantSlug) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (staffData.role === "owner") return NextResponse.json({ error: "Cannot modify the owner account" }, { status: 403 });

  const update: Record<string, unknown> = {};
  if (typeof body.disabled === "boolean") update.disabled = body.disabled;
  if (["manager", "staff"].includes(body.role)) update.role = body.role;

  await getAdminDb().collection("users").doc(staffId).update(update);

  if (typeof body.disabled === "boolean") {
    await getAdminAuth().updateUser(staffId, { disabled: body.disabled });
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ staffId: string }> }) {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try { user = await getAuthenticatedUser(); } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }

  if (user.role !== "owner") return NextResponse.json({ error: "Only the owner can delete staff" }, { status: 403 });

  const { staffId } = await params;

  const staffDoc = await getAdminDb().collection("users").doc(staffId).get();
  if (!staffDoc.exists) return NextResponse.json({ error: "Staff not found" }, { status: 404 });

  const staffData = staffDoc.data()!;
  if (staffData.restaurantSlug !== user.restaurantSlug) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (staffData.role === "owner") return NextResponse.json({ error: "Cannot delete the owner account" }, { status: 403 });

  await getAdminAuth().deleteUser(staffId);
  await getAdminDb().collection("users").doc(staffId).delete();

  return NextResponse.json({ success: true });
}
