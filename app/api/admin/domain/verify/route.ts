// Required env vars (set in Vercel dashboard / .env.local):
// VERCEL_API_TOKEN  — Vercel personal or team access token
// VERCEL_PROJECT_ID — Vercel project ID (Vercel dashboard → project → Settings → General)

import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

const VERCEL_API_TOKEN = process.env.VERCEL_API_TOKEN ?? "";
const VERCEL_PROJECT_ID = process.env.VERCEL_PROJECT_ID ?? "";

// POST — check domain verification status with Vercel and update Firestore
export async function POST() {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try {
    user = await getAuthenticatedUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (user.role !== "owner") {
    return NextResponse.json({ error: "Owner access required" }, { status: 403 });
  }

  const db = getAdminDb();
  const snap = await db.collection("restaurants").doc(user.restaurantSlug).get();
  if (!snap.exists) {
    return NextResponse.json({ error: "Restaurant not found" }, { status: 404 });
  }

  const data = snap.data()!;
  const domain = data.customDomain as string | undefined;

  if (!domain) {
    return NextResponse.json(
      { error: "No custom domain configured" },
      { status: 400 }
    );
  }

  if (!VERCEL_API_TOKEN || !VERCEL_PROJECT_ID) {
    return NextResponse.json(
      { error: "Vercel API credentials not configured on server" },
      { status: 500 }
    );
  }

  // Check domain status with Vercel
  let vercelData: Record<string, unknown>;
  try {
    const res = await fetch(
      `https://api.vercel.com/v10/projects/${VERCEL_PROJECT_ID}/domains/${domain}`,
      {
        headers: {
          Authorization: `Bearer ${VERCEL_API_TOKEN}`,
        },
      }
    );
    vercelData = (await res.json()) as Record<string, unknown>;
  } catch (err) {
    console.error("Vercel domain status check failed:", err);
    return NextResponse.json(
      { error: "Failed to contact Vercel API" },
      { status: 502 }
    );
  }

  const verified = vercelData.verified === true;
  const newStatus = verified ? "connected" : "pending_dns";

  const updatePayload: Record<string, unknown> = {
    domainStatus: newStatus,
  };

  if (verified) {
    updatePayload.domainVerifiedAt = FieldValue.serverTimestamp();
    updatePayload.domainError = FieldValue.delete();
  } else {
    // Surface any Vercel error hint
    if (vercelData.error && typeof vercelData.error === "object") {
      const errObj = vercelData.error as Record<string, unknown>;
      if (typeof errObj.message === "string") {
        updatePayload.domainError = errObj.message;
      }
    }
  }

  await db
    .collection("restaurants")
    .doc(user.restaurantSlug)
    .update(updatePayload);

  return NextResponse.json({
    success: true,
    domain,
    domainStatus: newStatus,
    verified,
    vercelData,
  });
}
