import { NextRequest, NextResponse } from "next/server";
import { getSuperAdminUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

async function guardSuperAdmin() {
  try {
    return await getSuperAdminUser();
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const admin = await guardSuperAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const slug = typeof body.slug === "string" ? body.slug.trim() : null;
  if (!slug) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  try {
    const db = getAdminDb();
    const docRef = db.collection("restaurants").doc(slug);
    const snap = await docRef.get();
    if (!snap.exists) return NextResponse.json({ error: "Restaurant not found" }, { status: 404 });

    await docRef.update({
      assistanceStatus: "open",
      assistanceRequested: true,
      assistanceRequestedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
