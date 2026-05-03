import { NextRequest, NextResponse } from "next/server";
import { getSuperAdminUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ planId: string }> }) {
  try { await getSuperAdminUser(); } catch { return NextResponse.json({ error: "Forbidden" }, { status: 403 }); }

  const { planId } = await params;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const update: Record<string, unknown> = {};
  if (typeof body.name === "string") update.name = body.name;
  if (typeof body.monthlyPrice === "number") update.monthlyPrice = body.monthlyPrice;
  if (typeof body.setupFee === "number") update.setupFee = body.setupFee;
  if (typeof body.disabled === "boolean") update.disabled = body.disabled;
  if (Array.isArray(body.features)) update.features = body.features;

  await getAdminDb().collection("plans").doc(planId).set(update, { merge: true });
  return NextResponse.json({ success: true });
}
