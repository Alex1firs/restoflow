import { type NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";

interface SyncPayload {
  name?: string;
  address?: string;
  phone?: string;
  website?: string;
  description?: string;
  serviceAreas?: string;
  category?: string;
}

// Syncs GBP details back to the restaurant's local SEO fields
export async function POST(req: NextRequest) {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try {
    user = await getAuthenticatedUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (user.role === "staff") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as SyncPayload | null;
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const db = getAdminDb();
  const slug = user.restaurantSlug;

  const snap = await db.collection("restaurants").doc(slug).get();
  if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const data = snap.data()!;
  const currentSeoTitle = (data.seoTitle as string) ?? "";
  const currentSeoDescription = (data.seoDescription as string) ?? "";

  const update: Record<string, string> = {};

  // Only overwrite SEO fields that are currently blank
  if (body.name && !currentSeoTitle) {
    update.seoTitle = `${body.name} — Order Food Online`;
  }
  if (body.description && !currentSeoDescription) {
    update.seoDescription = body.description.slice(0, 160);
  }
  if (body.serviceAreas) update.serviceAreas = body.serviceAreas;
  if (body.category) update.foodKeywords = body.category;
  if (body.phone) update.phone = body.phone;
  if (body.address) update.address = body.address;

  if (Object.keys(update).length > 0) {
    await db.collection("restaurants").doc(slug).update(update);
  }

  return NextResponse.json({ success: true, fieldsUpdated: Object.keys(update) });
}
