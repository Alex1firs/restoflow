import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { getAdminStorage } from "@/lib/firebase-admin";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_SIZE = 5 * 1024 * 1024;

export async function POST(req: NextRequest) {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try {
    user = await getAuthenticatedUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await req.formData().catch(() => null);
  if (!formData) return NextResponse.json({ error: "Invalid form data" }, { status: 400 });

  const file = formData.get("file") as File | null;
  const path = formData.get("path") as string | null;

  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });
  if (!path) return NextResponse.json({ error: "No path provided" }, { status: 400 });

  // Only allow uploads under the authenticated user's restaurant
  const allowedPrefix = `restaurants/${user.restaurantSlug}/`;
  if (!path.startsWith(allowedPrefix)) {
    return NextResponse.json({ error: "Forbidden path" }, { status: 403 });
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: "Only JPG, PNG, or WebP allowed" }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "Image must be under 5MB" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const bucket = getAdminStorage().bucket();
  const fileRef = bucket.file(path);

  await fileRef.save(buffer, { contentType: file.type, resumable: false });
  await fileRef.makePublic();

  const publicUrl = `https://storage.googleapis.com/${bucket.name}/${path}`;
  return NextResponse.json({ url: publicUrl });
}
