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

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const admin = await guardSuperAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { slug } = await params;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const { action, days, planId } = body as { action: string; days?: number; planId?: string };
  const db = getAdminDb();
  const ref = db.collection("restaurants").doc(slug);
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ error: "Restaurant not found" }, { status: 404 });

  const now = new Date();

  switch (action) {
    case "activate": {
      const endDate = new Date(now);
      endDate.setDate(endDate.getDate() + 30);
      await ref.update({
        subscriptionStatus: "active",
        subscriptionStartDate: now,
        subscriptionEndDate: endDate,
        updatedAt: FieldValue.serverTimestamp(),
      });
      break;
    }
    case "suspend": {
      await ref.update({ subscriptionStatus: "suspended", updatedAt: FieldValue.serverTimestamp() });
      break;
    }
    case "expire": {
      const pastDate = new Date(now);
      pastDate.setDate(pastDate.getDate() - 1);
      await ref.update({
        subscriptionStatus: "expired",
        subscriptionEndDate: pastDate,
        updatedAt: FieldValue.serverTimestamp(),
      });
      break;
    }
    case "extend": {
      const extendDays = typeof days === "number" && days > 0 ? days : 30;
      const current = snap.data()!;
      const currentEnd = current.subscriptionEndDate
        ? (current.subscriptionEndDate.toDate ? current.subscriptionEndDate.toDate() : new Date((current.subscriptionEndDate.seconds ?? 0) * 1000))
        : now;
      const baseDate = currentEnd > now ? currentEnd : now;
      const newEnd = new Date(baseDate);
      newEnd.setDate(newEnd.getDate() + extendDays);
      await ref.update({
        subscriptionStatus: "active",
        subscriptionEndDate: newEnd,
        updatedAt: FieldValue.serverTimestamp(),
      });
      break;
    }
    case "changePlan": {
      if (!planId) return NextResponse.json({ error: "planId required" }, { status: 400 });
      await ref.update({ planId, updatedAt: FieldValue.serverTimestamp() });
      break;
    }
    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
