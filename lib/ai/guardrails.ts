import "server-only";
import { getAdminDb } from "../firebase-admin";
import type { TenantScope } from "./types";

/**
 * AI Guardrails
 * =============
 * The single trust boundary between Firestore and any AI capability. Every tool
 * and the context builder go through these primitives. Responsibilities:
 *
 *   1. Tenant isolation        — data can only ever be read for one restaurant.
 *   2. Read-only enforcement   — no write surface is exposed to the AI layer.
 *   3. PII redaction           — customer identifiers are masked before leaving.
 *   4. Prompt sanitisation     — untrusted text is neutralised before prompting.
 *   5. Cost limits             — per-request/per-tenant spend ceilings.
 *   6. Token budgeting         — hard cap on tokens sent to a provider.
 *   7. Audit logging           — every privileged read/redaction is recorded.
 *
 * Nothing here writes to Firestore. Cost/usage accounting is in-memory only,
 * which keeps the entire foundation strictly read-only (as the sprint requires).
 * A persistent `ai_usage` / `ai_audit` sink can be layered in later without
 * changing callers — see `AuditLogger.sink`.
 */

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class TenantIsolationError extends Error {
  constructor(expected: string, actual: string) {
    super(`Tenant isolation violation: expected "${expected}" but resource belongs to "${actual}"`);
    this.name = "TenantIsolationError";
  }
}

export class ReadOnlyViolationError extends Error {
  constructor(method: string) {
    super(`Read-only violation: write method "${method}" is not permitted in the AI layer`);
    this.name = "ReadOnlyViolationError";
  }
}

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

// ---------------------------------------------------------------------------
// Tenant isolation
// ---------------------------------------------------------------------------

/** Collections that are tenant-scoped via a `restaurantId` field equal to the slug. */
const TENANT_ID_FIELD = "restaurantId";

/**
 * Throws if a record does not belong to the given tenant. Call this on every
 * document a tool reads, so a mis-scoped query can never leak cross-tenant data.
 */
export function assertTenant(scope: TenantScope, record: Record<string, unknown> | undefined | null): void {
  if (!record) return;
  const owner = (record[TENANT_ID_FIELD] as string | undefined) ?? (record.restaurantSlug as string | undefined);
  if (owner != null && owner !== scope.restaurantSlug) {
    throw new TenantIsolationError(scope.restaurantSlug, owner);
  }
}

/**
 * A read-only wrapper around a Firestore Query. Deliberately exposes only
 * read/composition methods — there is no `set`, `update`, `delete`, or `add`
 * surface, making read-only enforcement structural rather than convention.
 */
export class ReadOnlyQuery {
  constructor(private readonly q: FirebaseFirestore.Query) {}

  where(field: string, op: FirebaseFirestore.WhereFilterOp, value: unknown): ReadOnlyQuery {
    return new ReadOnlyQuery(this.q.where(field, op, value));
  }

  orderBy(field: string, dir: "asc" | "desc" = "asc"): ReadOnlyQuery {
    return new ReadOnlyQuery(this.q.orderBy(field, dir));
  }

  limit(n: number): ReadOnlyQuery {
    return new ReadOnlyQuery(this.q.limit(n));
  }

  get(): Promise<FirebaseFirestore.QuerySnapshot> {
    return this.q.get();
  }
}

/**
 * Tenant-scoped, read-only accessor to Firestore. This is the ONLY database
 * handle the tool layer is given. It cannot write, and every scoped query is
 * pre-filtered to the caller's restaurant.
 */
export class TenantReader {
  readonly slug: string;
  private readonly db: FirebaseFirestore.Firestore;

  constructor(
    private readonly scope: TenantScope,
    private readonly audit: AuditLogger,
    /** Injectable Firestore handle — defaults to the Admin SDK. Tests pass a fake. */
    db?: FirebaseFirestore.Firestore
  ) {
    this.slug = scope.restaurantSlug;
    this.db = db ?? getAdminDb();
  }

  /** A read-only query over a top-level collection, pre-filtered by `restaurantId`. */
  scoped(collection: string): ReadOnlyQuery {
    return this.scopedBy(collection, TENANT_ID_FIELD);
  }

  /**
   * A read-only query over a top-level collection, pre-filtered by an explicit
   * tenancy field. Most collections use `restaurantId`; `users` uses
   * `restaurantSlug`. Both equal this tenant's slug.
   */
  scopedBy(collection: string, field: string): ReadOnlyQuery {
    this.audit.record("read.scoped", { collection, field });
    return new ReadOnlyQuery(this.db.collection(collection).where(field, "==", this.slug));
  }

