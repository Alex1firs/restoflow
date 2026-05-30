import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
import { cookies } from "next/headers";
import { FieldValue } from "firebase-admin/firestore";
import { computeSetupChecklist } from "@/lib/setup-checklist";

async function getSessionUser() {
  const cookieStore = await cookies();
  const session = cookieStore.get("__session")?.value;
  if (!session) return null;
  try {
    const decoded = await getAdminAuth().verifySessionCookie(session, true);
    const userDoc = await getAdminDb().collection("users").doc(decoded.uid).get();
    if (!userDoc.exists) return null;
    return { uid: decoded.uid, ...userDoc.data() } as {
      uid: string;
      role: string;
      restaurantSlug: string;
      disabled?: boolean;
    };
  } catch {
    return null;
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  const user = await getSessionUser();
  if (!user || user.disabled) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const canManage =
    user.role === "super_admin" ||
    (user.restaurantSlug === slug && (user.role === "owner" || user.role === "manager"));

  if (!canManage) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body || body.status !== "pending_review") {
    return NextResponse.json({ error: "Invalid status transition" }, { status: 400 });
  }

  const db = getAdminDb();
  const ref = db.collection("restaurants").doc(slug);
  const snap = await ref.get();
  if (!snap.exists) {
    return NextResponse.json({ error: "Restaurant not found" }, { status: 404 });
  }

  const data = snap.data()!;
  const current = (data.status as string | undefined) || "draft";
  if (current !== "draft" && current !== "rejected") {
    return NextResponse.json(
      { error: `Cannot submit from status: ${current}` },
      { status: 400 }
    );
  }

  // Validate checklist
  const menuCountSnap = await db
    .collection("menu_items")
    .where("restaurantId", "==", slug)
    .count()
    .get();
  const menuItemCount = menuCountSnap.data().count;

  const checklist = computeSetupChecklist(data as Record<string, unknown>, menuItemCount);
  if (!checklist.canSubmit) {
    const missing = checklist.items
      .filter((i) => i.required && !i.passed)
      .map((i) => i.label);
    return NextResponse.json(
      {
        error: "Please complete all required setup steps before submitting.",
        missing,
        checklist,
      },
      { status: 422 }
    );
  }

  await ref.update({
    status: "pending_review",
    setupScore: checklist.score,
    rejectionReason: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return NextResponse.json({ success: true, score: checklist.score });
}
