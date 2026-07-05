import "server-only";
import { buildRestaurantContext, type RestaurantContext } from "./context";
import { runDecisionEngine, confidenceToLevel } from "./decision-engine";
import { narrate } from "./narration";
import { writeUsageRecord } from "./usage";
import { createIntelligenceContext, lagosDateKey } from "./tools/_shared";
import { ASSISTANT_NAME } from "./branding";
import type { AiProvider } from "./provider";
import type {
  BriefAnomaly,
  BriefMetrics,
  BriefRecommendation,
  DailyBrief,
  Insight,
  RangeLabel,
} from "./types";

/**
 * Daily AI Brief generation.
 *
 * Reuses the ENTIRE intelligence foundation — no business logic is duplicated:
 *   buildRestaurantContext (tool layer)  → the data
 *   runDecisionEngine (deterministic)    → highlights / recommendations / anomalies
 *   narrate (provider + budget + fallback) → the prose summary
 *
 * Writes ONLY to `ai_briefs` (the brief) and `ai_usage` (accounting). Never a core
 * collection. Tenant-scoped, read-only over business data, gracefully degrading.
 */

export const AI_BRIEFS_COLLECTION = "ai_briefs";

/** How long a "generating" lock is considered fresh before it's treated as stale. */
const STALE_LOCK_MS = 2 * 60 * 1000;
const BRIEF_VERSION = 1;
/** Default window a morning brief summarises: the previous complete day. */
const DEFAULT_WINDOW: RangeLabel = "yesterday";

export class BriefBusyError extends Error {
  constructor() {
    super("A brief is already being generated for today.");
    this.name = "BriefBusyError";
  }
}

export interface GenerateBriefOptions {
  now?: () => Date;
  db?: FirebaseFirestore.Firestore;
  provider?: AiProvider | null;
  /** Force regeneration even if today's brief already exists (manual refresh). */
  force?: boolean;
  /** Override the summarised window (default: yesterday). */
  window?: RangeLabel;
  /** Override the calendar day the brief is for (default: Lagos-today). */
  dateKey?: string;
  requestId?: string;
}

export { lagosDateKey };

function briefDocId(slug: string, dateKey: string): string {
  return `${slug}:${dateKey}`;
}

/**
 * Generate (or return the cached) daily brief for a restaurant.
 *
 * - Without `force`: if a completed brief for today already exists, it is returned
 *   unchanged (cost control — no LLM call).
 * - Concurrent generations are de-duplicated via a transactional "generating" lock.
 */
export async function generateBrief(slug: string, opts: GenerateBriefOptions = {}): Promise<DailyBrief> {
  const ctx = createIntelligenceContext(slug, {
    feature: "brief",
    now: opts.now,
    db: opts.db,
    requestId: opts.requestId,
  });

  const dateKey = opts.dateKey ?? lagosDateKey(ctx.now());
  const window = opts.window ?? DEFAULT_WINDOW;
  const ref = ctx.db.collection(AI_BRIEFS_COLLECTION).doc(briefDocId(slug, dateKey));

  // Fast path: a completed brief already exists and no refresh was requested.
  if (!opts.force) {
    const existing = await ref.get();
    const data = existing.exists ? (existing.data() as DailyBrief) : null;
    if (data && data.status === "complete") return data;
  }

  // Transactionally claim the "generating" lock (dedupes concurrent generation).
  const nowMs = ctx.now().getTime();
  let precompleted: DailyBrief | null = null;
  let busy = false;

  await ctx.db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? (snap.data() as DailyBrief & { lockedAtMs?: number }) : null;

    if (!opts.force && data && data.status === "complete") {
      precompleted = data;
      return;
    }
    if (data && data.status === "generating" && typeof data.lockedAtMs === "number" && nowMs - data.lockedAtMs < STALE_LOCK_MS) {
      busy = true;
      return;
    }
    tx.set(ref, { restaurantId: slug, dateKey, status: "generating", lockedAtMs: nowMs }, { merge: true });
  });

  if (precompleted) return precompleted;
  if (busy) throw new BriefBusyError();

  try {
    const brief = await composeBrief(ctx, slug, dateKey, window, opts.provider);
    // Full overwrite → status complete, lock cleared.
    await ref.set(brief);
    await writeUsageRecord(ctx, {
      status: "ok",
      note: `brief dateKey=${dateKey} window=${window} mode=${brief.mode} force=${!!opts.force}`,
    });
    return brief;
  } catch (err) {
    // Release the lock so a later run can retry.
    await ref.set({ status: "error", lockedAtMs: 0 }, { merge: true }).catch(() => {});
    await writeUsageRecord(ctx, { status: "error", note: `brief failed: ${err instanceof Error ? err.message : String(err)}` }).catch(() => {});
    throw err;
  }
}

