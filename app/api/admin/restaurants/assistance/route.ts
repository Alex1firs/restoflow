import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";
import { sendTelegramAlert } from "@/lib/telegram";
import { FieldValue } from "firebase-admin/firestore";

export async function POST(req: NextRequest) {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try {
    user = await getAuthenticatedUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const setupScore = typeof body.setupScore === "number" ? body.setupScore : null;

  try {
    const db = getAdminDb();
    const slug = user.restaurantSlug;
    const docRef = db.collection("restaurants").doc(slug);
    const snap = await docRef.get();

    if (!snap.exists) {
      return NextResponse.json({ error: "Restaurant not found" }, { status: 404 });
    }

    const data = snap.data()!;

    if (data.ownerUid !== user.uid && user.role !== "owner" && user.role !== "manager") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (data.assistanceStatus === "open") {
      return NextResponse.json(
        { error: "already_open", message: "Setup assistance has already been requested. Our team will reach out soon." },
        { status: 409 }
      );
    }

    await docRef.update({
      assistanceRequested: true,
      assistanceRequestedAt: FieldValue.serverTimestamp(),
      assistanceStatus: "open",
    });

    // Notify admin via Telegram if configured.
    // Set ADMIN_TELEGRAM_CHAT_ID in env to enable. If not set, the Firestore
    // record is the source of truth and admin notification can be wired later.
    const adminChatId = process.env.ADMIN_TELEGRAM_CHAT_ID?.trim();
    if (adminChatId) {
      const restaurantName = data.name || slug;
      const scoreText = setupScore !== null ? ` (${setupScore}% setup complete)` : "";
      const message =
        `🆘 <b>Setup Assistance Requested</b>\n\n` +
        `Restaurant: <b>${restaurantName}</b>${scoreText}\n` +
        `Slug: <code>${slug}</code>\n\n` +
        `The owner needs help completing their store setup.`;
      await sendTelegramAlert(adminChatId, message).catch(() => {
        // Non-fatal — Firestore record is the source of truth
      });
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
