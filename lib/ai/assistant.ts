import "server-only";
import { buildRestaurantContext, type RestaurantContext } from "./context";
import { runDecisionEngine } from "./decision-engine";
import { type AiProvider } from "./provider";
import { sanitizePrompt } from "./guardrails";
import { narrate } from "./narration";
import { writeUsageRecord } from "./usage";
import { matchEntities, suggestTools } from "./vocabulary";
import { createIntelligenceContext, type IntelligenceContext } from "./tools/_shared";
import { ASSISTANT_NAME } from "./branding";
import type { EntityKey } from "./vocabulary";
import type { ConversationTurn, Insight, RangeInput, RangeLabel, UserRole } from "./types";

/**
 * Restaurant Intelligence Assistant (internally: "Copilot")
 * =========================================================
 * Answers a restaurant owner's natural-language questions STRICTLY from their own
 * data. Grounded question-answering, NOT a chatbot:
 *
 *   question (+ conversation history)
 *     → sanitise (guardrails)
 *     → resolve intent: time window + topics, INHERITING from prior turns for
 *       follow-ups like "why?" / "compare with yesterday" (deterministic)
 *     → assemble RestaurantContext (tool layer + context builder — the ONLY source)
 *     → run the deterministic decision engine (candidate explanations, no LLM)
 *     → narrate STRICTLY from that grounding (or a deterministic fallback)
 *     → persist usage to ai_usage
 *
 * Conversation memory is SERVER-STATELESS: the client passes recent turns back in
 * `history`. This keeps the assistant read-only (no conversation collection) while
 * letting the model resolve references without the user repeating the subject.
 */

export type AssistantMode = "ai" | "deterministic";

export interface AssistantAnswer {
  question: string;
  answer: string;
  mode: AssistantMode;
  degraded: boolean;
  provider: string | null;
  range: { label: RangeLabel; from: string; to: string };
  relevantTopics: EntityKey[];
  /** True when the answer resolved its subject/time window from earlier turns. */
  isFollowUp: boolean;
  groundedOn: string[];
  insights: Insight[];
  data: RestaurantContext;
  usage: { tokensUsed: number; costUsd: number } | null;
  generatedAt: string;
}

export interface AskAssistantOptions {
  role?: UserRole;
  now?: () => Date;
  db?: FirebaseFirestore.Firestore;
  provider?: AiProvider | null;
  range?: RangeInput;
  requestId?: string;
  /** Prior turns in this conversation (most recent last), for follow-up context. */
  history?: ConversationTurn[];
}

const MAX_QUESTION_CHARS = 500;
const MAX_HISTORY_TURNS = 6;
const MAX_HISTORY_ANSWER_CHARS = 600;