/** Read the cached brief for a day (default: Lagos-today). Returns null if none/incomplete. */
export async function getBrief(
  slug: string,
  opts: { dateKey?: string; now?: () => Date; db?: FirebaseFirestore.Firestore } = {}
): Promise<DailyBrief | null> {
  const ctx = createIntelligenceContext(slug, { feature: "brief-read", now: opts.now, db: opts.db });
  const dateKey = opts.dateKey ?? lagosDateKey(ctx.now());
  const snap = await ctx.db.collection(AI_BRIEFS_COLLECTION).doc(briefDocId(slug, dateKey)).get();
  if (!snap.exists) return null;
  const data = snap.data() as DailyBrief;
  return data.status === "complete" ? data : null;
}

// ---------------------------------------------------------------------------
// Compose the brief content from the foundation
// ---------------------------------------------------------------------------

async function composeBrief(
  ctx: ReturnType<typeof createIntelligenceContext>,
  slug: string,
  dateKey: string,
  window: RangeLabel,
  provider: AiProvider | null | undefined
): Promise<DailyBrief> {
  const context = await buildRestaurantContext(ctx, { range: { range: window } });
  const report = runDecisionEngine(context);

  const highlights = buildHighlights(context, report.insights);
  const recommendations = buildRecommendations(report.insights);
  const anomalies = buildAnomalies(report.insights);
  const metrics = buildMetrics(context);
  const confidence = briefConfidence(context);

  const narration = await narrate(ctx, {
    system: briefSystemPrompt(),
    userPrompt: buildBriefPrompt(context, report.insights),
    deterministic: () => deterministicBriefSummary(context, report.insights),
    provider,
    maxTokens: 500,
  });

  return {
    restaurantId: slug,
    dateKey,
    timeWindow: { label: window, from: context.range.from, to: context.range.to },
    summary: narration.text,
    highlights,
    recommendations,
    anomalies,
    metrics,
    generatedAt: ctx.now().toISOString(),
    modelUsed: narration.provider,
    mode: narration.mode,
    degraded: narration.degraded || context.meta.degraded,
    confidence,
    confidenceLevel: confidenceToLevel(confidence),
    status: "complete",
    version: BRIEF_VERSION,
    usage: narration.usage,
  };
}

function buildHighlights(context: RestaurantContext, insights: Insight[]): string[] {
  const out: string[] = [];
  const s = context.sales.summary;
  if (s) {
    out.push(`Revenue ${naira(s.totalRevenue)} from ${s.paidOrders} paid order${s.paidOrders === 1 ? "" : "s"} (avg ${naira(s.averageOrderValue)}).`);
    if (s.previous.revenueChangePct != null) {
      out.push(`${s.previous.revenueChangePct >= 0 ? "Up" : "Down"} ${Math.abs(s.previous.revenueChangePct)}% vs the previous period.`);
    }
  }
  const top = context.menu.topItems?.items?.[0];
  if (top && top.quantity > 0) out.push(`Best seller: ${top.name} (${top.quantity} sold).`);

  for (const i of insights.filter((x) => x.type === "highlight" || x.type === "trend")) {
    if (out.length >= 6) break;
    out.push(i.title);
  }
  return out.slice(0, 6);
}

function buildRecommendations(insights: Insight[]): BriefRecommendation[] {
  return insights
    .filter((i) => (i.type === "opportunity" || i.type === "warning") && i.suggestedAction)
    .slice(0, 5)
    .map((i) => ({ title: i.title, action: i.suggestedAction as string, confidenceLevel: i.confidenceLevel }));
}

function buildAnomalies(insights: Insight[]): BriefAnomaly[] {
  return insights
    .filter((i) => i.type === "anomaly" || i.severity === "critical" || i.severity === "high")
    .slice(0, 5)
    .map((i) => ({ title: i.title, reason: i.reason, severity: i.severity }));
}

