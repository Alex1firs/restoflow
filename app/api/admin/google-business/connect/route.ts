import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";
import { getGoogleConfig, buildAuthUrl } from "@/lib/google-oauth";
import { randomBytes } from "crypto";

export async function GET() {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try {
    user = await getAuthenticatedUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (user.role === "staff") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { configured } = getGoogleConfig();
  if (!configured) {
    return NextResponse.json({ error: "Google OAuth is not configured" }, { status: 503 });
  }

  const nonce = randomBytes(20).toString("hex");
  const state = `${user.restaurantSlug}:${nonce}`;

  await getAdminDb()
    .collection("oauth_states")
    .doc(nonce)
    .set({
      slug: user.restaurantSlug,
      createdAt: Date.now(),
    });

  const authUrl = buildAuthUrl(state);
  return NextResponse.json({ authUrl });
}
