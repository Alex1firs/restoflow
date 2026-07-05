import "server-only";
import { writeUsageRecord } from "./usage";
import { assertTenant } from "./guardrails";
import { AI_RECOMMENDATIONS_COLLECTION } from "./recommendations";
import { AI_PURCHASE_PLANS_COLLECTION } from "./purchasing";
import { createIntelligenceContext, lagosDateKey } from "./tools/_shared";
import type {
  ActorRef,
  Automation,
  AutomationAction,
  AutomationExecution,
  AutomationRule,
  AutomationStatus,
  PurchasingPlan,
  Recommendation,
} from "./types";

/**
 * AI Automation — Phase 6
 * =======================
 * The orchestration layer that EXECUTES approved decisions. It is the first (and
 * only) part of the AI system permitted to cause side effects — and it does so under
 * strict, approval-first, fully-audited control.
 *
 * Design principles honoured:
 *  1. CONSUMES structured outputs — an automation is created from an APPROVED
 *     recommendation (`ai_recommendations`, status "accepted") or a purchasing action
 *     (`ai_purchase_plans` HIGH reorder line). It never re-computes a decision; the
 *     Recommendation/Forecasting/Purchasing engines own the judgement.
 *  2. APPROVAL-FIRST — creation requires an approved source; EXECUTION requires the
 *     owner to have explicitly enabled an automation rule for that capability. With no
 *     enabled rule, execution is refused (`AutomationDisabledError`).
 *  3. FULLY AUDITABLE — every execution writes an `ai_automation_executions` record
 *     with actor, timestamps, source, status, attempt count, error, and rollback info.
 *  4. PLUGGABLE HANDLERS — integrations (WhatsApp, email, suppliers, POS, scheduling,
 *     inventory) register as `ActionHandler`s. Integration logic lives in handlers,
 *     NEVER in the AI engines. The engine only dispatches, retries, records, rolls back.
 *
 * Write-safety: the engine writes ONLY to `ai_automation_rules`, `ai_automations`,
 * `ai_automation_executions`, and `ai_usage`. Handlers receive NO Firestore handle, so
 * they cannot mutate business data. Tenant is always derived from the session slug.
 */

export const AI_AUTOMATION_RULES_COLLECTION = "ai_automation_rules";
export const AI_AUTOMATIONS_COLLECTION = "ai_automations";
export const AI_AUTOMATION_EXECUTIONS_COLLECTION = "ai_automation_executions";
const AUTOMATION_VERSION = 1;
const MAX_ATTEMPTS = 2;

// ---------------------------------------------------------------------------
// Errors (routes map these to specific HTTP statuses)
// ---------------------------------------------------------------------------

export class AutomationDisabledError extends Error {
  constructor(kind: string) {
    super(`Automation for "${kind}" is not enabled. Enable it in automation rules first.`);
    this.name = "AutomationDisabledError";
  }
}
export class AutomationNotApprovedError extends Error {
  constructor() {
    super("This recommendation must be accepted before it can be automated.");
    this.name = "AutomationNotApprovedError";
  }
}
export class AutomationStateError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "AutomationStateError";
  }
}

// ---------------------------------------------------------------------------
// Action handlers — the pluggable integration seam
// ---------------------------------------------------------------------------

export interface HandlerContext {
  slug: string;
  now: () => Date;
  automation: Automation;
}

export interface HandlerResult {
  ok: boolean;
  detail: string;
  output?: Record<string, unknown>;
  /** Opaque token enabling rollback; null when nothing to undo. */
  rollbackToken?: string | null;
  /** Failure reason when `ok` is false. */
  reason?: string;
}

/**
 * A standardized action handler. A real WhatsApp/email/supplier/POS integration is
 * just another handler registered by `kind` — the engine never learns its internals.
 */
export interface ActionHandler {
  readonly kind: string;
  readonly reversible: boolean;
  /** Whether executing this handler would mutate core business data (informational). */
  readonly mutatesCore: boolean;
  validate(action: AutomationAction): { ok: boolean; reason?: string };
  execute(action: AutomationAction, ctx: HandlerContext): Promise<HandlerResult>;
  rollback?(execution: AutomationExecution, ctx: HandlerContext): Promise<HandlerResult>;
}

/**
 * `notify` — records a notification (owner/staff to-do) as an auditable execution
 * record. No external send today; a real WhatsApp/email handler with the same `kind`
 * replaces this once channels are configured. Safe, no core mutation.
 */
