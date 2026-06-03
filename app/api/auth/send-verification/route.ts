import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/firebase-admin";
import { sendVerificationEmail } from "@/lib/email";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { idToken } = body;
    if (!idToken) {
      return NextResponse.json({ error: "Missing authentication token." }, { status: 401 });
    }

    // 1. Verify ID Token
    let decodedToken;
    try {
      decodedToken = await getAdminAuth().verifyIdToken(idToken);
    } catch (e: any) {
      console.error("verifyIdToken error:", e);
      return NextResponse.json({ error: `Auth token verification failed: ${e.message}` }, { status: 401 });
    }

    const email = decodedToken.email;
    if (!email) {
      return NextResponse.json({ error: "User email not found in token." }, { status: 400 });
    }

    // 2. Generate verification link
    let verificationLink;
    try {
      // First try with the redirect URL
      const actionCodeSettings = {
        url: `${request.nextUrl.origin}/admin`,
      };
      verificationLink = await getAdminAuth().generateEmailVerificationLink(email, actionCodeSettings);
    } catch (e: any) {
      console.warn("generateEmailVerificationLink with redirect failed, trying without redirect:", e);
      try {
        // Fallback to default link without redirect settings (avoids domain whitelist errors)
        verificationLink = await getAdminAuth().generateEmailVerificationLink(email);
      } catch (fallbackErr: any) {
        console.error("generateEmailVerificationLink fallback also failed:", fallbackErr);
        return NextResponse.json({ error: `Verification link generation failed: ${fallbackErr.message}` }, { status: 500 });
      }
    }

    // 3. Send email via Resend
    try {
      await sendVerificationEmail(email, verificationLink);
    } catch (e: any) {
      console.error("sendVerificationEmail error:", e);
      return NextResponse.json({ error: `Failed to deliver email via Resend: ${e.message}` }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("General send-verification route error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
