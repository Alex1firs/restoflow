import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

export async function GET() {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try { user = await getAuthenticatedUser(); } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }

  if (user.role !== "owner" && user.role !== "manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const snap = await getAdminDb()
    .collection("users")
    .where("restaurantSlug", "==", user.restaurantSlug)
    .get();

  const staff = snap.docs
    .map((doc) => {
      const d = doc.data();
      return {
        uid: doc.id,
        email: (d.email as string) ?? "",
        displayName: (d.displayName as string) ?? "",
        role: (d.role as string) ?? "owner",
        disabled: (d.disabled as boolean) ?? false,
        createdAt: d.createdAt ? (d.createdAt.toDate ? d.createdAt.toDate().toISOString() : new Date((d.createdAt.seconds ?? 0) * 1000).toISOString()) : null,
      };
    })
    .filter((s) => s.role !== "super_admin");

  return NextResponse.json({ staff });
}

export async function POST(req: NextRequest) {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try { user = await getAuthenticatedUser(); } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }

  if (user.role !== "owner") {
    return NextResponse.json({ error: "Only the owner can create staff accounts" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const { email, displayName, role } = body as { email?: string; displayName?: string; role?: string };

  if (!email?.trim()) return NextResponse.json({ error: "Email is required" }, { status: 400 });
  if (!["manager", "staff"].includes(role ?? "")) return NextResponse.json({ error: "Role must be manager or staff" }, { status: 400 });

  const tempPassword = Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-4).toUpperCase() + "!1";

  try {
    const authUser = await getAdminAuth().createUser({
      email: email.trim(),
      password: tempPassword,
      displayName: displayName?.trim() || undefined,
    });

    const resetLink = await getAdminAuth().generatePasswordResetLink(email.trim());

    await getAdminDb().collection("users").doc(authUser.uid).set({
      email: email.trim(),
      displayName: displayName?.trim() ?? "",
      restaurantSlug: user.restaurantSlug,
      role,
      disabled: false,
      createdBy: user.uid,
      createdAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ uid: authUser.uid, resetLink }, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to create staff account";
    return NextResponse.json({ error: msg }, { status: 422 });
  }
}
