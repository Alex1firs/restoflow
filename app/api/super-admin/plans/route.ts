import { NextRequest, NextResponse } from "next/server";
import { getSuperAdminUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

export async function POST(req: NextRequest) {
  try { await getSuperAdminUser(); } catch { return NextResponse.json({ error: "Forbidden" }, { status: 403 }); }

  const body = await req.json().catch(() => null);
  if (!body?.id || !body?.name) return NextResponse.json({ error: "id and name are required" }, { status: 400 });

  await getAdminDb().collection("plans").doc(body.id).set({
    id: body.id,
    name: body.name,
    monthlyPrice: Number(body.monthlyPrice) || 0,
    setupFee: Number(body.setupFee) || 0,
    features: Array.isArray(body.features) ? body.features : [],
    disabled: false,
    createdAt: FieldValue.serverTimestamp(),
  });

  return NextResponse.json({ success: true }, { status: 201 });
}