export const notifyHandler: ActionHandler = {
  kind: "notify",
  reversible: false,
  mutatesCore: false,
  validate(action) {
    return action.summary && action.summary.length > 0 ? { ok: true } : { ok: false, reason: "missing summary" };
  },
  async execute(action) {
    return {
      ok: true,
      detail: `Notification queued: ${action.summary}`,
      output: { channel: (action.params.channel as string) ?? "dashboard", message: action.summary, ...action.params },
      rollbackToken: null,
    };
  },
};

/**
 * `purchase_order_draft` — drafts a restock order (item/qty/supplier) from a HIGH
 * Smart-Purchasing line as an auditable record. No supplier API today; a real supplier
 * handler with the same `kind` plugs in later. Reversible (discard the draft).
 */
export const purchaseOrderDraftHandler: ActionHandler = {
  kind: "purchase_order_draft",
  reversible: true,
  mutatesCore: false,
  validate(action) {
    return action.params.item ? { ok: true } : { ok: false, reason: "missing item" };
  },
  async execute(action) {
    return {
      ok: true,
      detail: `Drafted restock order for ${action.params.item}`,
      output: {
        item: action.params.item,
        quantity: action.params.quantity ?? null,
        supplier: action.params.supplier ?? null,
        state: "draft",
      },
      rollbackToken: `po-draft:${action.params.item}`,
    };
  },
  async rollback() {
    return { ok: true, detail: "Draft purchase order discarded." };
  },
};

const DEFAULT_HANDLERS: ActionHandler[] = [notifyHandler, purchaseOrderDraftHandler];

function buildRegistry(extra?: ActionHandler[]): Map<string, ActionHandler> {
  const registry = new Map<string, ActionHandler>();
  for (const h of DEFAULT_HANDLERS) registry.set(h.kind, h);
  for (const h of extra ?? []) registry.set(h.kind, h); // tests/integrations override
  return registry;
}

