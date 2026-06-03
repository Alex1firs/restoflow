import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { sendStaffSetupEmail } from "@/lib/email";

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
        pinSet: !!d.pinHash,
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

  // randomBytes gives cryptographically secure randomness; Math.random() does not.
  const tempPassword = randomBytes(12).toString("base64url") + "!1A";

  try {
    const authUser = await getAdminAuth().createUser({
      email: email.trim(),
      password: tempPassword,
      displayName: displayName?.trim() || undefined,
    });

    const resetLink = await getAdminAuth().generatePasswordResetLink(email.trim());

    // Store the reset link in the user doc so it can be retrieved via Admin SDK
    // by a super-admin if email delivery is not yet configured. Never expose it
    // in an API response — reset links are single-use credentials.
    await getAdminDb().collection("users").doc(authUser.uid).set({
      email: email.trim(),
      displayName: displayName?.trim() ?? "",
      restaurantSlug: user.restaurantSlug,
      role,
      disabled: false,
      createdBy: user.uid,
      pendingResetLink: resetLink,
      createdAt: FieldValue.serverTimestamp(),
    });

    // Fetch restaurant name for the email subject
    const restaurantDoc = await getAdminDb().collection("restaurants").doc(user.restaurantSlug).get();
    const restaurantName = (restaurantDoc.data()?.name as string | undefined) ?? user.restaurantSlug;

    // Non-fatal — reset link is also stored in users/{uid}.pendingResetLink as fallback
    sendStaffSetupEmail(email.trim(), displayName?.trim() ?? "", restaurantName, resetLink).catch(() => {
      console.error("[staff] email delivery failed");
    });

    return NextResponse.json({ uid: authUser.uid }, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to create staff account";
    return NextResponse.json({ error: msg }, { status: 422 });
  }
}
