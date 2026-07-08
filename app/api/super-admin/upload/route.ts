import { NextRequest, NextResponse } from "next/server";
import { getSuperAdminUser } from "@/lib/auth-server";
import { getAdminStorage } from "@/lib/firebase-admin";
import { randomUUID } from "crypto";

// Super-admin-scoped image upload (campaign banners). Separate from the
// merchant `/api/upload` route: gated by super-admin auth and restricted to the
// `campaigns/` storage prefix. Images only — banners are marketing assets.
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    await getSuperAdminUser();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const formData = await req.formData().catch(() => null);
  if (!formData) return NextResponse.json({ error: "Invalid form data" }, { status: 400 });

  const file = formData.get("file") as File | null;
  const path = formData.get("path") as string | null;

  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });
  if (!path) return NextResponse.json({ error: "No path provided" }, { status: 400 });

  // Super-admin uploads are confined to the campaigns/ prefix.
  if (!path.startsWith("campaigns/")) {
    return NextResponse.json({ error: "Forbidden path" }, { status: 403 });
  }

  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    return NextResponse.json({ error: "Only JPG, PNG, or WebP images allowed" }, { status: 400 });
  }
  if (file.size > MAX_IMAGE_SIZE) {
    return NextResponse.json({ error: "Image must be under 5MB" }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!;
    const bucket = getAdminStorage().bucket(bucketName);
    const fileRef = bucket.file(path);

    // Upload with a download token so we get a permanent Firebase-style URL.
    const token = randomUUID();
    await fileRef.save(buffer, {
      contentType: file.type,
      resumable: false,
      metadata: { metadata: { firebaseStorageDownloadTokens: token } },
    });

    const encodedPath = encodeURIComponent(path);
    const url = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodedPath}?alt=media&token=${token}`;

    return NextResponse.json({ url });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Super-admin upload error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