function buildMetrics(context: RestaurantContext): BriefMetrics {
  const s = context.sales.summary;
  const top = context.menu.topItems?.items?.[0];
  return {
    revenue: s?.totalRevenue ?? 0,
    orders: s?.totalOrders ?? 0,
    paidOrders: s?.paidOrders ?? 0,
    averageOrderValue: s?.averageOrderValue ?? 0,
    revenueChangePct: s?.previous.revenueChangePct ?? null,
    topItem: top?.name ?? null,
    slowItemCount: context.menu.slowItems?.neverSold.length ?? 0,
    avgPrepMinutes: context.reports.kitchen?.avgReadyMinutes ?? null,
    newCustomers: context.customers?.newCustomers ?? 0,
    returningCustomers: context.customers?.returningCustomers ?? 0,
  };
}

/**
 * Overall confidence in the brief, driven by data volume and tool success. Few
 * orders → lower confidence; any failed tool caps it.
 */
export function briefConfidence(context: RestaurantContext): number {
  const orders = context.sales.summary?.totalOrders ?? 0;
  const dataFactor = Math.min(1, orders / 20); // ~20 orders → full confidence in the numbers
  const toolFactor = context.meta.toolsFailed.length === 0 ? 1 : 0.7;
  const raw = (0.4 + 0.5 * dataFactor) * toolFactor;
  return Math.round(Math.max(0, Math.min(0.95, raw)) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Prompts & deterministic fallback
// ---------------------------------------------------------------------------

function briefSystemPrompt(): string {
  return [
    `You are ${ASSISTANT_NAME}, writing a short morning brief for a restaurant owner in Nigeria.`,
    `Use ONLY the structured JSON data provided. Never invent numbers. All money is Naira (₦).`,
    `Write 3-5 sentences covering: yesterday's revenue and orders, the best and any slow items, kitchen and staff performance, customer activity, and the single most important thing to act on today.`,
    `If a section's data is missing, skip it — do not guess. Plain, encouraging, practical language. No JSON, no bullet points, no markdown.`,
  ].join("\n");
}

function buildBriefPrompt(context: RestaurantContext, insights: Insight[]): string {
  const grounding = {
    timeWindow: context.range,
    sales: context.sales.summary,
    orders: context.orders ? { total: context.orders.total, byStatus: context.orders.byStatus } : null,
    topItems: context.menu.topItems?.items?.slice(0, 5) ?? null,
    slowItems: context.menu.slowItems ? context.menu.slowItems.neverSold.slice(0, 8) : null,
    kitchen: context.reports.kitchen,
    staff: context.staff?.perStaff?.slice(0, 3) ?? null,
    customers: context.customers
      ? { newCustomers: context.customers.newCustomers, returningCustomers: context.customers.returningCustomers, repeatRate: context.customers.repeatRate }
      : null,
    insights: insights.slice(0, 6).map((i) => ({ type: i.type, title: i.title, reason: i.reason, suggestedAction: i.suggestedAction })),
  };
  return `Write the morning brief from this data (your ONLY source):\n${JSON.stringify(grounding)}`;
}

function naira(n: number): string {
  return `₦${Math.round(n).toLocaleString("en-NG")}`;
}

export function deterministicBriefSummary(context: RestaurantContext, insights: Insight[]): string {
  const parts: string[] = [];
  const label = context.range.label;
  const s = context.sales.summary;

  if (s && s.totalOrders > 0) {
    parts.push(`${cap(label)}: ${naira(s.totalRevenue)} from ${s.paidOrders} paid order${s.paidOrders === 1 ? "" : "s"} (avg ${naira(s.averageOrderValue)}).`);
    if (s.previous.revenueChangePct != null) {
      parts.push(`That's ${s.previous.revenueChangePct >= 0 ? "up" : "down"} ${Math.abs(s.previous.revenueChangePct)}% vs the previous period.`);
    }
  } else {
    parts.push(`No order activity recorded for ${label}.`);
  }

  const top = context.menu.topItems?.items?.[0];
  if (top && top.quantity > 0) parts.push(`Best seller was ${top.name} (${top.quantity} sold).`);

  const k = context.reports.kitchen;
  if (k?.avgReadyMinutes != null) parts.push(`Average prep time was ${k.avgReadyMinutes} min.`);

  const rec = insights.find((i) => (i.type === "opportunity" || i.type === "warning") && i.suggestedAction);
  if (rec) parts.push(`Focus today: ${rec.suggestedAction}`);

  return parts.join(" ");
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
