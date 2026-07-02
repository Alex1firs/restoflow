import { getAdminDb } from "./firebase-admin";
import { sendTelegramAlert } from "./telegram";

export type AlertPreference = "telegram" | "sms" | "both";

export interface NewOrderAlertParams {
  restaurantSlug: string;
  total: number;
  paymentMethod: "online" | "cash" | "whatsapp";
  paymentStatus: "paid" | "pending" | "unpaid";
  customerName: string;
}

export async function sendNewOrderAlert(params: NewOrderAlertParams): Promise<void> {
  try {
    const snap = await getAdminDb()
      .collection("restaurants")
      .doc(params.restaurantSlug)
      .get();
    if (!snap.exists) return;

    const data = snap.data()!;
    const restaurantName = (data.name as string) ?? params.restaurantSlug;
    const alertPreference: AlertPreference =
      (data.alertPreference as AlertPreference | undefined) ?? "sms";
    const telegramEnabled = data.telegramEnabled === true;
    const telegramChatId = (data.telegramChatId as string | undefined)?.trim() ?? "";
    const notificationPhone = (data.notificationPhone as string | undefined)?.trim() ?? "";

    const tasks: Promise<void>[] = [];

    // SMS is always primary — fires for every new order if notificationPhone is set
    if (notificationPhone) {
      tasks.push(dispatchSMS({ ...params, restaurantName, notificationPhone }).catch(() => {
        console.error("[notifications] SMS alert failed");
      }));
    }

    // Telegram is secondary — only fires if explicitly enabled
    const sendTelegram =
      telegramEnabled &&
      telegramChatId &&
      (alertPreference === "telegram" || alertPreference === "both");

    if (sendTelegram) {
      const chatIds = telegramChatId
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);

      for (const chatId of chatIds) {
        tasks.push(
          dispatchTelegram({ ...params, restaurantName, telegramChatId: chatId })
            .catch((err: any) => {
              console.error(`[notifications] Telegram alert failed for chatId ${chatId}:`, err.message);
            })
        );
      }
    }

    if (tasks.length > 0) await Promise.allSettled(tasks);
  } catch {
    console.error("[notifications] alert dispatch failed");
  }
}

async function dispatchTelegram(
  params: NewOrderAlertParams & { restaurantName: string; telegramChatId: string }
): Promise<void> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const paymentMethodLabel =
    params.paymentMethod === "online" ? "Online" : params.paymentMethod === "whatsapp" ? "WhatsApp" : "Cash on Delivery";
  const paymentStatusLabel = params.paymentStatus === "paid" ? "Paid ✓" : "Pending";
  const totalFormatted = `₦${params.total.toLocaleString("en-NG")}`;
  const link = `${appUrl}/admin/${params.restaurantSlug}/orders`;

  const message =
    `🍽️ <b>New Order Received!</b> — <b>${params.restaurantName}</b>\n\n` +
    `👤 <b>Customer:</b> ${params.customerName || "N/A"}\n` +
    `💰 <b>Total:</b> ${totalFormatted}\n` +
    `💳 <b>Payment:</b> ${paymentMethodLabel} (${paymentStatusLabel})\n\n` +
    `⚡ <a href="${link}">View Order on Dashboard</a>`;

  const result = await sendTelegramAlert(params.telegramChatId, message);

  if (!result.success) {
    console.error(`[notifications] Telegram alert failed:`, result.error);
    throw new Error(result.error ?? "Telegram send failed");
  }
}

async function dispatchSMS(
  params: NewOrderAlertParams & { restaurantName: string; notificationPhone: string }
): Promise<void> {
  const termiiKey = process.env.TERMII_API_KEY;
  if (!termiiKey) return;

  const raw = params.notificationPhone.replace(/\D/g, "");
  const to = raw.startsWith("0") && raw.length === 11 ? "234" + raw.slice(1) : raw;

  const paymentMethod = params.paymentMethod === "online" ? "Online" : params.paymentMethod === "whatsapp" ? "WhatsApp" : "Cash";
  const paymentStatus = params.paymentStatus === "paid" ? "Paid ✓" : "Pending";
  const message =
    `🍽️ New Order — ${params.restaurantName ?? params.restaurantSlug}\n\n` +
    `Total: ₦${params.total.toLocaleString("en-NG")}\n` +
    `Payment: ${paymentMethod}/${paymentStatus}\n\n` +
    `⚡ Check dashboard now`;

  try {
    const res = await fetch("https://v3.api.termii.com/api/sms/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: termiiKey,
        to,
        from: "RestoFlow",
        sms: message,
        type: "plain",
        channel: "generic",
      }),
    });
    if (!res.ok) {
      console.error("[notifications] Termii SMS error", res.status);
    }
  } catch {
    console.error("[notifications] Termii SMS send failed");
  }
}

// Legacy shim kept for any direct callers that haven't been updated
export async function sendNewOrderSMS(
  restaurantSlug: string,
  total: number,
  paymentMethod: "online" | "cash" | "whatsapp"
): Promise<void> {
  await sendNewOrderAlert({
    restaurantSlug,
    total,
    paymentMethod,
    paymentStatus: paymentMethod === "online" ? "paid" : "pending",
    customerName: "",
  });
}
