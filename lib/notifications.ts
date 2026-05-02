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

    const sendWhatsApp =
      whatsappEnabled &&
      rawWhatsappPhone &&
      (alertPreference === "whatsapp" || alertPreference === "both");

    const sendSMS =
      notificationPhone &&
      (alertPreference === "sms" || alertPreference === "both" ||
        // backward compat: no preference set yet → fall back to SMS
        (!whatsappEnabled));

    if (sendWhatsApp) {
      tasks.push(
        dispatchWhatsApp({ ...params, restaurantName, whatsappPhone: rawWhatsappPhone })
          .catch((err) => {
            console.error("WhatsApp alert failed:", err);
            // fallback to SMS if available
            if (notificationPhone) {
              return dispatchSMS({ ...params, notificationPhone }).catch(() => {});
            }
          })
      );
    }

    if (sendSMS) {
      tasks.push(dispatchSMS({ ...params, notificationPhone }).catch(() => {}));
    }

    if (tasks.length > 0) await Promise.allSettled(tasks);
  } catch (err) {
    console.error("sendNewOrderAlert failed (non-fatal):", err);
  }
}

async function dispatchWhatsApp(
  params: NewOrderAlertParams & { restaurantName: string; whatsappPhone: string }
): Promise<void> {
  const templateName = process.env.WHATSAPP_TEMPLATE_NEW_ORDER;
  if (!templateName) {
    console.error("WHATSAPP_TEMPLATE_NEW_ORDER env var not set — skipping WhatsApp alert");
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
    throw new Error(result.error ?? "WhatsApp send failed");
  }
}

async function dispatchSMS(
  params: NewOrderAlertParams & { notificationPhone: string }
): Promise<void> {
  const termiiKey = process.env.TERMII_API_KEY;
  if (!termiiKey) return;

  const digits = params.notificationPhone.replace(/\D/g, "");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const paymentLabel =
    params.paymentMethod === "online" ? "Paid online ✓" : "Pay on delivery";
  const message = [
    `New order on RestoFlow!`,
    `₦${params.total.toLocaleString("en-NG")} — ${paymentLabel}`,
    `Customer: ${params.customerName}`,
    `View: ${appUrl}/admin/${params.restaurantSlug}/orders`,
  ].join("\n");

  await fetch("https://api.ng.termii.com/api/sms/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: termiiKey,
      to: digits,
      from: "RestoFlow",
      sms: message,
      type: "plain",
      channel: "generic",
    }),
  });
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
