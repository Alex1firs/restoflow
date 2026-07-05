import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { getSubscriptionInfo } from "@/lib/subscription";
import { generateBrief } from "@/lib/ai/brief";

/**
 * GET /api/cron/ai-brief  — Vercel Cron entrypoint (scheduled in vercel.json).
 *
 * Generates the morning brief for every operational restaurant, asynchronously and
 * OFF the customer request path. Guarded by CRON_SECRET. Idempotent: restaurants
 * whose brief already exists for today are skipped (no LLM call). Per-tenant
 * failures are isolated. Reads `restaurants` (read-only); writes only `ai_briefs`
 * + `ai_usage` via generateBrief.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300; // allow the batch to run to completion (Pro plan)

/** Bounded concurrency so we don't fan out unbounded LLM calls. */
const CONCURRENCY = 3;

export async function GET(req: NextRequest) {
  // Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` when CRON_SECRET is set.
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const db = getAdminDb();
  const snap = await db.collection("restaurants").get();

  // Only operational restaurants (active subscription / grace) get briefs.
  const targets: string[] = [];
  for (const doc of snap.docs) {
    try {
      const sub = await getSubscriptionInfo(doc.data() as Record<string, unknown>);
      if (sub.isOperational) targets.push(doc.id);
    } catch {
      /* skip malformed restaurant docs */
    }
  }

  const results: { slug: string; status: string; error?: string }[] = [];

  // Simple bounded-concurrency worker pool.
  let cursor = 0;
  async function worker() {
    while (cursor < targets.length) {
      const slug = targets[cursor++];
      try {
        const brief = await generateBrief(slug); // no force → skips if already generated today
        results.push({ slug, status: brief.status });
      } catch (err) {
        results.push({ slug, status: "error", error: err instanceof Error ? err.message : String(err) });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));

  const generated = results.filter((r) => r.status === "complete").length;
  const failed = results.filter((r) => r.status === "error").length;
  console.log(`[cron/ai-brief] targets=${targets.length} generated=${generated} failed=${failed}`);

  return NextResponse.json({ ok: true, targets: targets.length, generated, failed, results }, { status: 200 });
}