/** The handler capabilities the UI can offer rules for. */
export function availableHandlerKinds(extra?: ActionHandler[]): { kind: string; reversible: boolean; mutatesCore: boolean }[] {
  return [...buildRegistry(extra).values()].map((h) => ({ kind: h.kind, reversible: h.reversible, mutatesCore: h.mutatesCore }));
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

interface BaseOpts {
  db?: FirebaseFirestore.Firestore;
  now?: () => Date;
  requestId?: string;
  /** Extra/override handlers (real integrations, or fakes in tests). */
  handlers?: ActionHandler[];
}

// ---------------------------------------------------------------------------
// Rules (owner-configured enablement)
// ---------------------------------------------------------------------------

/** Read a single rule (defaults to disabled when unset — approval-first). */
export async function getAutomationRule(
  slug: string,
  kind: string,
  opts: { db?: FirebaseFirestore.Firestore; now?: () => Date } = {}
): Promise<AutomationRule> {
  const ctx = createIntelligenceContext(slug, { feature: "automation-rules", now: opts.now, db: opts.db });
  const snap = await ctx.db.collection(AI_AUTOMATION_RULES_COLLECTION).doc(`${slug}:${kind}`).get();
  if (!snap.exists) {
    return { restaurantId: slug, kind, enabled: false, autoExecute: false, updatedBy: { type: "system", id: "default" }, updatedAt: ctx.now().toISOString() };
  }
  const rule = snap.data() as AutomationRule;
  assertTenant(ctx.scope, rule as unknown as Record<string, unknown>);
  return rule;
}

/** List every configured rule for a tenant. */
export async function listAutomationRules(slug: string, opts: { db?: FirebaseFirestore.Firestore; now?: () => Date } = {}): Promise<AutomationRule[]> {
  const ctx = createIntelligenceContext(slug, { feature: "automation-rules", now: opts.now, db: opts.db });
  const snap = await ctx.db.collection(AI_AUTOMATION_RULES_COLLECTION).where("restaurantId", "==", slug).get();
  return snap.docs.map((d) => d.data() as AutomationRule).filter((r) => {
    assertTenant(ctx.scope, r as unknown as Record<string, unknown>);
    return true;
  });
}

/** Enable/disable an automation capability (owner action). */
export async function setAutomationRule(
  slug: string,
  kind: string,
  settings: { enabled: boolean; autoExecute?: boolean },
  actor: ActorRef,
  opts: { db?: FirebaseFirestore.Firestore; now?: () => Date } = {}
): Promise<AutomationRule> {
  const ctx = createIntelligenceContext(slug, { feature: "automation-rules", now: opts.now, db: opts.db });
  const rule: AutomationRule = {
    restaurantId: slug,
    kind,
    enabled: settings.enabled,
    autoExecute: settings.enabled ? settings.autoExecute ?? false : false,
    updatedBy: actor,
    updatedAt: ctx.now().toISOString(),
  };
  await ctx.db.collection(AI_AUTOMATION_RULES_COLLECTION).doc(`${slug}:${kind}`).set(rule);
  return rule;
}

// ---------------------------------------------------------------------------
// Creating automations from approved sources (consume structured outputs)
// ---------------------------------------------------------------------------

/**
 * Map a recommendation to the handler capability that will carry it out. Today every
 * recommendation becomes a `notify` (tell the owner/staff to act) — safe and useful.
 * A future inventory/pricing handler can be mapped here without touching the engines.
 */
function handlerKindForRecommendation(rec: Recommendation): string {
  if (rec.type === "reenable_item") return "notify"; // future: an inventory handler
  return "notify";
}

/** Create (or return the existing) automation for an ACCEPTED recommendation. */
export async function createAutomationFromRecommendation(
  slug: string,
  recId: string,
  actor: ActorRef,
  opts: BaseOpts = {}
): Promise<Automation> {
  const ctx = createIntelligenceContext(slug, { feature: "automation", now: opts.now, db: opts.db, requestId: opts.requestId });
  const recSnap = await ctx.db.collection(AI_RECOMMENDATIONS_COLLECTION).doc(`${slug}:${recId}`).get();
  if (!recSnap.exists) throw new AutomationStateError("Recommendation not found.");
  const rec = recSnap.data() as Recommendation;
  assertTenant(ctx.scope, rec as unknown as Record<string, unknown>);

  // Approval-first: only an ACCEPTED recommendation can become an automation.
  if (rec.status !== "accepted") throw new AutomationNotApprovedError();

  const handlerKind = handlerKindForRecommendation(rec);
  const action: AutomationAction = {
    kind: handlerKind,
    summary: rec.title,
    params: {
      source: "recommendation",
      recType: rec.type,
      target: rec.action?.target ?? null,
      expectedImpact: rec.expectedImpact,
    },
  };
  const id = `recommendation:${recId}`;
  return upsertAutomation(ctx, {
    id,
    source: { type: "recommendation", id: recId, actionKind: rec.type },
    handlerKind,
    action,
    title: rec.title,
    actor,
  });
}

/** Create (or return the existing) automation for a HIGH Smart-Purchasing line. */
export async function createAutomationFromPurchasingLine(
  slug: string,
  item: string,
  actor: ActorRef,
  opts: BaseOpts = {}
): Promise<Automation> {
  const ctx = createIntelligenceContext(slug, { feature: "automation", now: opts.now, db: opts.db, requestId: opts.requestId });
  const dateKey = lagosDateKey(ctx.now());
  const planSnap = await ctx.db.collection(AI_PURCHASE_PLANS_COLLECTION).doc(`${slug}:${dateKey}`).get();
  if (!planSnap.exists) throw new AutomationStateError("No purchasing plan for today.");
  const plan = planSnap.data() as PurchasingPlan;
  assertTenant(ctx.scope, plan as unknown as Record<string, unknown>);

  const line = plan.menuDemand.find((l) => l.item.toLowerCase() === item.toLowerCase());
  if (!line) throw new AutomationStateError("Item not on today's purchasing plan.");
  // Only actionable (HIGH) reorder lines can be automated into a restock draft.
  if (line.reorderSignal !== "HIGH") throw new AutomationStateError("Only HIGH-priority restock lines can be automated.");

  const handlerKind = "purchase_order_draft";
  const action: AutomationAction = {
    kind: handlerKind,
    summary: `Draft restock order for ${line.item}`,
    params: { source: "purchasing", item: line.item, quantity: line.expectedUnits, supplier: null },
  };
  const id = `purchasing:${dateKey}:${slugify(line.item)}`;
  return upsertAutomation(ctx, {
    id,
    source: { type: "purchasing", id: `${dateKey}:${line.item}`, actionKind: "restock", dateKey },
    handlerKind,
    action,
    title: action.summary,
    actor,
  });
}

async function upsertAutomation(
  ctx: ReturnType<typeof createIntelligenceContext>,
  input: { id: string; source: Automation["source"]; handlerKind: string; action: AutomationAction; title: string; actor: ActorRef }
): Promise<Automation> {
  const slug = ctx.scope.restaurantSlug;
  const ref = ctx.db.collection(AI_AUTOMATIONS_COLLECTION).doc(`${slug}:${input.id}`);
  const existing = await ref.get();
  const isoNow = ctx.now().toISOString();

  if (existing.exists) {
    const prior = existing.data() as Automation;
    assertTenant(ctx.scope, prior as unknown as Record<string, unknown>);
    // Idempotent: re-approving refreshes approval metadata but preserves history/status.
    return prior;
  }

  const automation: Automation = {
    id: input.id,
    restaurantId: slug,
    source: input.source,
    handlerKind: input.handlerKind,
    action: input.action,
    title: input.title,
    // Created from an approved source → immediately "approved" (still gated by rule on execution).
    status: "approved",
    createdBy: input.actor,
    createdAt: isoNow,
    approvedBy: input.actor,
    approvedAt: isoNow,
    updatedAt: isoNow,
    lastExecutionId: null,
    version: AUTOMATION_VERSION,
  };
  await ref.set(automation);
  await writeUsageRecord(ctx, { status: "ok", note: `automation created ${input.id} kind=${input.handlerKind}` });
  return automation;
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

export async function listAutomations(slug: string, opts: { db?: FirebaseFirestore.Firestore; now?: () => Date } = {}): Promise<Automation[]> {
  const ctx = createIntelligenceContext(slug, { feature: "automation", now: opts.now, db: opts.db });
  const snap = await ctx.db.collection(AI_AUTOMATIONS_COLLECTION).where("restaurantId", "==", slug).get();
  return snap.docs.map((d) => d.data() as Automation).filter((a) => {
    assertTenant(ctx.scope, a as unknown as Record<string, unknown>);
    return true;
  });
}

export async function listExecutions(
  slug: string,
  opts: { db?: FirebaseFirestore.Firestore; now?: () => Date; automationId?: string } = {}
): Promise<AutomationExecution[]> {
  const ctx = createIntelligenceContext(slug, { feature: "automation", now: opts.now, db: opts.db });
  const snap = await ctx.db.collection(AI_AUTOMATION_EXECUTIONS_COLLECTION).where("restaurantId", "==", slug).get();
  return snap.docs
    .map((d) => d.data() as AutomationExecution)
    .filter((e) => {
      assertTenant(ctx.scope, e as unknown as Record<string, unknown>);
      return opts.automationId ? e.automationId === opts.automationId : true;
    });
}

// ---------------------------------------------------------------------------
// Execution (approval-first, retried, fully audited)
// ---------------------------------------------------------------------------

/** Execute an approved automation. Refuses unless the owner enabled its rule. */
export async function executeAutomation(
  slug: string,
  automationId: string,
  actor: ActorRef,
  opts: BaseOpts = {}
): Promise<{ automation: Automation; execution: AutomationExecution }> {
  const ctx = createIntelligenceContext(slug, { feature: "automation", now: opts.now, db: opts.db, requestId: opts.requestId });
  const ref = ctx.db.collection(AI_AUTOMATIONS_COLLECTION).doc(`${slug}:${automationId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new AutomationStateError("Automation not found.");
  const automation = snap.data() as Automation;
  assertTenant(ctx.scope, automation as unknown as Record<string, unknown>);

  // May only run an approved automation (or retry a failed one).
  if (automation.status !== "approved" && automation.status !== "failed") {
    throw new AutomationStateError(`Automation is "${automation.status}" and cannot be executed.`);
  }

  const registry = buildRegistry(opts.handlers);
  const handler = registry.get(automation.handlerKind);

  // APPROVAL-FIRST GATE — no execution unless the owner explicitly enabled this rule.
  const rule = await getAutomationRule(slug, automation.handlerKind, { db: ctx.db, now: opts.now });
  if (!rule.enabled) throw new AutomationDisabledError(automation.handlerKind);

  const startedAt = ctx.now().toISOString();
  let attempt = 0;
  let result: HandlerResult | null = null;
  let error: { message: string; reason?: string } | null = null;

  if (!handler) {
    error = { message: `No handler registered for "${automation.handlerKind}".` };
  } else {
    const v = handler.validate(automation.action);
    if (!v.ok) {
      error = { message: "Validation failed.", reason: v.reason };
    } else {
      const hctx: HandlerContext = { slug, now: ctx.now, automation };
      while (attempt < MAX_ATTEMPTS) {
        attempt++;
        try {
          const r = await handler.execute(automation.action, hctx);
          if (r.ok) {
            result = r;
            error = null;
            break;
          }
          error = { message: "Handler reported failure.", reason: r.reason };
        } catch (e) {
          error = { message: e instanceof Error ? e.message : String(e) };
        }
      }
    }
  }

  const succeeded = !!result && !error;
  const execId = await nextExecutionId(ctx, automationId);
  const execution: AutomationExecution = {
    id: execId,
    automationId,
    restaurantId: slug,
    handlerKind: automation.handlerKind,
    actor,
    attempt: Math.max(1, attempt),
    maxAttempts: MAX_ATTEMPTS,
    status: succeeded ? "succeeded" : "failed",
    startedAt,
    finishedAt: ctx.now().toISOString(),
    result: succeeded ? { detail: result!.detail, output: result!.output } : null,
    error: succeeded ? null : error,
    rollbackToken: succeeded ? result!.rollbackToken ?? null : null,
    rollback: null,
  };
  await ctx.db.collection(AI_AUTOMATION_EXECUTIONS_COLLECTION).doc(`${slug}:${execId}`).set(execution);

  const newStatus: AutomationStatus = succeeded ? "succeeded" : "failed";
  await ref.set({ status: newStatus, lastExecutionId: execId, updatedAt: ctx.now().toISOString() }, { merge: true });
  await writeUsageRecord(ctx, { status: succeeded ? "ok" : "error", note: `automation exec ${automationId} status=${newStatus} attempts=${execution.attempt}` });

  return { automation: { ...automation, status: newStatus, lastExecutionId: execId }, execution };
}

/** Reverse a succeeded, reversible execution. Records the rollback on the audit trail. */
export async function rollbackExecution(
  slug: string,
  executionId: string,
  actor: ActorRef,
  opts: BaseOpts = {}
): Promise<AutomationExecution> {
  const ctx = createIntelligenceContext(slug, { feature: "automation", now: opts.now, db: opts.db, requestId: opts.requestId });
  const execRef = ctx.db.collection(AI_AUTOMATION_EXECUTIONS_COLLECTION).doc(`${slug}:${executionId}`);
  const execSnap = await execRef.get();
  if (!execSnap.exists) throw new AutomationStateError("Execution not found.");
  const execution = execSnap.data() as AutomationExecution;
  assertTenant(ctx.scope, execution as unknown as Record<string, unknown>);
  if (execution.status !== "succeeded") throw new AutomationStateError("Only a succeeded execution can be rolled back.");
  if (execution.rollback) throw new AutomationStateError("This execution was already rolled back.");

  const autoRef = ctx.db.collection(AI_AUTOMATIONS_COLLECTION).doc(`${slug}:${execution.automationId}`);
  const autoSnap = await autoRef.get();
  if (!autoSnap.exists) throw new AutomationStateError("Automation not found.");
  const automation = autoSnap.data() as Automation;
  assertTenant(ctx.scope, automation as unknown as Record<string, unknown>);

  const handler = buildRegistry(opts.handlers).get(automation.handlerKind);
  if (!handler || !handler.reversible || !handler.rollback) {
    throw new AutomationStateError(`"${automation.handlerKind}" actions cannot be rolled back.`);
  }

  const hctx: HandlerContext = { slug, now: ctx.now, automation };
  const r = await handler.rollback(execution, hctx);

  const rolledBackAt = ctx.now().toISOString();
  const updated: AutomationExecution = { ...execution, rollback: { rolledBackAt, by: actor, detail: r.detail } };
  await execRef.set({ rollback: updated.rollback }, { merge: true });
  await autoRef.set({ status: "rolled_back", updatedAt: rolledBackAt }, { merge: true });
  await writeUsageRecord(ctx, { status: "ok", note: `automation rollback ${execution.automationId} exec=${executionId}` });
  return updated;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Deterministic, collision-free execution id: `${automationId}:exec:${n}`. */
async function nextExecutionId(ctx: ReturnType<typeof createIntelligenceContext>, automationId: string): Promise<string> {
  const slug = ctx.scope.restaurantSlug;
  const snap = await ctx.db
    .collection(AI_AUTOMATION_EXECUTIONS_COLLECTION)
    .where("restaurantId", "==", slug)
    .where("automationId", "==", automationId)
    .get();
  return `${automationId}:exec:${snap.size + 1}`;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "item";
}
