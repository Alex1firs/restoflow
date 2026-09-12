import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The notification drain.
 *
 * ── Why this is its own cron ─────────────────────────────────────────────────
 * The marketplace sweeps run once a day, which is the right cadence for
 * repairing money and chasing a courier that never got requested. It is the
 * wrong cadence for telling somebody their food is on the way — on that
 * schedule a customer would learn their order was received the following
 * morning. Messages need minutes; reconciliation needs a day. Two jobs.
 *
 * The drain is idempotent and claims each entry with a compare-and-set, so an
 * overlapping run sends nothing twice.
 */
export async function GET(req: NextRequest) {
  // Vercel signs cron invocations. Without this the endpoint is a public way to
  // make the platform send messages.
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const { getAdminDb } = await import("@/lib/firebase-admin");
  const { FirestoreMarketplaceStore } = await import("@/lib/marketplace/store");
  const { drainOutbox } = await import("@/lib/marketplace/outbox");
  const { sendCustomerPush, sendRestaurantAlert } = await import("@/lib/marketplace/outbox-adapters");

  const log = (event: string, fields: Record<string, unknown>) =>
    console.log(JSON.stringify({ scope: "marketplace_outbox", event, ...fields }));

  try {
    const store = new FirestoreMarketplaceStore(getAdminDb());
    const result = await drainOutbox({
      claimDue: (now, limit) => store.claimDueNotifications(now, limit),
      markSending: (entry, now) => store.markSending(entry, now),
      markSent: (entry, now) => store.markNotificationSent(entry, now),
      scheduleRetry: (entry, next, error) => store.scheduleNotificationRetry(entry, next, error),
      markDead: (entry, error, now) => store.markNotificationDead(entry, error, now),
      invalidateToken: (token, now) => store.invalidateDeviceToken(token, now),
      sendCustomerPush,
      sendRestaurantAlert,
      log,
    }, Date.now());

    log("drain_complete", { ...result });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    log("drain_failed", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: "drain failed" }, { status: 500 });
  }
}
