// Required env vars (set in Vercel dashboard / .env.local):
// VERCEL_API_TOKEN  — Vercel personal or team access token
// VERCEL_PROJECT_ID — Vercel project ID (Vercel dashboard → project → Settings → General)

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

const VERCEL_API_TOKEN = process.env.VERCEL_API_TOKEN ?? "";
const VERCEL_PROJECT_ID = process.env.VERCEL_PROJECT_ID ?? "";

// Simple hostname regex — no protocol, no path, at least one dot
const DOMAIN_RE =
  /^([a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;

function normaliseDomain(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./, "")
    .toLowerCase();
}

// GET — return domain info for the authenticated restaurant
export async function GET() {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try {
    user = await getAuthenticatedUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const snap = await getAdminDb()
    .collection("restaurants")
    .doc(user.restaurantSlug)
    .get();

  if (!snap.exists) {
    return NextResponse.json({ error: "Restaurant not found" }, { status: 404 });
  }

  const data = snap.data()!;
  return NextResponse.json({
    customDomain: (data.customDomain as string) ?? null,
    domainStatus: (data.domainStatus as string) ?? null,
    domainError: (data.domainError as string) ?? null,
    domainVerifiedAt: data.domainVerifiedAt ?? null,
  });
}

// POST — save a new custom domain and register it with Vercel
export async function POST(req: NextRequest) {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try {
    user = await getAuthenticatedUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (user.role !== "owner") {
    return NextResponse.json({ error: "Owner access required" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body.domain !== "string") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const domain = normaliseDomain(body.domain);

  if (!DOMAIN_RE.test(domain)) {
    return NextResponse.json(
      {
        error:
          "Invalid domain format. Enter a domain like yourdomain.com with no protocol or path.",
      },
      { status: 400 }
    );
  }

  const db = getAdminDb();

  // Check no other restaurant already uses this domain
  const existing = await db
    .collection("restaurants")
    .where("customDomain", "==", domain)
    .limit(1)
    .get();

  if (!existing.empty && existing.docs[0].id !== user.restaurantSlug) {
    return NextResponse.json(
      { error: "This domain is already connected to another restaurant." },
      { status: 409 }
    );
  }

  // Save to Firestore
  await db.collection("restaurants").doc(user.restaurantSlug).update({
    customDomain: domain,
    domainStatus: "pending_dns",
    domainError: FieldValue.delete(),
    domainVerifiedAt: FieldValue.delete(),
  });

  // Register domain with Vercel
  let vercelResponse: unknown = null;
  if (VERCEL_API_TOKEN && VERCEL_PROJECT_ID) {
    try {
      const res = await fetch(
        `https://api.vercel.com/v10/projects/${VERCEL_PROJECT_ID}/domains`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${VERCEL_API_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ name: domain }),
        }
      );
      vercelResponse = await res.json();
    } catch (err) {
      // Non-fatal — domain saved in Firestore, user can retry
      console.error("Vercel domain registration failed:", err);
    }
  }

  return NextResponse.json({ success: true, domain, vercelResponse });
}

// DELETE — remove the custom domain from Vercel and Firestore
export async function DELETE() {
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

  const domain = snap.data()?.customDomain as string | undefined;

  // Remove from Vercel
  if (domain && VERCEL_API_TOKEN && VERCEL_PROJECT_ID) {
    try {
      await fetch(
        `https://api.vercel.com/v10/projects/${VERCEL_PROJECT_ID}/domains/${domain}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${VERCEL_API_TOKEN}`,
          },
        }
      );
    } catch (err) {
      console.error("Vercel domain removal failed:", err);
    }
  }

  // Clear domain fields in Firestore
  await db.collection("restaurants").doc(user.restaurantSlug).update({
    customDomain: FieldValue.delete(),
    domainStatus: FieldValue.delete(),
    domainError: FieldValue.delete(),
    domainVerifiedAt: FieldValue.delete(),
  });

  return NextResponse.json({ success: true });
}
