import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { checkRateLimit } from "@/lib/rate-limit";

const VERCEL_API_TOKEN = process.env.VERCEL_API_TOKEN ?? "";
const VERCEL_PROJECT_ID = process.env.VERCEL_PROJECT_ID ?? "";

export async function GET() {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try {
    user = await getAuthenticatedUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { allowed } = await checkRateLimit(`domain_check:${user.uid}`, 30, 60_000);
  if (!allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const db = getAdminDb();
  const snap = await db.collection("restaurants").doc(user.restaurantSlug).get();
  if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const data = snap.data()!;
  const domain = data.customDomain as string | undefined;

  if (!domain) {
    return NextResponse.json({ domainStatus: null, customDomain: null });
  }

  // If already connected, just return current state
  if (data.domainStatus === "connected") {
    return NextResponse.json({ domainStatus: "connected", customDomain: domain });
  }

  // Check with Vercel
  if (!VERCEL_API_TOKEN || !VERCEL_PROJECT_ID) {
    return NextResponse.json({ domainStatus: data.domainStatus ?? "pending_dns", customDomain: domain });
  }

  try {
    const res = await fetch(
      `https://api.vercel.com/v10/projects/${VERCEL_PROJECT_ID}/domains/${domain}`,
      { headers: { Authorization: `Bearer ${VERCEL_API_TOKEN}` } }
    );
    const vercelData = await res.json();

    if (vercelData.verified === true) {
      await db.collection("restaurants").doc(user.restaurantSlug).update({
        domainStatus: "connected",
        domainVerifiedAt: FieldValue.serverTimestamp(),
        domainError: FieldValue.delete(),
      });
      return NextResponse.json({ domainStatus: "connected", customDomain: domain });
    }

    return NextResponse.json({ domainStatus: "pending_dns", customDomain: domain });
  } catch {
    return NextResponse.json({ domainStatus: "pending_dns", customDomain: domain });
  }
}
