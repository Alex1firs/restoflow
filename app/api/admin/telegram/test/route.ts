import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";
import { sendTelegramAlert } from "@/lib/telegram";

export async function POST(req: NextRequest) {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try {
    user = await getAuthenticatedUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body || !body.telegramChatId?.trim()) {
    return NextResponse.json({ error: "Telegram Chat ID is required" }, { status: 400 });
  }

  const telegramChatId = body.telegramChatId.trim();

  try {
    const db = getAdminDb();
    const docRef = db.collection("restaurants").doc(user.restaurantSlug);
    const snap = await docRef.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Restaurant not found" }, { status: 404 });
    }

    const restaurantName = snap.data()?.name || user.restaurantSlug;

    // Build premium HTML test message
    const message =
      `🔔 <b>RestoFlow Connection Test</b>\n\n` +
      `Your Telegram Alerts are now successfully linked and active for <b>${restaurantName}</b>!\n\n` +
      `⚡ You will receive instant notifications here whenever a new customer order is placed.`;

    const chatIds = telegramChatId
      .split(",")
      .map((id: string) => id.trim())
      .filter(Boolean);

    if (chatIds.length === 0) {
      return NextResponse.json({ error: "Telegram Chat ID is required" }, { status: 400 });
    }

    const results = await Promise.all(
      chatIds.map((id: string) => sendTelegramAlert(id, message))
    );

    const failed = results.filter((r) => !r.success);
    if (failed.length > 0) {
      const errors = failed.map((f) => f.error).join(", ");
      return NextResponse.json(
        { error: `Failed for some Chat IDs: ${errors}` },
        { status: 502 }
      );
    }

    // Auto-enable Telegram Alerts in database on successful verification
    await docRef.update({
      telegramChatId,
      telegramEnabled: true,
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
