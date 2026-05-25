import { type NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { getGoogleConfig, exchangeCodeForTokens, storeGoogleTokens } from "@/lib/google-oauth";
import { FieldValue } from "firebase-admin/firestore";

export async function GET(req: NextRequest) {
  const { configured } = getGoogleConfig();
  if (!configured) {
    return NextResponse.redirect(new URL("/admin/login", req.url));
  }

  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  if (error || !code || !state) {
    const reason = error ?? "missing_params";
    return NextResponse.redirect(
      new URL(
        `/admin/google-business-error?reason=${encodeURIComponent(reason)}`,
        req.url
      )
    );
  }

  const colonIdx = state.indexOf(":");
  if (colonIdx === -1) {
    return NextResponse.redirect(
      new URL("/admin/google-business-error?reason=invalid_state", req.url)
    );
  }

  const slug = state.slice(0, colonIdx);
  const nonce = state.slice(colonIdx + 1);

  const db = getAdminDb();
  const stateDoc = await db.collection("oauth_states").doc(nonce).get();

  if (!stateDoc.exists || stateDoc.data()!.slug !== slug) {
    return NextResponse.redirect(
      new URL("/admin/google-business-error?reason=state_mismatch", req.url)
    );
  }

  // State expires after 10 minutes
  const stateAge = Date.now() - (stateDoc.data()!.createdAt as number);
  if (stateAge > 600_000) {
    await stateDoc.ref.delete();
    return NextResponse.redirect(
      new URL("/admin/google-business-error?reason=state_expired", req.url)
    );
  }

  await stateDoc.ref.delete();

  try {
    const { accessToken, refreshToken, tokenExpiry, email, googleUserId } =
      await exchangeCodeForTokens(code);

    await storeGoogleTokens(slug, { accessToken, refreshToken, tokenExpiry });

    // Update restaurant document with non-sensitive connection info
    await db
      .collection("restaurants")
      .doc(slug)
      .update({
        "googleBusiness.connected": true,
        "googleBusiness.connectedEmail": email,
        "googleBusiness.googleUserId": googleUserId,
        "googleBusiness.connectedAt": FieldValue.serverTimestamp(),
        "googleBusiness.profileStatus": "connected",
        "googleBusiness.lastSyncError": FieldValue.delete(),
      });

    return NextResponse.redirect(
      new URL(`/admin/${slug}/seo/google-business?connected=1`, req.url)
    );
  } catch {
    return NextResponse.redirect(
      new URL(`/admin/${slug}/seo/google-business?error=connection_failed`, req.url)
    );
  }
}
