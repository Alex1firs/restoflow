import { NextRequest, NextResponse } from "next/server";
import { readFlags } from "@/lib/marketplace/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The marketplace background sweeps, on a Vercel cron.
 *
 * ── Why a cron and not an in-process timer ───────────────────────────────────
 * RestoFlow is serverless. There is no process to hold a timer, and a deploy in
 * the middle of a 25-minute prep must not lose the moment a courier should be
 * requested. A sweep that reads its work from the database survives restarts by
 * construction; a timer does not.
 *
 * Every sweep is idempotent and bounded, so a missed minute costs a minute and
 * a slow run degrades throughput rather than memory.
 */
export async function GET(req: NextRequest) {
  // Vercel signs cron invocations. Without this the endpoint is a public way to
  // make the platform call Dispatcher.
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const flags = readFlags();
  if (!flags.enabled) {
    return NextResponse.json({ skipped: "marketplace disabled" }, { status: 200 });
  }

  const nowMs = Date.now();
  const { runMarketplaceSweeps } = await import("@/lib/marketplace/sweeps");

  try {
    const result = await runMarketplaceSweeps(nowMs);
    console.log(JSON.stringify({ scope: "marketplace_cron", event: "sweeps_complete", ...result }));
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    console.error("[marketplace] sweep run failed", err);
    // 500 so the cron's own retry and the platform's alerting both see it.
    return NextResponse.json({ error: "Sweep failed" }, { status: 500 });
  }
}
