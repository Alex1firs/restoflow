import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/firebase-admin";
import { sendVerificationEmail } from "@/lib/email";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { idToken } = body;
    if (!idToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify token & extract email
    const decodedToken = await getAdminAuth().verifyIdToken(idToken);
    const email = decodedToken.email;
    if (!email) {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }

    // Generate verification link redirecting back to RestoFlow admin dashboard
    const actionCodeSettings = {
      url: `${request.nextUrl.origin}/admin`,
    };
    const verificationLink = await getAdminAuth().generateEmailVerificationLink(email, actionCodeSettings);

    // Send email via Resend
    await sendVerificationEmail(email, verificationLink);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Email verification send error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