  /** The tenant's own `restaurants/{slug}` document data, or null. */
  async restaurant(): Promise<Record<string, unknown> | null> {
    this.audit.record("read.restaurant", { slug: this.slug });
    const snap = await this.db.collection("restaurants").doc(this.slug).get();
    return snap.exists ? (snap.data() as Record<string, unknown>) : null;
  }

  /** A read-only query over a subcollection under this tenant's restaurant doc. */
  subcollection(name: string): ReadOnlyQuery {
    this.audit.record("read.subcollection", { name });
    return new ReadOnlyQuery(this.db.collection("restaurants").doc(this.slug).collection(name));
  }

  /** Verify a record belongs to this tenant (defence in depth). */
  assertOwned(record: Record<string, unknown> | undefined | null): void {
    assertTenant(this.scope, record);
  }
}

export function createTenantReader(
  scope: TenantScope,
  audit: AuditLogger,
  db?: FirebaseFirestore.Firestore
): TenantReader {
  return new TenantReader(scope, audit, db);
}

// ---------------------------------------------------------------------------
// PII redaction
// ---------------------------------------------------------------------------

/** Mask a phone number to its last 4 digits: "+2348012345678" -> "*****5678". */
export function maskPhone(phone: string | undefined | null): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (!digits) return "unknown";
  return `*****${digits.slice(-4)}`;
}

/** Mask an email: "jane.doe@example.com" -> "j***@example.com". */
export function maskEmail(email: string | undefined | null): string {
  const value = (email ?? "").trim();
  const at = value.indexOf("@");
  if (at <= 0) return value ? "***" : "unknown";
  return `${value[0]}***${value.slice(at)}`;
}

/** Reduce a personal name to initials: "Jane Mary Doe" -> "J.M.D." */
export function maskName(name: string | undefined | null): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Guest";
  return parts.map((p) => `${p[0].toUpperCase()}.`).join("");
}

/**
 * Stable, non-reversible reference for a customer, derived from their phone.
 * Lets us count/rank customers without exposing the phone number itself.
 */
export function customerRef(phone: string | undefined | null, name?: string | null): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits) return `cust_${maskPhone(digits)}`;
  return `cust_${maskName(name)}`;
}

const PII_KEYS = new Set([
  "phone",
  "customerPhone",
  "notificationPhone",
  "whatsappNumber",
  "email",
  "address",
  "customerAddress",
  "resetLink",
  "pendingResetLink",
]);

/**
 * Deep-redacts PII keys from an arbitrary object graph. Phones are masked,
 * emails masked, addresses/links dropped. Used as a final safety pass over the
 * assembled context before it can be handed to an LLM.
 */
export function redactPII<T>(value: T): T {
  return _redact(value) as T;
}

function _redact(value: unknown): unknown {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(_redact);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (!PII_KEYS.has(k)) {
        out[k] = _redact(v);
        continue;
      }
      if (typeof v !== "string") {
        // structured value under a PII key — drop it entirely
        continue;
      }
      const key = k.toLowerCase();
      if (key.includes("email")) out[k] = maskEmail(v);
      else if (key.includes("phone") || key.includes("number")) out[k] = maskPhone(v);
      else continue; // address / links dropped
    }
    return out;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Prompt sanitisation
// ---------------------------------------------------------------------------