/** Answer a question about the restaurant, grounded entirely in the tool layer. */
export async function askAssistant(
  slug: string,
  rawQuestion: string,
  opts: AskAssistantOptions = {}
): Promise<AssistantAnswer> {
  const ctx = createIntelligenceContext(slug, {
    feature: "assistant",
    role: opts.role,
    now: opts.now,
    db: opts.db,
    requestId: opts.requestId,
  });

  const question = sanitizePrompt(rawQuestion, MAX_QUESTION_CHARS);
  if (!question.trim()) throw new Error("Empty question");

  const history = normalizeHistory(opts.history);

  // 1. Resolve intent, inheriting time window / topics from prior turns for follow-ups.
  const intent = resolveConversationalIntent(question, history);
  const range: RangeInput = opts.range ?? intent.range;

  // 2. Grounding: assemble context from the tool layer + run the decision engine.
  const context = await buildRestaurantContext(ctx, { range });
  const report = runDecisionEngine(context);

  // 3. Narrate (AI or deterministic fallback), with conversation history for reference resolution.
  const grounding = compactGrounding(context, report.insights, intent.topics, intent.suggestedTools);
  const narration = await narrate(ctx, {
    system: systemPrompt(),
    userPrompt: buildUserPrompt(question, context, grounding, history, intent.isFollowUp),
    deterministic: () => deterministicAnswer(context, report.insights),
    provider: opts.provider,
    maxTokens: 700,
  });

  // 4. Persist usage/audit to ai_usage (never a core collection).
  await writeUsageRecord(ctx, {
    status: "ok",
    note: `assistant mode=${narration.mode} followUp=${intent.isFollowUp} topics=[${intent.topics.join(",")}]`,
    toolsRun: context.meta.toolsRun,
    toolsFailed: context.meta.toolsFailed,
    degraded: context.meta.degraded,
  });

  return {
    question,
    answer: narration.text,
    mode: narration.mode,
    degraded: narration.degraded,
    provider: narration.provider,
    range: context.range as AssistantAnswer["range"],
    relevantTopics: intent.topics,
    isFollowUp: intent.isFollowUp,
    groundedOn: context.meta.toolsRun,
    insights: report.insights,
    data: context,
    usage: narration.usage,
    generatedAt: ctx.now().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Conversation memory: resolve a follow-up's intent from prior turns
// ---------------------------------------------------------------------------

function normalizeHistory(history?: ConversationTurn[]): ConversationTurn[] {
  if (!Array.isArray(history)) return [];
  return history
    .slice(-MAX_HISTORY_TURNS)
    .filter((t) => t && typeof t.question === "string" && typeof t.answer === "string")
    .map((t) => ({
      question: sanitizePrompt(t.question, MAX_QUESTION_CHARS),
      answer: sanitizePrompt(t.answer, MAX_HISTORY_ANSWER_CHARS),
    }));
}

interface ResolvedIntent {
  range: RangeInput;
  topics: EntityKey[];
  suggestedTools: string[];
  isFollowUp: boolean;
}

/** Detect an EXPLICIT time window in a question, or null if none is mentioned. */
export function detectRange(question: string): RangeLabel | null {
  const q = question.toLowerCase();
  if (/\byesterday\b/.test(q)) return "yesterday";
  if (/\b(this|past|last|the)\s+month\b|\bmonthly\b/.test(q)) return "month";
  if (/\b(this|past|last|the)\s+week\b|\bweekly\b|\b7 days\b/.test(q)) return "week";
  if (/\btoday\b|\bso far\b|\bright now\b|\bcurrently\b/.test(q)) return "today";
  return null;
}

/** Public range parser (defaults to "today"). Kept for backwards compatibility. */
export function parseRange(question: string): RangeInput {
  return { range: detectRange(question) ?? "today" };
}

const FOLLOWUP_PATTERNS = [
  /^why\b/i,
  /^how come\b/i,
  /^and\b/i,
  /^what about\b/i,
  /^compare\b/i,
  /^(what|which)\s+(one|ones|of (them|those)|caused|drove|led|made)\b/i,
  /\b(them|those|that|it|this)\b/i,
];

function looksLikeFollowUp(question: string): boolean {
  const q = question.trim();
  if (q.split(/\s+/).length <= 3) return true; // "Why?", "Compare with yesterday"
  return FOLLOWUP_PATTERNS.some((re) => re.test(q));
}

/**
 * Resolve the effective time window + topics for a question. For a follow-up that
 * omits its own window/subject (e.g. "Why?"), inherit them from the most recent
 * prior turn that specified them.
 */
export function resolveConversationalIntent(question: string, history: ConversationTurn[]): ResolvedIntent {
  const ownRange = detectRange(question);
  const ownTopics = matchEntities(question).map((e) => e.entity);
  const suggestedTools = suggestTools(question);

  const isFollowUp = history.length > 0 && (ownRange === null || ownTopics.length === 0 || looksLikeFollowUp(question));

  // Inherit a time window from the latest prior turn that stated one.
  let range: RangeLabel = ownRange ?? "today";
  if (ownRange === null && isFollowUp) {
    for (let i = history.length - 1; i >= 0; i--) {
      const prev = detectRange(history[i].question);
      if (prev) {
        range = prev;
        break;
      }
    }
  }

  // Inherit topics from the latest prior turn that had any.
  let topics = ownTopics;
  if (ownTopics.length === 0 && isFollowUp) {
    for (let i = history.length - 1; i >= 0; i--) {
      const prevTopics = matchEntities(history[i].question).map((e) => e.entity);
      if (prevTopics.length > 0) {
        topics = prevTopics;
        break;
      }
    }
  }

  return { range: { range }, topics, suggestedTools, isFollowUp };
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

function systemPrompt(): string {
  return [
    `You are ${ASSISTANT_NAME}, an assistant for a restaurant owner in Nigeria.`,
    `You answer questions ONLY using the structured JSON data provided in the user's message.`,
    `Hard rules:`,
    `- Never invent numbers, items, customers, or trends that are not present in the data.`,
    `- Every figure you state must come from the provided data. All money is Nigerian Naira (₦).`,
    `- If the data needed to answer is missing or null, say you don't have that data yet and suggest what to check — do not guess.`,
    `- For "why" questions, use the provided deterministic "insights" as candidate explanations; do not speculate beyond them.`,
    `- Use the earlier conversation (if any) to resolve references like "why", "them", or "compare" — the current question may build on it.`,
    `- Mention the time period the answer covers.`,
    `- Be concise (2-5 sentences), specific, and practical. Plain language, no JSON, no code, no markdown tables.`,
  ].join("\n");
}

function buildUserPrompt(
  question: string,
  context: RestaurantContext,
  grounding: unknown,
  history: ConversationTurn[],
  isFollowUp: boolean
): string {
  const lines: string[] = [];

  if (history.length > 0) {
    lines.push(`Earlier in this conversation:`);
    for (const turn of history) {
      lines.push(`Q: ${turn.question}`);
      lines.push(`A: ${turn.answer}`);
    }
    lines.push(``);
  }

  lines.push(`Current question: ${question}`);
  if (isFollowUp) lines.push(`(This is a follow-up — resolve any references from the earlier conversation.)`);
  lines.push(``);
  lines.push(`Time period for this answer: ${context.range.label} (${context.range.from} to ${context.range.to}).`);
  lines.push(``);
  lines.push(`Restaurant data (this is your ONLY source — answer strictly from it):`);
  lines.push(JSON.stringify(grounding));

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Compact grounding — trim large arrays to bound tokens without losing signal
// ---------------------------------------------------------------------------

function compactGrounding(
  context: RestaurantContext,
  insights: Insight[],
  topics: EntityKey[],
  suggestedTools: string[]
): Record<string, unknown> {
  return {
    relevantTopics: topics,
    suggestedTools,
    business: context.business,
    settings: context.settings,
    sales: {
      summary: context.sales.summary,
      byHour: context.sales.byHour
        ? { peakHour: context.sales.byHour.peakHour, peakRevenueHour: context.sales.byHour.peakRevenueHour }
        : null,
    },
    orders: context.orders
      ? { total: context.orders.total, byStatus: context.orders.byStatus, active: context.orders.active, revenueSoFar: context.orders.revenueSoFar }
      : null,
    menu: {
      analytics: context.menu.analytics,
      topItems: context.menu.topItems ? context.menu.topItems.items.slice(0, 5) : null,
      slowItems: context.menu.slowItems
        ? { neverSold: context.menu.slowItems.neverSold.slice(0, 10), low: context.menu.slowItems.items.slice(0, 5) }
        : null,
    },
    customers: context.customers
      ? {
          totalCustomers: context.customers.totalCustomers,
          newCustomers: context.customers.newCustomers,
          returningCustomers: context.customers.returningCustomers,
          repeatRate: context.customers.repeatRate,
          loyalty: context.customers.loyalty,
        }
      : null,
    staff: context.staff ? { staffCount: context.staff.staffCount, perStaff: context.staff.perStaff.slice(0, 5) } : null,
    inventory: context.inventory
      ? {
          totalItems: context.inventory.totalItems,
          unavailableItems: context.inventory.unavailableItems,
          outOfStock: context.inventory.outOfStock.slice(0, 8),
          quantitativeStockTracked: context.inventory.quantitativeStockTracked,
        }
      : null,
    kitchen: context.reports.kitchen,
    insights: insights.slice(0, 8).map((i) => ({
      type: i.type,
      title: i.title,
      reason: i.reason,
      suggestedAction: i.suggestedAction,
      confidenceLevel: i.confidenceLevel,
    })),
    dataQuality: { toolsFailed: context.meta.toolsFailed.map((t) => t.tool), degraded: context.meta.degraded },
  };
}

// ---------------------------------------------------------------------------
// Deterministic fallback answer (no LLM) — composed from trusted numbers only
// ---------------------------------------------------------------------------

function naira(n: number): string {
  return `₦${Math.round(n).toLocaleString("en-NG")}`;
}

export function deterministicAnswer(context: RestaurantContext, insights: Insight[]): string {
  const parts: string[] = [];
  const label = context.range.label;
  const s = context.sales.summary;

  if (s && s.totalOrders > 0) {
    parts.push(
      `For ${label}, you made ${naira(s.totalRevenue)} from ${s.paidOrders} paid order${s.paidOrders === 1 ? "" : "s"} (average ${naira(s.averageOrderValue)} per order).`
    );
    if (s.previous.revenueChangePct != null) {
      const dir = s.previous.revenueChangePct >= 0 ? "up" : "down";
      parts.push(`That's ${dir} ${Math.abs(s.previous.revenueChangePct)}% versus the previous period (${naira(s.previous.totalRevenue)}).`);
    }
  } else if (context.orders && context.orders.total > 0) {
    parts.push(`For ${label}, you have ${context.orders.total} order(s), with ${naira(context.orders.revenueSoFar)} collected so far.`);
  } else {
    parts.push(`There is no order data for ${label} yet.`);
  }

  const top = context.menu.topItems?.items?.[0];
  if (top && top.quantity > 0) parts.push(`Top seller: ${top.name} (${top.quantity} sold).`);

  const notable = insights.filter((i) => i.type === "warning" || i.type === "anomaly").slice(0, 2);
  if (notable.length > 0) parts.push(`Worth attention: ${notable.map((i) => i.title).join("; ")}.`);

  parts.push(`(AI narration is unavailable, so this is a direct summary of your data.)`);
  return parts.join(" ");
}

export type { IntelligenceContext };
