import "server-only";
import { askAssistant } from "./assistant";
import { getBrief, generateBrief } from "./brief";
import { listRecommendations, updateRecommendationStatus } from "./recommendations";
import { getOperatingProfile, applyProfileToRecommendations } from "./profile";
import { explainRecommendation, explanationToSpeech } from "./explainability";
import { getPurchasingPlan, generatePurchasingPlan } from "./purchasing";
import {
  createAutomationFromRecommendation,
  createAutomationFromPurchasingLine,
  executeAutomation,
  getAutomationRule,
} from "./automation";
import { sanitizePrompt } from "./guardrails";
import { lagosHour } from "./tools/_shared";
import type { AiProvider } from "./provider";
import type {
  ActorRef,
  ConversationTurn,
  DailyBrief,
  Recommendation,
  VoiceGreeting,
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
    // Explainability: "why?" / "explain" / "what if I ignore it?" about a proposed
    // recommendation are answered from its structured fields — not re-reasoned — and
    // the pending confirmation is preserved so the owner can still say "yes".
    if (opts.pending.type === "execute_recommendation" && opts.pending.recId) {
      const part = explainIntent(lower);
      if (part) return explainPendingRecommendation(slug, opts.pending, part, opts);
    }
    if (isAffirmative(lower)) {
      if (opts.pending.type === "read_recommendations") return speakRecommendations(slug, opts);
      return executePending(slug, opts.pending, actor, opts);
    }
    if (isNegative(lower)) return say("Okay, no problem.", "cancelled");
    // Anything else → treat as a fresh turn (the pending action is dropped).
  }

  // 2. Spoken brief — "how are we doing?", "good morning", "give me the rundown".
  if (isBriefIntent(lower)) return speakBrief(slug, opts);

  // 3. Read the recommendations aloud (numbered, so they can be approved by ordinal).
  if (isReadRecommendations(lower)) return speakRecommendations(slug, opts);

  // 4. Action commands (propose → confirm; never execute outright).
  if (isPurchasingCommand(lower)) return proposePurchasing(slug, opts);
  const recRef = matchRecommendationCommand(lower);
  if (recRef !== null) return proposeRecommendation(slug, recRef, opts);

  // 5. Default: a question, answered by the grounded Assistant, optimized for speech.
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
// Voice-first greeting (spoken on app open) — read-only, no generation
// ---------------------------------------------------------------------------

export interface VoiceGreetingOptions {
  userName?: string;
  db?: FirebaseFirestore.Firestore;
  now?: () => Date;
}

/**
 * Build the greeting the owner hears on opening the app. Reuses the cached Daily Brief
 * and the Recommendation Engine — no new analytics, no writes. If pending recommendations
 * exist, it offers to read them (a `read_recommendations` confirmation).
 */
export async function buildVoiceGreeting(slug: string, opts: VoiceGreetingOptions = {}): Promise<VoiceGreeting> {
  const nowDate = (opts.now ?? (() => new Date()))();
  const brief = await getBrief(slug, { db: opts.db, now: opts.now });
  const recs = await listRecommendations(slug, { db: opts.db, now: opts.now });
  const awaiting = recs.filter((r) => r.status === "new").length;

  const hour = lagosHour(nowDate);
  const tod = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  const name = opts.userName?.trim();
  const hello = `Good ${tod}${name ? `, ${name}` : ""}.`;

  const parts: string[] = [hello];
  if (brief) parts.push(brief.summary);
  else parts.push("I'll have your full brief ready shortly.");

  let pending: VoicePendingAction | null = null;
  if (awaiting > 0) {
    parts.push(`You have ${awaiting} recommendation${awaiting === 1 ? "" : "s"} awaiting your approval. Would you like me to read ${awaiting === 1 ? "it" : "them"}?`);
    pending = { type: "read_recommendations", label: `read your ${awaiting} recommendation${awaiting === 1 ? "" : "s"}` };
  }

  const display = parts.join(" ");
  return { greeting: hello, speech: toSpeech(display), display, pendingRecommendations: awaiting, hasBrief: !!brief, pending };
}

/** Active recommendations with the Operating Profile applied at this boundary. */
async function profiledRecommendations(slug: string, opts: VoiceTurnOptions): Promise<Recommendation[]> {
  const [recs, profile] = await Promise.all([
    listRecommendations(slug, { db: opts.db, now: opts.now }),
    getOperatingProfile(slug, { db: opts.db, now: opts.now }),
  ]);
  return applyProfileToRecommendations(recs, profile);
}