const INJECTION_PATTERNS: RegExp[] = [
  /ignore (all |the |your )?(previous|prior|above) (instructions|prompt)/gi,
  /disregard (all |the |your )?(previous|prior|above)/gi,
  /you are now (a|an|the)/gi,
  /system prompt/gi,
  /\bBEGIN\s+SYSTEM\b/gi,
  /<\/?(system|assistant|user)>/gi,
  /```\s*system/gi,
];

// Control characters to strip: everything below space (\x00-\x1F) except tab
// (\x09) and newline (\x0A), plus DEL (\x7F). Uses \x escapes so no raw control
// bytes are ever embedded in this source file.
const CONTROL_CHARS = /[\x00-\x08\x0B-\x1F\x7F]/g;

/**
 * Neutralises untrusted free-text (menu descriptions, order notes, customer
 * names) before it is embedded in a prompt. Strips control characters, defuses
 * common prompt-injection phrases, collapses whitespace, and truncates.
 */
export function sanitizePrompt(input: string | undefined | null, maxChars = 4000): string {
  let text = (input ?? "").toString();
  text = text.replace(CONTROL_CHARS, " ");
  for (const re of INJECTION_PATTERNS) text = text.replace(re, "[filtered]");
  text = text.replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
  if (text.length > maxChars) text = `${text.slice(0, maxChars)}…[truncated]`;
  return text;
}

// ---------------------------------------------------------------------------
// Token budgeting & cost limits
// ---------------------------------------------------------------------------

/** Rough token estimate (~4 chars/token). Provider-agnostic, good enough for budgeting. */
export function estimateTokens(text: string): number {
  return Math.ceil((text?.length ?? 0) / 4);
}

export interface BudgetConfig {
  /** Hard cap on tokens (input + output) for a single request. */
  maxTokensPerRequest: number;
  /** Hard cap on estimated spend (USD) for a single request. */
  maxCostPerRequestUsd: number;
}

export const DEFAULT_BUDGET: BudgetConfig = {
  maxTokensPerRequest: 60_000,
  maxCostPerRequestUsd: 0.25,
};

/**
 * In-memory budget for one request. Reserve tokens before a provider call and
 * consume the actual usage after; throws BudgetExceededError past the ceiling.
 */
export class TokenBudget {
  private tokensUsed = 0;
  private costUsd = 0;

  constructor(private readonly config: BudgetConfig = DEFAULT_BUDGET) {}

  /** Check a prospective request fits before spending. Throws if it would not. */
  reserve(estTokens: number, estCostUsd: number): void {
    if (this.tokensUsed + estTokens > this.config.maxTokensPerRequest) {
      throw new BudgetExceededError(
        `Token budget exceeded: ${this.tokensUsed + estTokens} > ${this.config.maxTokensPerRequest}`
      );
    }
    if (this.costUsd + estCostUsd > this.config.maxCostPerRequestUsd) {
      throw new BudgetExceededError(
        `Cost budget exceeded: $${(this.costUsd + estCostUsd).toFixed(4)} > $${this.config.maxCostPerRequestUsd}`
      );
    }
  }

  /** Record actual usage after a provider call. */
  consume(tokens: number, costUsd: number): void {
    this.tokensUsed += tokens;
    this.costUsd += costUsd;
  }

  get usage(): { tokens: number; costUsd: number; remainingTokens: number } {
    return {
      tokens: this.tokensUsed,
      costUsd: this.costUsd,
      remainingTokens: Math.max(0, this.config.maxTokensPerRequest - this.tokensUsed),
    };
  }
}

// ---------------------------------------------------------------------------
// Audit logging
// ---------------------------------------------------------------------------

export interface AuditEvent {
  requestId: string;
  restaurantSlug: string;
  event: string;
  at: string; // ISO
  details?: Record<string, unknown>;
}

export type AuditSink = (event: AuditEvent) => void;

/** Default sink — structured stdout line. Swappable for a Firestore/analytics sink later. */
export const consoleAuditSink: AuditSink = (event) => {
  console.log(`[ai-audit] ${JSON.stringify(event)}`);
};

/**
 * Records privileged reads, redactions, and provider calls for one request.
 * Sink is injectable so tests can assert on emitted events and production can
 * later route to a durable store without touching callers.
 */
export class AuditLogger {
  private readonly events: AuditEvent[] = [];

  constructor(private readonly scope: TenantScope, private readonly sink: AuditSink = consoleAuditSink) {}

  record(event: string, details?: Record<string, unknown>): void {
    const entry: AuditEvent = {
      requestId: this.scope.requestId,
      restaurantSlug: this.scope.restaurantSlug,
      event,
      at: new Date().toISOString(),
      details,
    };
    this.events.push(entry);
    try {
      this.sink(entry);
    } catch {
      /* never let audit logging break a read */
    }
  }

  /** All events recorded this request (useful for tests / debugging). */
  drain(): AuditEvent[] {
    return [...this.events];
  }
}

/** Configuration keys that must never be surfaced to the AI layer. */
export const SENSITIVE_SETTING_KEYS = new Set([
  "whatsappAdminPin",
  "paystackSubaccountCode",
  "paymentAccountName",
  "paymentBankCode",
  "telegramChatId",
  "telegramBotToken",
  "ownerUid",
  "accessToken",
  "refreshToken",
  "resetLink",
  "pendingResetLink",
  "pinHash",
]);
