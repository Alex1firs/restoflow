import "server-only";
import { askAssistant } from "./assistant";
import { getBrief, generateBrief } from "./brief";
import { listRecommendations, updateRecommendationStatus } from "./recommendations";
import { getPurchasingPlan, generatePurchasingPlan } from "./purchasing";
import {
  createAutomationFromRecommendation,
  createAutomationFromPurchasingLine,
  executeAutomation,
  getAutomationRule,
} from "./automation";
import { sanitizePrompt } from "./guardrails";
import type { AiProvider } from "./provider";
import type {
  ActorRef,
  ConversationTurn,
  DailyBrief,
  Recommendation,
  VoicePendingAction,
  VoiceTurnResult,
} from "./types";

/**
 * Voice AI Restaurant Manager — Phase 7
 * =====================================
 * Voice is another CLIENT on top of the existing AI stack, not a new engine. This
 * server module orchestrates a single voice turn:
 *
 *   transcript ─▶ intent routing ─▶ (Assistant | Brief | Recommendation | Purchasing
 *                                    | Automation) ─▶ spoken-optimized answer
 *
 * It performs NO speech I/O — the client's SpeechProvider does STT/TTS. The server
 * receives a transcript and returns text to speak, so any STT/TTS provider (browser
 * today; cloud later) works with zero server changes.
 *
 * Everything it can DO flows through the existing, unchanged engines:
 *  - Questions   → `askAssistant` (grounded in the tool layer).
 *  - "How are we doing?" → the Daily Brief, read aloud.
 *  - Actions     → APPROVAL-FIRST: a command proposes an action and asks for a spoken
 *                  "yes"; only then does it approve a recommendation / draft restocks
 *                  via the Automation engine (which still requires an enabled rule).
 *
 * No business data is mutated — voice execution routes through the automation engine,
 * whose handlers cannot write core collections. Tenant is always the session slug.
 */

export interface VoiceTurnOptions {
  history?: ConversationTurn[];
  pending?: VoicePendingAction | null;
  actor?: ActorRef;
  db?: FirebaseFirestore.Firestore;
  now?: () => Date;
  provider?: AiProvider | null;
}

const MAX_TRANSCRIPT_CHARS = 500;

/** Handle one voice turn and return what to speak + any pending confirmation. */
export async function handleVoiceTurn(slug: string, transcript: string, opts: VoiceTurnOptions = {}): Promise<VoiceTurnResult> {
  const clean = sanitizePrompt(transcript, MAX_TRANSCRIPT_CHARS).trim();
  const lower = clean.toLowerCase();
  const actor: ActorRef = opts.actor ?? { type: "owner", id: "voice" };

  if (!clean) return say("I didn't catch that. Could you say it again?", "unknown");

  // 1. Resolve an outstanding confirmation first.
  if (opts.pending) {
    if (isAffirmative(lower)) return executePending(slug, opts.pending, actor, opts);
    if (isNegative(lower)) return say("Okay, I've cancelled that.", "cancelled");
    // Anything else → treat as a fresh turn (the pending action is dropped).
  }

  // 2. Spoken brief — "how are we doing?", "good morning", "give me the rundown".
  if (isBriefIntent(lower)) return speakBrief(slug, opts);

  // 3. Action commands (propose → confirm; never execute outright).
  if (isPurchasingCommand(lower)) return proposePurchasing(slug, opts);
  const recTarget = matchRecommendationCommand(lower);
  if (recTarget !== null) return proposeRecommendation(slug, recTarget, opts);

  // 4. Default: a question, answered by the grounded Assistant, optimized for speech.
  const ans = await askAssistant(slug, clean, {
    history: opts.history,
    db: opts.db,
    now: opts.now,
    provider: opts.provider,
    role: actor.type === "manager" ? "manager" : "owner",
  });
  return { intent: "question", speech: toSpeech(ans.answer), display: ans.answer, pending: null, executed: false, degraded: ans.degraded };
}

// ---------------------------------------------------------------------------
// Brief (read aloud)
// ---------------------------------------------------------------------------