/** Read the active recommendations aloud, numbered so they can be approved by ordinal. */
async function speakRecommendations(slug: string, opts: VoiceTurnOptions): Promise<VoiceTurnResult> {
  const recs = await profiledRecommendations(slug, opts);
  if (recs.length === 0) return say("You have no recommendations right now.", "question");
  const lines = recs.slice(0, 5).map((r, i) => `${capitalize(ordinalWord(i + 1))}: ${r.title}. ${r.expectedImpact}`);
  const display = `Here ${recs.length === 1 ? "is your recommendation" : `are your ${Math.min(recs.length, 5)} recommendations`}. ${lines.join(" ")} Say "approve recommendation one" to act on ${recs.length === 1 ? "it" : "any of them"}.`;
  return { intent: "question", speech: toSpeech(display), display, pending: null, executed: false, degraded: false };
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

/** Answer why / explain / what-if-ignored about the pending recommendation, from its fields. */
async function explainPendingRecommendation(
  slug: string,
  pending: VoicePendingAction,
  part: "why" | "ifIgnored" | "full",
  opts: VoiceTurnOptions
): Promise<VoiceTurnResult> {
  const recs = await listRecommendations(slug, { db: opts.db, now: opts.now, includeDismissed: true });
  const rec = recs.find((r) => r.id === pending.recId);
  if (!rec) return { ...say("I can't find that recommendation to explain.", "confirm"), pending };
  const exp = explainRecommendation(rec);
  const body = explanationToSpeech(exp, part);
  const speech = `${body} Would you like me to go ahead?`;
  // Keep the pending confirmation so the owner can still approve after hearing it.
  return { intent: "confirm", speech: toSpeech(speech), display: `${body}`, pending, executed: false, degraded: false };
}

async function proposeRecommendation(slug: string, ref: RecRef, opts: VoiceTurnOptions): Promise<VoiceTurnResult> {
  const recs = await profiledRecommendations(slug, opts);
  const match = ref.kind === "ordinal" ? recs[ref.index] : ref.text ? recs.find((r) => matchesTarget(r, ref.text)) : recs[0];
  if (!match) {
    const speech =
      ref.kind === "ordinal"
        ? `I only have ${recs.length} recommendation${recs.length === 1 ? "" : "s"} right now.`
        : ref.text
        ? `I don't have a recommendation matching "${ref.text}" right now.`
        : "I don't have any recommendations to act on right now.";
    return say(speech, "command");
  }
  const pending: VoicePendingAction = { type: "execute_recommendation", recId: match.id, label: match.title };
  const impact = match.expectedImpact ? ` Expected impact: ${match.expectedImpact}.` : "";
  const lead = ref.kind === "ordinal" ? `Recommendation ${ordinalWord(ref.index + 1)} proposes: ${match.title}.` : `I found a recommendation: ${match.title}.`;
  const speech = `${lead}${impact} Do you approve?`;
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
/** Detect an explainability follow-up about a pending recommendation. */
function explainIntent(t: string): "why" | "ifIgnored" | "full" | null {
  if (/(if i ignore|what if i ignore|what happens if|if i (don'?t|do not|skip)|ignore it|the (risk|consequence|downside))/.test(t)) return "ifIgnored";
  if (/^\s*(why\b|why\?|how come|for what reason)/.test(t) || /\bwhy\b/.test(t)) return "why";
  if (/^(explain|tell me more|elaborate|more detail|what do you mean|break it down)/.test(t)) return "full";
  return null;
}
function isReadRecommendations(t: string): boolean {
  return /(read|list|tell me|what are|go through)\s+(me\s+)?(the\s+|my\s+|all\s+(the\s+)?)?recommendations|read them( to me)?|what'?s recommended/.test(t);
}
function isPurchasingCommand(t: string): boolean {
  return /(approve|execute|run|confirm|do|start).{0,20}(purchasing|purchase|buying|restock|reorder|order).{0,10}(plan|list|order|s)?/.test(t) || /(draft|create).{0,15}(restock|purchase|order)/.test(t);
}

/** A reference to a recommendation — by ordinal ("recommendation one") or by target ("jollof rice"). */
type RecRef = { kind: "ordinal"; index: number } | { kind: "target"; text: string };

const ORDINALS: Record<string, number> = {
  one: 0, first: 0, "1": 0, two: 1, second: 1, "2": 1, three: 2, third: 2, "3": 2,
  four: 3, fourth: 3, "4": 3, five: 4, fifth: 4, "5": 4,
};

function parseOrdinal(t: string): number | null {
  const m = t.match(/recommendation\s+(?:number\s+)?(one|two|three|four|five|first|second|third|fourth|fifth|[1-5])/);
  return m ? ORDINALS[m[1]] ?? null : null;
}

/** Classify a recommendation action command → a structured ref, or null if not one. */
function matchRecommendationCommand(t: string): RecRef | null {
  // "increase/raise <item> by ₦200" → target.
  const priceMatch = t.match(/(?:increase|raise|bump|change|adjust).*?(?:price of |for )?(.+?)\s+by\s+(?:₦|naira|n)?\s?\d/);
  if (priceMatch) return { kind: "target", text: priceMatch[1].trim() };
  // "approve/execute/apply/accept ... recommendation [one | for <item>]"
  if (/(approve|execute|apply|run|do|accept).*recommendation/.test(t)) {
    const ord = parseOrdinal(t);
    if (ord != null) return { kind: "ordinal", index: ord };
    const forMatch = t.match(/recommendation\s+(?:for|on|about)\s+(.+)/);
    if (forMatch) return { kind: "target", text: forMatch[1].trim() };
    return { kind: "ordinal", index: 0 }; // "approve the recommendation" → the first one
  }
  return null;
}

function ordinalWord(n: number): string {
  return ["one", "two", "three", "four", "five"][n - 1] ?? String(n);
}
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
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
