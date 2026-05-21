import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";
import { sendWhatsAppTemplate, normalizeWhatsAppPhone } from "@/lib/whatsapp";

export async function POST(req: NextRequest) {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try {
    user = await getAuthenticatedUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { whatsappPhone } = body as { whatsappPhone?: string };
  if (!whatsappPhone?.trim()) {
    return NextResponse.json({ error: "WhatsApp phone number is required" }, { status: 400 });
  }

  const templateName = process.env.WHATSAPP_TEMPLATE_NEW_ORDER;
  if (!templateName) {
    return NextResponse.json(
      { error: "WHATSAPP_TEMPLATE_NEW_ORDER is not configured on the server." },
      { status: 503 }
    );
  }

  if (!process.env.WHATSAPP_ACCESS_TOKEN || !process.env.WHATSAPP_PHONE_NUMBER_ID) {
    return NextResponse.json(
      { error: "WhatsApp API credentials are not configured on the server." },
      { status: 503 }
    );
  }

  const normalizedPhone = normalizeWhatsAppPhone(whatsappPhone.trim());
  if (normalizedPhone.length < 10) {
    return NextResponse.json({ error: "Invalid phone number." }, { status: 400 });
  }

  // Fetch restaurant name for the test message
  const restaurantSlug = user.restaurantSlug;
  const snap = await getAdminDb().collection("restaurants").doc(restaurantSlug).get();
  const restaurantName = (snap.data()?.name as string | undefined) ?? restaurantSlug;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

  const result = await sendWhatsAppTemplate({
    to: normalizedPhone,
    templateName,
    bodyParameters: [
      restaurantName,
      "₦5,000",
      "Online",
      "Paid ✓",
      "Test Customer",
      `${appUrl}/admin/${restaurantSlug}/orders`,
    ],
  });

  if (!result.success) {
    let errorMsg = result.error ?? "Failed to send test message.";
    if (errorMsg.includes("131030") || errorMsg.includes("allowed list")) {
      errorMsg = "WhatsApp API error: Recipient phone number not in allowed list. This happens because your Meta WhatsApp App is in Sandbox/Development mode. To send messages to any number, you must switch your Meta App to Live (Production) mode.";
    }
    return NextResponse.json(
      { error: errorMsg },
      { status: 502 }
    );
  }

  // Save the phone and mark WhatsApp as enabled since the test succeeded
  await getAdminDb()
    .collection("restaurants")
    .doc(restaurantSlug)
    .update({
      whatsappPhone: normalizedPhone,
      whatsappEnabled: true,
    });

  return NextResponse.json({ success: true, normalizedPhone });
}
