export type CustomerEventType =
  | "created"
  | "paid"
  | "preparing"
  | "ready_pickup"
  | "ready_delivery"
  | "completed"
  | "cancelled";

export interface CustomerOrderData {
  orderId: string;
  customerName: string;
  customerPhone: string;
  restaurantName: string;
  restaurantAddress?: string;
  total: number;
  itemsSummary: string;
  paymentMethod: "online" | "cash" | "whatsapp";
  deliveryType?: "delivery" | "pickup" | "dine_in";
}

function totalFmt(total: number) {
  return `₦${total.toLocaleString("en-NG")}`;
}

function buildSMS(event: CustomerEventType, data: CustomerOrderData, trackingLink: string): string {
  switch (event) {
    case "created":
      return `Hi ${data.customerName}! Your order from ${data.restaurantName} has been received.\n\nItems: ${data.itemsSummary}\nTotal: ${totalFmt(data.total)}\n\nTrack: ${trackingLink}`;
    case "paid":
      return `Payment of ${totalFmt(data.total)} confirmed! ${data.restaurantName} is now preparing your order.`;
    case "preparing":
      return `${data.restaurantName} has started preparing your order. Sit tight — it'll be ready soon!`;
    case "ready_pickup":
      return `Your order is ready for pickup at ${data.restaurantName}!\n\n📍 ${data.restaurantAddress ?? ""}`;
    case "ready_delivery":
      return `Your order is on the way! Please be available to receive it.`;
    case "completed":
      return `Your order has been delivered. Thank you for ordering from ${data.restaurantName}!`;
    case "cancelled":
      return `Unfortunately your order from ${data.restaurantName} could not be completed. If you were charged, a refund will be processed.`;
  }
}

async function sendSMS(phone: string, message: string): Promise<void> {
  const key = process.env.TERMII_API_KEY;
  if (!key) return;
  const digits = phone.replace(/\D/g, "");
  await fetch("https://api.ng.termii.com/api/sms/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: key,
      to: digits,
      from: "RestoFlow",
      sms: message,
      type: "plain",
      channel: "generic",
    }),
  });
}

export async function sendCustomerNotification(
  event: CustomerEventType,
  data: CustomerOrderData
): Promise<void> {
  if (!data.customerPhone || data.customerPhone.length < 10) return;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const trackingLink = `${appUrl}/track/${data.orderId}`;

  try {
    // Send direct SMS notification via Termii
    await sendSMS(data.customerPhone, buildSMS(event, data, trackingLink));
  } catch (err: any) {
    console.error("[customer-notifications] SMS dispatch failed:", err.message);
  }
}
