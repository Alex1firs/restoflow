import "server-only";
import { getAdminDb } from "../../firebase-admin";
import {
  AuditLogger,
  TenantReader,
  TokenBudget,
  createTenantReader,
  type AuditSink,
} from "../guardrails";
import type {
  DateRange,
  NormalizedOrder,
  RangeInput,
  RangeLabel,
  TenantScope,
  ToolMeta,
  ToolResult,
} from "../types";

/**
 * Shared plumbing for the tool layer.
 *
 * - `IntelligenceContext` is the single per-request object every tool receives.
 *   It carries the tenant scope, a read-only tenant-scoped Firestore reader, an
 *   audit logger, a token budget, an injectable clock (for tests), and — key for
 *   performance — a set of *memoised* readers so N tools sharing a window issue
 *   ONE Firestore query, not N.
 *
 * - Each tool is independently testable: construct a context and call one tool.
 *   The context builder reuses the same context so nothing is re-fetched.
 */

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface IntelligenceContextOptions {
  requestId?: string;
  role?: TenantScope["role"];
  auditSink?: AuditSink;
  budget?: TokenBudget;
  /** Injectable clock — defaults to real time; override in tests for determinism. */
  now?: () => Date;
  /** Injectable Firestore handle — defaults to the Admin SDK. Tests pass a fake. */
  db?: FirebaseFirestore.Firestore;
  /** Which AI feature this context serves (recorded in ai_usage). */
  feature?: string;
}

export class IntelligenceContext {
  readonly scope: TenantScope;
  readonly reader: TenantReader;
  readonly audit: AuditLogger;
  readonly budget: TokenBudget;
  readonly now: () => Date;
  /** The resolved Firestore handle (injected or Admin SDK) — reused by the usage writer. */
  readonly db: FirebaseFirestore.Firestore;
  /** Feature label recorded on persisted usage records. */
  readonly feature: string;

  // Memoisation caches (per request).
  private orderCache = new Map<string, Promise<NormalizedOrder[]>>();
  private singletonCache = new Map<string, Promise<unknown>>();

  constructor(slug: string, opts: IntelligenceContextOptions = {}) {
    this.scope = {
      restaurantSlug: slug,
      requestId: opts.requestId ?? `ai_${slug}_${Date.now()}`,
      role: opts.role,
    };
    this.now = opts.now ?? (() => new Date());
    this.feature = opts.feature ?? "context";
    this.db = opts.db ?? getAdminDb();
    this.audit = new AuditLogger(this.scope, opts.auditSink);
    this.reader = createTenantReader(this.scope, this.audit, this.db);
    this.budget = opts.budget ?? new TokenBudget();
  }

  /** Memoised order fetch for a window. Orders are normalised & tenant-verified. */
  getOrders(from: Date, to: Date): Promise<NormalizedOrder[]> {
    const key = `${from.toISOString()}__${to.toISOString()}`;
    let cached = this.orderCache.get(key);
    if (!cached) {
      cached = this._fetchOrders(from, to);
      this.orderCache.set(key, cached);
    }
    return cached;
  }

  private async _fetchOrders(from: Date, to: Date): Promise<NormalizedOrder[]> {
    const snap = await this.reader
      .scoped("orders")
      .where("createdAt", ">=", from)
      .where("createdAt", "<=", to)
      .orderBy("createdAt", "desc")
      .get();
    return snap.docs.map((d) => {
      const order = normalizeOrder(d.id, d.data());
      // Defence in depth: every row must belong to this tenant.
      this.reader.assertOwned(d.data() as Record<string, unknown>);
      return order;
    });
  }

  /** Memoised single-shot reads (restaurant doc, menu, prepared items, users). */
  private memo<T>(key: string, fn: () => Promise<T>): Promise<T> {
    let cached = this.singletonCache.get(key) as Promise<T> | undefined;
    if (!cached) {
      cached = fn();
      this.singletonCache.set(key, cached);
    }
    return cached;
  }

  getRestaurant(): Promise<Record<string, unknown> | null> {
    return this.memo("restaurant", () => this.reader.restaurant());
  }

  getMenuItems(): Promise<Array<Record<string, unknown> & { id: string }>> {
    return this.memo("menu_items", async () => {
      const snap = await this.reader.scoped("menu_items").get();
      return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));
    });
  }

  getPreparedItems(): Promise<Array<Record<string, unknown> & { id: string }>> {
    return this.memo("prepared_items", async () => {
      const snap = await this.reader.scoped("prepared_items").get();
      return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));
    });
  }

  /** Staff roster for this tenant. `users` is scoped by `restaurantSlug`, not `restaurantId`. */
  getUsers(): Promise<Array<Record<string, unknown> & { id: string }>> {
    return this.memo("users", async () => {
      const snap = await this.reader.scopedBy("users", "restaurantSlug").get();
      return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));
    });
  }

  getLoyaltyCustomers(): Promise<Array<Record<string, unknown>>> {
    return this.memo("loyalty_customers", async () => {
      const snap = await this.reader.subcollection("loyalty_customers").get();
      return snap.docs.map((d) => d.data() as Record<string, unknown>);
    });
  }
}