async function speakBrief(slug: string, opts: VoiceTurnOptions): Promise<VoiceTurnResult> {
  let brief: DailyBrief | null = await getBrief(slug, { db: opts.db, now: opts.now });
  if (!brief) {
    try {
      brief = await generateBrief(slug, { db: opts.db, now: opts.now, provider: opts.provider ?? undefined });
    } catch {
      brief = null;
    }
  }
  if (!brief) return say("I don't have today's brief ready yet. Try again in a moment.", "brief");

  const bits: string[] = [brief.summary];
  const pendingRecs = brief.recommendations?.length ?? 0;
  if (pendingRecs > 0) {
    bits.push(`${pendingRecs} recommendation${pendingRecs === 1 ? "" : "s"} ${pendingRecs === 1 ? "is" : "are"} waiting for your approval.`);
  }
  const text = bits.join(" ");
  return { intent: "brief", speech: toSpeech(text), display: text, pending: null, executed: false, degraded: brief.degraded };
}

// ---------------------------------------------------------------------------
// Command proposals (approval-first — propose, then require a spoken "yes")
// ---------------------------------------------------------------------------

async function proposePurchasing(slug: string, opts: VoiceTurnOptions): Promise<VoiceTurnResult> {
  let plan = await getPurchasingPlan(slug, { db: opts.db, now: opts.now });
  if (!plan) plan = await generatePurchasingPlan(slug, { db: opts.db, now: opts.now });

  const high = plan.menuDemand.filter((l) => l.reorderSignal === "HIGH");
  if (high.length === 0) return say("Your purchasing plan has no high-priority restocks right now.", "command");

  const items = high.map((l) => l.item);
  const list = speakList(items);
  const pending: VoicePendingAction = { type: "execute_purchasing", items, label: `${items.length} restock draft${items.length === 1 ? "" : "s"}` };
  const speech = `Your plan has ${items.length} high-priority restock${items.length === 1 ? "" : "s"}: ${list}. Shall I draft the restock orders?`;
  return { intent: "command", speech, display: speech, pending, executed: false, degraded: plan.degraded };
}

async function proposeRecommendation(slug: string, target: string, opts: VoiceTurnOptions): Promise<VoiceTurnResult> {
  const recs = await listRecommendations(slug, { db: opts.db, now: opts.now });
  const match = target ? recs.find((r) => matchesTarget(r, target)) : recs[0];
  if (!match) {
    const speech = target
      ? `I don't have a recommendation matching "${target}" right now.`
      : "I don't have any recommendations to act on right now.";
    return say(speech, "command");
  }
  const pending: VoicePendingAction = { type: "execute_recommendation", recId: match.id, label: match.title };
  const speech = `I found a recommendation: ${match.title}. Should I approve and run it?`;
  return { intent: "command", speech, display: speech, pending, executed: false, degraded: false };
}

// ---------------------------------------------------------------------------
// Execution of a confirmed action (still gated by the automation rule)
// ---------------------------------------------------------------------------

async function executePending(slug: string, pending: VoicePendingAction, actor: ActorRef, opts: VoiceTurnOptions): Promise<VoiceTurnResult> {
  if (pending.type === "execute_recommendation") return runRecommendation(slug, pending, actor, opts);
  return runPurchasing(slug, pending, actor, opts);
}

async function runRecommendation(slug: string, pending: VoicePendingAction, actor: ActorRef, opts: VoiceTurnOptions): Promise<VoiceTurnResult> {
  const recId = pending.recId!;
  const recs = await listRecommendations(slug, { db: opts.db, now: opts.now, includeDismissed: true });
  const rec = recs.find((r) => r.id === recId);
  if (!rec) return say("I couldn't find that recommendation anymore.", "confirm");

  // Voice approval: mark accepted, then create the automation.
  if (rec.status !== "accepted") await updateRecommendationStatus(slug, recId, "accepted", { db: opts.db, now: opts.now });
  const automation = await createAutomationFromRecommendation(slug, recId, actor, { db: opts.db, now: opts.now });

  const rule = await getAutomationRule(slug, automation.handlerKind, { db: opts.db, now: opts.now });
  if (!rule.enabled) {
    const speech = `I've approved "${rec.title}". To have me carry it out by voice, enable ${prettyKind(automation.handlerKind)} automation in your settings.`;
    return { intent: "confirm", speech, display: speech, pending: null, executed: false, degraded: false };
  }
  const { execution } = await executeAutomation(slug, automation.id, actor, { db: opts.db, now: opts.now });
  const speech = execution.status === "succeeded" ? `Done. ${execution.result?.detail ?? rec.title}.` : `I couldn't complete that: ${execution.error?.message ?? "please try again."}`;
  return { intent: "confirm", speech, display: speech, pending: null, executed: execution.status === "succeeded", degraded: false };
}

