import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The discovery reconciler.
 *
 * ── What it is for ───────────────────────────────────────────────────────────
 * Two jobs that genuinely belong on a schedule:
 *
 *   1. Reconcile the index against source data, repairing anything a write-time
 *      nudge missed — a failed request, a restaurant edited by a path that does
 *      not nudge, a doc deleted underneath us.
 *   2. Recompute popularity, which is a rolling window over orders and is
 *      therefore wrong the moment it stops being recomputed. Without this every
 *      score sits at the cold-start neutral value and "Popular Around You" is
 *      ranked by nothing.
 *
 * Immediacy is NOT this job's responsibility — the hosting plan permits one run
 * a day, so a menu edit is refreshed by the write-time nudge and this pass is
 * the safety net underneath it.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const log = (event: string, fields: Record<string, unknown>) =>
    console.log(JSON.stringify({ scope: "discovery_cron", event, ...fields }));

  try {
    const { getAdminDb } = await import("@/lib/firebase-admin");
    const { createFirestoreStore } = await import("@/lib/discovery/firestore-store");
    const { backfillAll } = await import("@/lib/discovery/indexer");
    const { recomputePopularity } = await import("@/lib/discovery/popularity-job");

    const store = createFirestoreStore(getAdminDb());
    const nowMs = Date.now();

    const reconcile = await backfillAll(store, nowMs);
    // Popularity runs second, on the index the reconcile just refreshed.
    const popularity = await recomputePopularity(store, nowMs);

    const result = { reconcile, popularity };
    log("complete", { ...reconcile, scoredDishes: popularity.scoredDishes, orders: popularity.orders });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    log("failed", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: "discovery reconcile failed" }, { status: 500 });
  }
}
