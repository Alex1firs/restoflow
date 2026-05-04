import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";

const SEO_FIELDS = [
  "seoTitle", "seoDescription", "serviceAreas",
  "foodKeywords", "googleBusinessUrl", "instagramUrl", "tiktokUrl",
] as const;

export async function GET() {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try { user = await getAuthenticatedUser(); } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const snap = await getAdminDb().collection("restaurants").doc(user.restaurantSlug).get();
  if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const d = snap.data()!;
  const result: Record<string, string> = {};
  for (const f of SEO_FIELDS) result[f] = (d[f] as string) ?? "";

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try { user = await getAuthenticatedUser(); } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (user.role === "staff") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const update: Record<string, string> = {};
  for (const f of SEO_FIELDS) {
    if (typeof body[f] === "string") update[f] = body[f].trim();
  }

  await getAdminDb().collection("restaurants").doc(user.restaurantSlug).update(update);
  return NextResponse.json({ success: true });
}