async function runPurchasing(slug: string, pending: VoicePendingAction, actor: ActorRef, opts: VoiceTurnOptions): Promise<VoiceTurnResult> {
  const items = pending.items ?? [];
  const rule = await getAutomationRule(slug, "purchase_order_draft", { db: opts.db, now: opts.now });

  let created = 0;
  let executed = 0;
  for (const item of items) {
    try {
      const automation = await createAutomationFromPurchasingLine(slug, item, actor, { db: opts.db, now: opts.now });
      created++;
      if (rule.enabled) {
        const { execution } = await executeAutomation(slug, automation.id, actor, { db: opts.db, now: opts.now });
        if (execution.status === "succeeded") executed++;
      }
    } catch {
      /* skip an item that can't be automated (e.g. no longer HIGH) */
    }
  }

  if (created === 0) return say("None of those items can be restocked automatically right now.", "confirm");
  if (!rule.enabled) {
    const speech = `I've prepared ${created} restock action${created === 1 ? "" : "s"}. Enable restock order drafts automation to have me run them by voice.`;
    return { intent: "confirm", speech, display: speech, pending: null, executed: false, degraded: false };
  }
  const speech = `Done. I've drafted ${executed} restock order${executed === 1 ? "" : "s"}.`;
  return { intent: "confirm", speech, display: speech, pending: null, executed: executed > 0, degraded: false };
}

// ---------------------------------------------------------------------------
// Intent detection (deterministic)
// ---------------------------------------------------------------------------

function isAffirmative(t: string): boolean {
  return /^(yes|yeah|yep|yup|sure|ok|okay|confirm|do it|go ahead|please do|approve it|run it|execute)\b/.test(t);
}
function isNegative(t: string): boolean {
  return /^(no|nope|nah|cancel|stop|don'?t|do not|never ?mind|forget it|not now)\b/.test(t);
}
function isBriefIntent(t: string): boolean {
  return /(how are we doing|how'?re we doing|how are things|how'?s (it going|business|today)|good morning|morning brief|daily brief|the rundown|give me (a|the) (summary|brief|rundown)|what'?s (the )?(update|summary))/.test(t);
}
function isPurchasingCommand(t: string): boolean {
  return /(approve|execute|run|confirm|do|start).{0,20}(purchasing|purchase|buying|restock|reorder|order).{0,10}(plan|list|order|s)?/.test(t) || /(draft|create).{0,15}(restock|purchase|order)/.test(t);
}
/**
 * A recommendation action command → returns the target phrase ("jollof rice"), an
 * empty string for a generic "run the recommendation", or null if not a rec command.
 */
function matchRecommendationCommand(t: string): string | null {
  // "increase/raise <item> by ₦200", "approve/execute/apply the recommendation for <item>"
  const priceMatch = t.match(/(?:increase|raise|bump|change|adjust).*?(?:price of |for )?(.+?)\s+by\s+(?:₦|naira|n)?\s?\d/);
  if (priceMatch) return priceMatch[1].trim();
  const forMatch = t.match(/(?:approve|execute|apply|run|do).*?recommendation(?:\s+(?:for|on|about)\s+(.+))?/);
  if (forMatch) return (forMatch[1] ?? "").trim();
  return null;
}

function matchesTarget(rec: Recommendation, target: string): boolean {
  const t = target.toLowerCase();
  const hay = `${rec.title} ${rec.action?.target ?? ""} ${rec.type}`.toLowerCase();
  // Match if the target phrase (or a significant word of it) appears in the rec.
  if (hay.includes(t)) return true;
  return t.split(/\s+/).filter((w) => w.length >= 3).some((w) => hay.includes(w));
}

// ---------------------------------------------------------------------------
// Speech shaping
// ---------------------------------------------------------------------------

/** Convert answer text into a natural spoken string (no markdown, ₦→naira, %→percent). */
export function toSpeech(text: string): string {
  return text
    .replace(/[#*_`>]/g, "")
    .replace(/^\s*[-•]\s*/gm, "")
    .replace(/₦\s?([\d,]+(?:\.\d+)?)/g, "$1 naira")
    .replace(/%/g, " percent")
    .replace(/\s*\n+\s*/g, ". ")
    .replace(/\.(\s*\.)+/g, ".")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function speakList(items: string[]): string {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function prettyKind(kind: string): string {
  if (kind === "notify") return "notifications";
  if (kind === "purchase_order_draft") return "restock order drafts";
  return kind.replace(/_/g, " ");
}

function say(text: string, intent: VoiceTurnResult["intent"]): VoiceTurnResult {
  return { intent, speech: toSpeech(text), display: text, pending: null, executed: false, degraded: false };
}