export function createIntelligenceContext(slug: string, opts?: IntelligenceContextOptions): IntelligenceContext {
  return new IntelligenceContext(slug, opts);
}

// ---------------------------------------------------------------------------
// Order normalisation (mirrors app/api/admin/reports/route.ts)
// ---------------------------------------------------------------------------

export function tsToDate(v: unknown): Date | null {
  if (!v) return null;
  const raw = v as { toDate?: () => Date; toMillis?: () => number; seconds?: number };
  if (typeof raw.toDate === "function") return raw.toDate();
  if (typeof raw.seconds === "number") return new Date(raw.seconds * 1000);
  if (v instanceof Date) return v;
  return null;
}

export function normalizeOrder(id: string, d: Record<string, unknown>): NormalizedOrder {
  const items = Array.isArray(d.items)
    ? (d.items as Array<Record<string, unknown>>).map((i) => ({
        name: (i.name as string) ?? "",
        quantity: (i.quantity as number) ?? 0,
        price: (i.price as number) ?? 0,
      }))
    : [];
  return {
    orderId: id,
    orderNumber: (d.orderNumber as number) ?? null,
    createdAt: tsToDate(d.createdAt) ?? new Date(0),
    customerName: (d.customerName as string) ?? "",
    phone: (d.phone as string) ?? "",
    items,
    itemsTotal: (d.itemsTotal as number) ?? 0,
    deliveryFee: (d.deliveryFee as number) ?? 0,
    total: (d.total as number) ?? 0,
    paymentMethod: (d.paymentMethod as string) ?? "",
    paymentStatus: (d.paymentStatus as string) ?? "",
    status: (d.status as string) ?? "",
    deliveryType: (d.deliveryType as string) ?? "",
    orderSource: (d.orderSource as string) ?? "online",
    serviceMode: (d.serviceMode as string) ?? "",
    tableLabel: (d.tableLabel as string) ?? "",
    staffId: (d.staffId as string) ?? "",
    staffName: (d.staffName as string) ?? "",
    waiterName: (d.waiterName as string) ?? "",
    settledByStaffName: (d.settledByStaffName as string) ?? "",
    preparingAt: tsToDate(d.preparingAt),
    readyAt: tsToDate(d.readyAt),
    paidAt: tsToDate(d.paidAt),
  };
}

/** Revenue-recognition predicate, identical to the Reports route. */
export function isRevenueOrder(o: NormalizedOrder): boolean {
  return o.paymentStatus === "paid" && o.status !== "rejected";
}

// ---------------------------------------------------------------------------
// Date ranges
// ---------------------------------------------------------------------------

export function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

export function endOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
}

/**
 * Resolve a range plus its immediately-preceding equivalent window (for trend
 * deltas). "week" = trailing 7 days; "month" = calendar month-to-date.
 */
export function resolveRange(input: RangeInput | undefined, now: Date): DateRange {
  const label: RangeLabel = input?.range ?? "today";
  let from: Date;
  let to: Date = endOfDay(now);

  switch (label) {
    case "yesterday": {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      from = startOfDay(y);
      to = endOfDay(y);
      break;
    }
    case "week": {
      const s = new Date(now);
      s.setDate(s.getDate() - 6);
      from = startOfDay(s);
      break;
    }
    case "month": {
      from = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      break;
    }
    case "custom": {
      const f = input?.from ? new Date(input.from) : now;
      const t = input?.to ? new Date(input.to) : now;
      from = startOfDay(f);
      to = endOfDay(t);
      break;
    }
    default:
      from = startOfDay(now);
  }

  // Previous equivalent window: same duration, immediately before `from`.
  const durationMs = to.getTime() - from.getTime();
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - durationMs);

  return { label, from, to, prevFrom, prevTo };
}

/** Hour-of-day (0..23) in Africa/Lagos for a given instant. */
export function lagosHour(d: Date): number {
  const lagos = new Date(d.toLocaleString("en-US", { timeZone: "Africa/Lagos" }));
  return lagos.getHours();
}

/** YYYY-MM-DD in Africa/Lagos for a given instant (the tenant's calendar day). */
export function lagosDateKey(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(d);
}

// ---------------------------------------------------------------------------
// Result envelope
// ---------------------------------------------------------------------------

export function makeResult<T>(
  ctx: IntelligenceContext,
  tool: string,
  data: T,
  opts: { range?: DateRange; meta?: ToolMeta } = {}
): ToolResult<T> {
  return {
    tool,
    restaurantSlug: ctx.scope.restaurantSlug,
    generatedAt: ctx.now().toISOString(),
    currency: "NGN",
    range: opts.range
      ? { label: opts.range.label, from: opts.range.from.toISOString(), to: opts.range.to.toISOString() }
      : undefined,
    data,
    meta: opts.meta ?? {},
  };
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return round2(((current - previous) / previous) * 100);
}
