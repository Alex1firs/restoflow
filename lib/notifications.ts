import { getAdminDb } from "./firebase-admin";
import { sendWhatsAppTemplate, normalizeWhatsAppPhone } from "./whatsapp";

export type AlertPreference = "whatsapp" | "sms" | "both";

export interface NewOrderAlertParams {
  restaurantSlug: string;
  total: number;
  paymentMethod: "online" | "cash";
  paymentStatus: "paid" | "pending";
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
    const whatsappEnabled = data.whatsappEnabled === true;
    const rawWhatsappPhone = (data.whatsappPhone as string | undefined)?.trim() ?? "";
    const notificationPhone = (data.notificationPhone as string | undefined)?.trim() ?? "";

    const tasks: Promise<void>[] = [];

    // SMS is always primary — fires for every new order if notificationPhone is set
    if (notificationPhone) {
      tasks.push(dispatchSMS({ ...params, restaurantName, notificationPhone }).catch(() => {
        console.error("[notifications] SMS alert failed");
      }));
    }

    // WhatsApp is secondary — only fires if explicitly enabled
    const sendWhatsApp =
      whatsappEnabled &&
      rawWhatsappPhone &&
      (alertPreference === "whatsapp" || alertPreference === "both");

    if (sendWhatsApp) {
      tasks.push(
        dispatchWhatsApp({ ...params, restaurantName, whatsappPhone: rawWhatsappPhone })
          .catch(() => {
            console.error("[notifications] WhatsApp alert failed");
          })
      );
    }

    if (tasks.length > 0) await Promise.allSettled(tasks);
  } catch {
    console.error("[notifications] alert dispatch failed");
  }
}

async function dispatchWhatsApp(
  params: NewOrderAlertParams & { restaurantName: string; whatsappPhone: string }
): Promise<void> {
  const templateName = process.env.WHATSAPP_TEMPLATE_NEW_ORDER;
  if (!templateName) {
    console.error("[notifications] WHATSAPP_TEMPLATE_NEW_ORDER not configured");
    return;
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const normalizedPhone = normalizeWhatsAppPhone(params.whatsappPhone);
  const paymentMethodLabel =
    params.paymentMethod === "online" ? "Online" : "Cash on Delivery";
  const paymentStatusLabel = params.paymentStatus === "paid" ? "Paid ✓" : "Pending";
  const totalFormatted = `₦${params.total.toLocaleString("en-NG")}`;
  const link = `${appUrl}/admin/${params.restaurantSlug}/orders`;

  const result = await sendWhatsAppTemplate({
    to: normalizedPhone,
    templateName,
    bodyParameters: [
      params.restaurantName,
      totalFormatted,
      paymentMethodLabel,
      paymentStatusLabel,
      params.customerName,
      link,
    ],
  });

  if (!result.success) {
    console.error(`[notifications] WhatsApp alert failed for template "${templateName}":`, result.error);
    throw new Error(result.error ?? "WhatsApp send failed");
  }
}

async function dispatchSMS(
  params: NewOrderAlertParams & { restaurantName: string; notificationPhone: string }
): Promise<void> {
  const termiiKey = process.env.TERMII_API_KEY;
  if (!termiiKey) return;

  const raw = params.notificationPhone.replace(/\D/g, "");
  const to = raw.startsWith("0") && raw.length === 11 ? "234" + raw.slice(1) : raw;

  const paymentMethod = params.paymentMethod === "online" ? "Online" : "Cash";
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
  paymentMethod: "online" | "cash"
): Promise<void> {
  await sendNewOrderAlert({
    restaurantSlug,
    total,
    paymentMethod,
    paymentStatus: paymentMethod === "online" ? "paid" : "pending",
    customerName: "",
  });
}
