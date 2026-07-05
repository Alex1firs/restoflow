import "server-only";
import type { IntelligenceContext } from "./tools/_shared";
import type { AuditEvent } from "./guardrails";
import type { UsageRecord } from "./types";

/**
 * AI Usage / Audit persistence
 * ============================
 * Flushes a request's in-memory audit buffer + token/cost accounting to a single
 * document in the dedicated `ai_usage` collection.
 *
 * DESIGN — WRITE SAFETY:
 *   - This is the ONLY module in `lib/ai` that writes to Firestore.
 *   - It writes to EXACTLY ONE collection: `ai_usage`. The collection name is a
 *     hard-coded constant (`AI_USAGE_COLLECTION`) — no caller can redirect it.
 *   - It NEVER writes to orders / restaurants / payments / menu_items /
 *     prepared_items / users / any core collection. Integration tests assert this.
 *   - One summary doc per request (not per event) keeps write volume tiny.
 */

export const AI_USAGE_COLLECTION = "ai_usage";

/** Max audit events embedded in a usage doc (keeps the document small). */
const MAX_EMBEDDED_EVENTS = 200;

export interface WriteUsageOptions {
  status?: "ok" | "error";
  note?: string;
  toolsRun?: string[];
  toolsFailed?: { tool: string; error: string }[];
  degraded?: boolean;
}

/** Build the usage record from a context's audit buffer + budget, without writing. */
export function buildUsageRecord(ctx: IntelligenceContext, opts: WriteUsageOptions = {}): UsageRecord {
  const events: AuditEvent[] = ctx.audit.drain();
  const usage = ctx.budget.usage;

  return {
    requestId: ctx.scope.requestId,
    restaurantSlug: ctx.scope.restaurantSlug,
    at: ctx.now().toISOString(),
    feature: ctx.feature,
    status: opts.status ?? "ok",
    tokensUsed: usage.tokens,
    costUsd: usage.costUsd,
    eventCount: events.length,
    events: events
      .slice(-MAX_EMBEDDED_EVENTS)
      .reverse() // most recent first
      .map((e) => ({ event: e.event, at: e.at, details: e.details })),
    ...(opts.toolsRun ? { toolsRun: opts.toolsRun } : {}),
    ...(opts.toolsFailed ? { toolsFailed: opts.toolsFailed } : {}),
    ...(opts.degraded != null ? { degraded: opts.degraded } : {}),
    ...(opts.note ? { note: opts.note } : {}),
  };
}

/**
 * Persist a usage/audit record to `ai_usage`. Uses the context's resolved
 * Firestore handle (Admin SDK in production, a fake in tests). Failures are
 * swallowed and logged — usage accounting must never break the caller's request.
 *
 * @returns the record that was written (for logging/inspection), or null on failure.
 */
export async function writeUsageRecord(
  ctx: IntelligenceContext,
  opts: WriteUsageOptions = {}
): Promise<UsageRecord | null> {
  const record = buildUsageRecord(ctx, opts);
  try {
    // Hard-scoped to AI_USAGE_COLLECTION — no other collection is ever touched.
    await ctx.db.collection(AI_USAGE_COLLECTION).doc(record.requestId).set(record);
    return record;
  } catch (err) {
    console.error(`[ai-usage] failed to persist usage for ${record.requestId}:`, err);
    return null;
  }
}
