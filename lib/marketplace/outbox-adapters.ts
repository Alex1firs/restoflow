import "server-only";
import { getAdminDb } from "@/lib/firebase-admin";
import { sendTelegramAlert } from "@/lib/telegram";
import type { OutboxEntry, SendOutcome } from "./outbox";
import type { PushMessage, RestaurantMessage } from "./notifications";

/**
 * The delivery adapters behind the notification outbox.
 *
 * ── Why these reuse what is already here ─────────────────────────────────────
 * RestoFlow already reaches customers by SMS (Termii) and restaurants by
 * Telegram or SMS, per the restaurant's own `alertPreference`. Those channels
 * are configured, paid for and understood. Introducing a second, parallel
 * notification stack would mean two places to change a message, two sets of
 * credentials, and two things to be silently broken — which is exactly the
 * failure this slice exists to end.
 *
 * So the port named `sendCustomerPush` delivers by SMS today. The name is about
 * the message being a short interruption, not about the transport; when the
 * customer app grows real device push, this is the one function that changes
 * and every caller stays as it is.
 *
 * ── On branding ──────────────────────────────────────────────────────────────
 * Copy comes from `notifications.ts`, which already refuses to name Dispatcher
 * to a customer. Nothing here writes customer-facing words.
 */

const TERMII_URL = "https://api.ng.termii.com/api/sms/send";

/** Transport failures worth trying again, as opposed to a bad message. */
function outcomeForHttp(status: number, body: string): SendOutcome {
  // Two 4xx codes are about the account, not the message, and both come right
  // once somebody acts: 402 is an empty SMS balance, 429 is a rate limit.
  // Dead-lettering those throws away messages that would have sent after a
  // top-up — which is precisely what happened to a backlog of 38 on staging.
  if (status === 402 || status === 429) {
    return { status: "transient", reason: `provider ${status}: ${body.slice(0, 160)}` };
  }
  // Any other 4xx is the message or the address; asking again changes nothing.
  if (status >= 400 && status < 500) {
    return { status: "permanent", reason: `provider ${status}: ${body.slice(0, 160)}` };
  }
  return { status: "transient", reason: `provider ${status}: ${body.slice(0, 160)}` };
}

async function sendTermiiSMS(phone: string, message: string): Promise<SendOutcome> {
  const apiKey = process.env.TERMII_API_KEY ?? "";
  const senderId = process.env.TERMII_SENDER_ID ?? "RestoFlow";
  if (!apiKey) {
    // Not retryable: no amount of waiting provisions a credential. Dead-letter
    // it so somebody sees the queue backing up instead of it retrying forever.
    return { status: "permanent", reason: "TERMII_API_KEY is not set" };
  }

  let res: Response;
  try {
    res = await fetch(TERMII_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: phone,
        from: senderId,
        sms: message,
        type: "plain",
        channel: "generic",
        api_key: apiKey,
      }),
    });
  } catch (err) {
    return { status: "transient", reason: err instanceof Error ? err.message : String(err) };
  }

  if (!res.ok) return outcomeForHttp(res.status, await res.text().catch(() => ""));
  return { status: "sent" };
}

/** The customer's phone and their order's tracking link, read at send time. */
async function customerContact(orderId: string): Promise<{ phone: string; link: string }> {
  const snap = await getAdminDb().collection("orders").doc(orderId).get();
  const d = snap.data() ?? {};
  const phone = String(d.phone ?? "").trim();
  const token = d.trackingToken as string | undefined;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const link = appUrl && token
    ? `${appUrl}/track/${orderId}?t=${encodeURIComponent(token)}`
    : "";
  return { phone, link };
}

export async function sendCustomerPush(
  entry: OutboxEntry,
  message: PushMessage
): Promise<SendOutcome> {
  const { phone, link } = await customerContact(entry.orderId);
  if (!phone || phone.length < 10) {
    return { status: "permanent", reason: "order has no usable customer phone" };
  }
  // Title and body are already customer-safe and RestoFlow-branded. A link is
  // appended only when it will actually open.
  const text = link
    ? `${message.title}\n\n${message.body}\n\nTrack: ${link}`
    : `${message.title}\n\n${message.body}`;
  return sendTermiiSMS(phone, text);
}

export async function sendRestaurantAlert(
  entry: OutboxEntry,
  message: RestaurantMessage
): Promise<SendOutcome> {
  const snap = await getAdminDb().collection("orders").doc(entry.orderId).get();
  const restaurantId = String(snap.data()?.restaurantId ?? "");
  if (!restaurantId) return { status: "permanent", reason: "order has no restaurantId" };

  const rSnap = await getAdminDb().collection("restaurants").doc(restaurantId).get();
  if (!rSnap.exists) return { status: "permanent", reason: `restaurant ${restaurantId} not found` };
  const r = rSnap.data()!;

  // The restaurant's own choice, same field the storefront alerts already use.
  const preference = (r.alertPreference as string | undefined) ?? "sms";
  const telegramOn = r.telegramEnabled === true;
  const chatId = String(r.telegramChatId ?? "").trim();
  const phone = String(r.notificationPhone ?? "").trim();

  const wantsTelegram = telegramOn && chatId && (preference === "telegram" || preference === "both");
  const wantsSMS = phone && (preference === "sms" || preference === "both");

  if (!wantsTelegram && !wantsSMS) {
    return { status: "permanent", reason: "restaurant has no alert channel configured" };
  }

  // "Both" means both should arrive. One channel succeeding is enough to call
  // the message delivered; retrying the pair would double-send the one that
  // already worked.
  const outcomes: SendOutcome[] = [];
  if (wantsTelegram) {
    try {
      // Reports failure in its return value rather than throwing, so the result
      // has to be read — an ignored `{ success: false }` is a silent drop.
      const r = await sendTelegramAlert(chatId, message.text);
      outcomes.push(r.success
        ? { status: "sent" }
        : { status: "transient", reason: r.error ?? "telegram send failed" });
    } catch (err) {
      outcomes.push({ status: "transient", reason: err instanceof Error ? err.message : String(err) });
    }
  }
  if (wantsSMS) outcomes.push(await sendTermiiSMS(phone, message.text));

  if (outcomes.some((o) => o.status === "sent")) return { status: "sent" };
  return outcomes.find((o) => o.status === "transient") ?? outcomes[0];
}
