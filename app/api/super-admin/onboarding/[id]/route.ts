import { NextRequest, NextResponse } from "next/server";
import { getSuperAdminUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await getSuperAdminUser(); } catch { return NextResponse.json({ error: "Forbidden" }, { status: 403 }); }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body?.action) return NextResponse.json({ error: "action required" }, { status: 400 });

  const ref = getAdminDb().collection("onboardings").doc(id);
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });

  switch (body.action) {
    case "approve":
      await ref.update({ status: "complete", approvedAt: FieldValue.serverTimestamp() });
      break;
    case "reject":
      await ref.update({ status: "rejected", rejectedAt: FieldValue.serverTimestamp() });
      break;
    case "reset":
      await ref.update({ status: "pending" });
      break;
    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
