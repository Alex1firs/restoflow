import { getAdminDb } from "./firebase-admin";

export async function sendNewOrderSMS(
  restaurantSlug: string,
  total: number,
  paymentMethod: "online" | "cash"
): Promise<void> {
  const termiiKey = process.env.TERMII_API_KEY;
  if (!termiiKey) return;

  try {
    const snap = await getAdminDb().collection("restaurants").doc(restaurantSlug).get();
    if (!snap.exists) return;

    const data = snap.data()!;
    const phone = (data.notificationPhone as string | undefined)?.trim();
    if (!phone) return;

    const digits = phone.replace(/\D/g, "");
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
    const label = paymentMethod === "online" ? "Paid online ✓" : "Pay on delivery";
    const message = `New order on RestoFlow!\n₦${total.toLocaleString("en-NG")} — ${label}\nView: ${appUrl}/admin/${restaurantSlug}/orders`;

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
  } catch (err) {
    console.error("SMS notification failed (non-fatal):", err);
  }
}
