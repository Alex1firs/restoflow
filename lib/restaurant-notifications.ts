async function sendSMS(phone: string, message: string): Promise<void> {
  const key = process.env.TERMII_API_KEY;
  if (!key) return;

  const digits = phone.replace(/\D/g, "");
  const to = digits.startsWith("0") && digits.length === 11 ? "234" + digits.slice(1) : digits;
  if (to.length < 10) return;

  try {
    const res = await fetch("https://v3.api.termii.com/api/sms/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        to,
        from: "RestoFlow",
        sms: message,
        type: "plain",
        channel: "generic",
      }),
    });
    if (!res.ok) {
      console.error("[restaurant-notifications] Termii SMS error", res.status);
    }
  } catch {
    console.error("[restaurant-notifications] SMS send failed");
  }
}

export async function sendApprovalNotification(
  phone: string,
  restaurantName: string
): Promise<void> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const message =
    `🎉 Congratulations! Your restaurant "${restaurantName}" has been approved and is now live.\n\n` +
    `Customers can now find and order from you.\n\n` +
    `Dashboard: ${appUrl}/admin`;
  await sendSMS(phone, message);
}

export async function sendRejectionNotification(
  phone: string,
  restaurantName: string,
  reason: string
): Promise<void> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const message =
    `Hi, your restaurant "${restaurantName}" submission was not approved.\n\n` +
    `Reason: ${reason}\n\n` +
    `Please update your setup and resubmit for review.\n` +
    `Dashboard: ${appUrl}/admin`;
  await sendSMS(phone, message);
}
