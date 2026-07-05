/**
 * Shared types for the Restaurant Intelligence Layer.
 *
 * This file is intentionally free of any runtime / server-only imports so the
 * types can be referenced from anywhere (server tools, decision engine, future
 * client typing) without pulling in Firebase or `server-only`.
 *
 * NOTE: All monetary amounts derived from `orders` are in whole Naira (NGN),
 * matching the production `orders.total` convention (NOT kobo).
 */

export type UserRole = "owner" | "manager" | "staff" | "super_admin";

/** One prior exchange in a conversation, sent by the client for follow-up context. */
export interface ConversationTurn {
  question: string;
  answer: string;
}

/** Identity of the tenant a piece of work is scoped to. Never derived from an LLM prompt. */
export interface TenantScope {
  /** The restaurant slug — the single tenancy key across all collections. */
  restaurantSlug: string;
  /** Correlation id for audit logging within one request/session. */
  requestId: string;
  /** Optional role of the caller, used for future authorization decisions. */
  role?: UserRole;
}

/** A resolved reporting window plus its immediately-preceding comparison window. */
export interface DateRange {
  label: RangeLabel;
  from: Date;
  to: Date;
  /** Start of the immediately-preceding equivalent window (for trend deltas). */
  prevFrom: Date;
  /** End of the immediately-preceding equivalent window. */
  prevTo: Date;
}

export type RangeLabel = "today" | "yesterday" | "week" | "month" | "custom";

export interface RangeInput {
  range?: RangeLabel;
  from?: string | Date;
  to?: string | Date;
}

/**
 * Uniform envelope every tool returns. Structured, serialisable JSON — safe to
 * pass into a prompt or store. `data` holds the tool-specific payload.
 */
export interface ToolResult<T> {
  tool: string;
  restaurantSlug: string;
  generatedAt: string; // ISO-8601
  currency: "NGN";
  range?: { label: RangeLabel; from: string; to: string };
  data: T;
  meta: ToolMeta;
}

export interface ToolMeta {
  /** Number of source records considered (e.g. orders scanned). */
  recordCount?: number;
  /** True when results are based on a truncated/limited sample. */
  sampled?: boolean;
  /** Free-form notes surfaced to callers (e.g. data-quality caveats). */
  notes?: string[];
}

/** A single normalised order row, shared by every sales/orders tool. */
export interface NormalizedOrder {
  orderId: string;
  orderNumber: number | null;
  createdAt: Date;
  customerName: string;
  phone: string;
  items: { name: string; quantity: number; price: number }[];
  itemsTotal: number;
  deliveryFee: number;
  total: number;
  paymentMethod: string;
  paymentStatus: string;
  status: string;
  deliveryType: string;
  orderSource: string;
  serviceMode: string;
  tableLabel: string;
  staffId: string;
  staffName: string;
  waiterName: string;
  settledByStaffName: string;
  preparingAt: Date | null;
  readyAt: Date | null;
  paidAt: Date | null;
}

// ---------------------------------------------------------------------------
// Tool payload shapes (the `data` of each ToolResult)
// ---------------------------------------------------------------------------

export interface RevenueSummary {
  totalRevenue: number;
  totalOrders: number;
  paidOrders: number;
  averageOrderValue: number;
  completed: number;
  cancelled: number;
  cancelledTotal: number;
  cancellationRate: number; // 0..1
  byPaymentMethod: Record<string, { orders: number; revenue: number }>;
  byChannel: { online: number; counter: number; dineIn: number };
  unpaidTotal: number;
  /** Comparison against the immediately-preceding equivalent window. */
  previous: {
    totalRevenue: number;
    totalOrders: number;
    revenueChangePct: number | null; // null when previous is 0
    ordersChangePct: number | null;
  };
}

export interface TodayOrders {
  total: number;
  byStatus: Record<string, number>;
  active: number; // pending + preparing + ready
  revenueSoFar: number;
  latestOrders: {
    orderId: string;
    orderNumber: number | null;
    total: number;
    status: string;
    createdAt: string;
    serviceMode: string;
  }[];
}

export interface ItemSales {
  name: string;
  quantity: number;
  revenue: number;
  orders: number;
}

export interface TopSellingItems {
  items: ItemSales[];
  totalItemsSold: number;
}

export interface SlowMovingItems {
  /** Menu items with zero or very low sales in the window. */
  items: { name: string; category: string; price: number; quantity: number; revenue: number }[];
  neverSold: string[];
}

export interface InventoryOverview {
  /**
   * RestoFlow has no quantitative stock model — availability is a boolean on
   * menu/prepared items. This tool reports availability health and flags the
   * gap so downstream features (Forecasting / Smart Purchasing) can plan for it.
   */
  quantitativeStockTracked: false;
  totalItems: number;
  availableItems: number;
  unavailableItems: number;
  outOfStock: { name: string; category: string; source: "menu" | "prepared" }[];
  byCategory: Record<string, { total: number; unavailable: number }>;
}

export interface CustomerOverview {
  totalCustomers: number; // distinct in window
  returningCustomers: number;
  newCustomers: number;
  repeatRate: number; // 0..1
  topCustomers: { customerRef: string; orders: number; spend: number }[]; // customerRef is masked
  loyalty: {
    enabled: boolean;
    members: number;
    unredeemedRewards: number;
  } | null;
}

export interface StaffPerformance {
  staffCount: number;
  perStaff: {
    staffRef: string; // staffName or masked id
    orders: number;
    revenue: number;
    averageOrderValue: number;
  }[];
}

export interface KitchenPerformance {
  avgPrepMinutes: number | null; // received -> preparing
  avgReadyMinutes: number | null; // received -> ready
  ordersMeasured: number;
  slowestReadyMinutes: number | null;
  byStation: Record<string, number> | null;
}

export interface BusinessProfile {
  name: string;
  slug: string;
  address: string;
  phone: string;
  status: string; // draft | active | suspended
  subscription: {
    status: string;
    planName: string;
    daysRemaining: number | null;
    graceDaysRemaining: number | null;
    isOperational: boolean;
  };
  isOpenNow: boolean;
  channels: { delivery: boolean; pickup: boolean; dineIn: boolean };
  loyaltyEnabled: boolean;
}

export interface RestaurantSettings {
  deliveryFee: number;
  minimumOrder: number;
  deliveryEnabled: boolean;
  pickupEnabled: boolean;
  dineInEnabled: boolean;
  payments: {
    online: boolean;
    payOnDelivery: boolean;
    whatsappCheckout: boolean;
  };
  alertPreference: string;
  hidePrices: boolean;
  deliveryZones: { name: string; fee: number }[];
  /** Keys intentionally omitted for security (PINs, subaccount codes, tokens). */
  omittedSensitiveKeys: string[];
}

export interface RecentTransactions {
  transactions: {
    orderId: string;
    orderNumber: number | null;
    amount: number;
    paymentMethod: string;
    paymentStatus: string;
    customerRef: string; // masked
    createdAt: string;
    status: string;
  }[];
}

export interface MenuAnalytics {
  totalItems: number;
  categories: number;
  priceStats: { min: number; max: number; average: number };
  byCategory: Record<string, { items: number; averagePrice: number }>;
  unavailableCount: number;
}

export interface SalesByHour {
  /** 24 buckets indexed 0..23 in Africa/Lagos local time. */
  hours: { hour: number; orders: number; revenue: number }[];
  peakHour: number | null;
  peakRevenueHour: number | null;
}

// ---------------------------------------------------------------------------
// Decision engine
// ---------------------------------------------------------------------------

export type InsightType =
  | "anomaly"
  | "trend"
  | "opportunity"
  | "warning"
  | "highlight";

export type InsightSeverity = "info" | "low" | "medium" | "high" | "critical";

/** User-facing confidence bands derived from the numeric `confidence` score. */
export type ConfidenceLevel = "Very High" | "High" | "Medium" | "Low";

export interface Insight {
  type: InsightType;
  severity: InsightSeverity;
  code: string; // stable machine key, e.g. "REVENUE_DROP"
  title: string;
  /** Deterministic, human-readable explanation of the evidence. NOT LLM-generated. */
  reason: string;
  /** Deterministic suggested next action, or null when none applies. */
  suggestedAction: string | null;
  /** 0..1 — heuristic confidence based on evidence strength & sample size. */
  confidence: number;
  /** Standardised, user-friendly band for `confidence` (Very High / High / Medium / Low). */
  confidenceLevel: ConfidenceLevel;
  /** Supporting numbers for downstream rendering / LLM narration. */
  metrics?: Record<string, number | string | null>;
}

export interface DecisionReport {
  generatedAt: string;
  restaurantSlug: string;
  insights: Insight[];
  counts: Record<InsightType, number>;
}

// ---------------------------------------------------------------------------
// Daily AI Brief (ai_briefs collection)
// ---------------------------------------------------------------------------

export interface BriefRecommendation {
  title: string;
  action: string;
  confidenceLevel: ConfidenceLevel;
}

export interface BriefAnomaly {
  title: string;
  reason: string;
  severity: InsightSeverity;
}

/** Headline numbers for the card to render without parsing the prose. */
export interface BriefMetrics {
  revenue: number;
  orders: number;
  paidOrders: number;
  averageOrderValue: number;
  revenueChangePct: number | null;
  topItem: string | null;
  slowItemCount: number;
  avgPrepMinutes: number | null;
  newCustomers: number;
  returningCustomers: number;
}

/** A generated daily brief, persisted to `ai_briefs/{restaurantId}:{dateKey}`. */
export interface DailyBrief {
  restaurantId: string;
  /** Calendar day the brief is FOR (Africa/Lagos, YYYY-MM-DD). Doc id = `${slug}:${dateKey}`. */
  dateKey: string;
  /** The window the brief summarises (typically the previous complete day). */
  timeWindow: { label: RangeLabel; from: string; to: string };

  summary: string; // narrated prose (LLM) or deterministic fallback
  highlights: string[];
  recommendations: BriefRecommendation[];
  anomalies: BriefAnomaly[];
  metrics: BriefMetrics;

  generatedAt: string; // ISO
  modelUsed: string | null;
  mode: "ai" | "deterministic";
  degraded: boolean;
  confidence: number; // 0..1
  confidenceLevel: ConfidenceLevel;

  status: "generating" | "complete" | "error";
  version: number;
  usage: { tokensUsed: number; costUsd: number } | null;
}

// ---------------------------------------------------------------------------
// Recommendations Engine (ai_recommendations collection)
// ---------------------------------------------------------------------------

export type RecommendationType =
  | "price_increase"
  | "promote_item" // discount / feature a slow mover
  | "staffing"
  | "bundle"
  | "reenable_item" // re-enable / restock an unavailable item
  | "loyalty";

export type RecommendationStatus = "new" | "accepted" | "dismissed" | "snoozed" | "expired";

/**
 * Machine-actionable parameters for a recommendation. Deliberately structured so
 * a future Automation phase can EXECUTE an approved recommendation without
 * re-parsing prose. Fields are type-specific; only the relevant ones are set.
 */
export interface RecommendationAction {
  kind: RecommendationType;
  /** Primary subject (e.g. menu item name). */
  target?: string;
  currentPrice?: number;
  suggestedPrice?: number;
  delta?: number;
  /** Staffing window, e.g. "12:00-14:00". */
  window?: string;
  /** Item to pair with (bundling). */
  pairWith?: string;
}

export interface Recommendation {
  /** Stable id derived from type+target, so regeneration updates rather than duplicates. */
  id: string;
  restaurantId: string;
  /** Africa/Lagos day the recommendation set was generated for. */
  dateKey: string;
  type: RecommendationType;
  category: ToolCategory;
  title: string; // "Increase the price of Jollof Rice by ₦200"
  rationale: string; // deterministic explanation
  expectedImpact: string;
  action: RecommendationAction;
  confidence: number; // 0..1
  confidenceLevel: ConfidenceLevel;
  priority: number; // for ranking (higher = more important)
  status: RecommendationStatus;
  timeWindow: { label: RangeLabel; from: string; to: string };
  generatedAt: string;
  updatedAt: string;
  source: "deterministic" | "ai-assisted";
  version: number;
}

// ---------------------------------------------------------------------------
// Forecasting Engine (ai_forecasts collection)
// ---------------------------------------------------------------------------

export type ForecastHorizon = "tomorrow" | "next_7_days";

/** A single explanation of what drove a forecast — the "why". */
export interface ForecastDriver {
  type: "baseline" | "trend" | "seasonality" | "insight" | "recommendation";
  detail: string;
  value?: number | string | null;
}

export interface ForecastPoint {
  metric: "revenue" | "orders";
  horizon: ForecastHorizon;
  predicted: number;
  /** Lower / upper bound of the prediction interval. */
  low: number;
  high: number;
  unit: "NGN" | "orders";
  confidence: number; // 0..1
  confidenceLevel: ConfidenceLevel;
}

/** Per-item demand projection — the structured input Smart Purchasing consumes. */
export interface ItemDemandForecast {
  item: string;
  expectedUnitsPerDay: number;
  expectedUnitsNext7: number;
  trendPct: number | null;
  confidence: number;
  confidenceLevel: ConfidenceLevel;
  /** Recommendations that affect this item's demand (e.g. a price increase). */
  relatedRecommendationIds: string[];
  note: string | null;
}

/** Expected busy window — the structured input Automation consumes for staffing. */
export interface PeakWindowForecast {
  window: string; // "18:00-20:00"
  expectedSharePct: number;
}

/** A generated forecast, persisted to `ai_forecasts/{restaurantId}:{dateKey}`. */
export interface Forecast {
  restaurantId: string;
  dateKey: string;
  horizonWindow: { from: string; to: string };
  method: string; // "deterministic-trend-seasonality"
  basis: {
    daysOfHistory: number;
    dailyAvgRevenue: number;
    dailyAvgOrders: number;
    trendPct: number | null;
    volatility: number; // coefficient of variation
  };
  revenue: ForecastPoint;
  orders: ForecastPoint;
  itemDemand: ItemDemandForecast[];
  peakWindows: PeakWindowForecast[];
  drivers: ForecastDriver[];
  confidence: number;
  confidenceLevel: ConfidenceLevel;
  degraded: boolean;
  source: "deterministic";
  version: number;
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Smart Purchasing (ai_purchase_plans collection)
// ---------------------------------------------------------------------------

export type ReorderSignal = "LOW" | "MEDIUM" | "HIGH";

/**
 * Demand at the granularity RestoFlow's data supports TODAY: the menu item.
 * This is the INPUT to the Demand Translator. A future Recipe Engine sits BELOW
 * this (menu demand → recipes → ingredient demand) without changing anything above.
 */
export interface MenuItemDemand {
  item: string;
  expectedUnitsNext7: number;
  expectedUnitsPerDay: number;
  trendPct: number | null;
  relatedRecommendationIds: string[];
  /** A `reenable_item` recommendation targets this item (currently unavailable). */
  unavailable: boolean;
  /** A `promote_item` recommendation targets this item. */
  promoted: boolean;
}

/**
 * Ingredient-level demand. Produced by a FUTURE Recipe Engine (RecipeResolver) —
 * absent today. Kept optional throughout so ingredient planning can light up with
 * NO change to the forecasting/recommendation/automation layers or purchasing API.
 */
export interface IngredientDemand {
  ingredient: string;
  unit: string;
  requiredQuantity: number;
  onHand?: number | null;
  supplier?: string | null;
}

/** A menu-item purchasing/prep line — always produced. */
export interface MenuPurchaseLine {
  item: string;
  expectedUnits: number; // next 7 days
  expectedUnitsPerDay: number;
  preparationBatches: number; // suggested prep runs per day (0 if unavailable)
  peakWindow: string | null; // when to concentrate production
  reorderSignal: ReorderSignal;
  guidance: string;
  trendPct: number | null;
  relatedRecommendationIds: string[];
}

/** An ingredient purchasing line — only present once recipes exist. */
export interface IngredientPurchaseLine {
  ingredient: string;
  unit: string;
  requiredQuantity: number;
  onHand: number | null;
  reorderQuantity: number | null; // max(0, required - onHand) when stock known
  supplier: string | null;
  reorderSignal: ReorderSignal;
}

/** A generated purchasing plan, persisted to `ai_purchase_plans/{restaurantId}:{dateKey}`. */
export interface PurchasingPlan {
  restaurantId: string;
  dateKey: string;
  horizonWindow: { from: string; to: string };
  method: string;
  /** Always present — the menu-item prep & reorder plan. */
  menuDemand: MenuPurchaseLine[];
  /** Present only when a Recipe Engine supplied ingredient demand. */
  ingredientDemand?: IngredientPurchaseLine[];
  peakWindows: PeakWindowForecast[];
  summary: string;
  /** false until recipes/bill-of-materials data exists; UI can prompt setup. */
  ingredientPlanningAvailable: boolean;
  /** Provenance: which forecast this plan was derived from. */
  basedOnForecastAt: string;
  confidence: number;
  confidenceLevel: ConfidenceLevel;
  degraded: boolean;
  source: "deterministic";
  version: number;
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// AI Automation (ai_automation_rules / ai_automations / ai_automation_executions)
// ---------------------------------------------------------------------------

/** Who performed an action — an owner/manager, or the system (auto-execution). */
export interface ActorRef {
  type: "owner" | "manager" | "system";
  id: string;
}

export type AutomationStatus =
  | "pending_approval" // created, source not yet approved
  | "approved" // ready to execute (still gated by an enabled rule)
  | "executing"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "rolled_back";

/** Where an automation came from — an APPROVED recommendation or a purchasing action. */
export interface AutomationSource {
  type: "recommendation" | "purchasing";
  id: string; // recommendation id, or purchasing plan line key
  actionKind: string; // original action kind (e.g. "reenable_item", "restock")
  dateKey?: string;
}

/** The structured payload handed to an action handler — no business logic, just data. */
export interface AutomationAction {
  kind: string; // the handler kind that executes this
  summary: string;
  params: Record<string, string | number | boolean | null>;
}

/**
 * Owner-configured enablement per handler capability. Approval-first: absence of an
 * enabled rule means the automation CANNOT execute. Doc id `${slug}:${kind}`.
 */
export interface AutomationRule {
  restaurantId: string;
  kind: string; // handler capability this rule governs (e.g. "notify")
  enabled: boolean;
  autoExecute: boolean; // false = manual owner trigger only; true = system may auto-run
  updatedBy: ActorRef;
  updatedAt: string;
}

/** An automation instance created from an approved source. Doc id `${slug}:${id}`. */
export interface Automation {
  id: string;
  restaurantId: string;
  source: AutomationSource;
  handlerKind: string;
  action: AutomationAction;
  title: string;
  status: AutomationStatus;
  createdBy: ActorRef;
  createdAt: string;
  approvedBy: ActorRef | null;
  approvedAt: string | null;
  updatedAt: string;
  lastExecutionId: string | null;
  version: number;
}

/** A single execution attempt-set — the audit trail. Doc id `${slug}:${id}`. */
export interface AutomationExecution {
  id: string;
  automationId: string;
  restaurantId: string;
  handlerKind: string;
  actor: ActorRef;
  attempt: number; // how many tries were made
  maxAttempts: number;
  status: "succeeded" | "failed";
  startedAt: string;
  finishedAt: string;
  result: { detail: string; output?: Record<string, unknown> } | null;
  error: { message: string; reason?: string } | null;
  rollbackToken: string | null;
  /** Populated if this execution was later reversed. */
  rollback: { rolledBackAt: string; by: ActorRef; detail: string } | null;
}

// ---------------------------------------------------------------------------
// Tool registration metadata
// ---------------------------------------------------------------------------

export type ToolCategory =
  | "sales"
  | "orders"
  | "menu"
  | "customers"
  | "staff"
  | "kitchen"
  | "inventory"
  | "business"
  | "settings";

export type CostTier = "low" | "medium" | "high";

/** Rough per-invocation cost of feeding a tool's output to an LLM (budgeting only). */
export interface EstimatedCost {
  /** Approximate output tokens the tool's payload adds to a prompt. */
  tokens: number;
  /** Approximate USD cost at fast-provider pricing. */
  usd: number;
  tier: CostTier;
}

/**
 * Registration descriptor for a tool. Lets future features (Copilot tool-calling,
 * permission checks, cost estimation) reason about a tool without importing it.
 */
export interface ToolDescriptor {
  /** Stable identifier (equals the tool's function name). */
  id: string;
  name: string;
  description: string;
  category: ToolCategory;
  /** Whether the tool accepts a RangeInput ({ range, from, to }). */
  acceptsRange: boolean;
  /** Roles permitted to invoke this tool. Advisory — the calling route enforces it. */
  permissions: UserRole[];
  /** Firestore collections the tool reads (never writes). */
  readsCollections: string[];
  estimatedCost: EstimatedCost;
}

// ---------------------------------------------------------------------------
// Usage / audit persistence (ai_usage collection)
// ---------------------------------------------------------------------------

/** One persisted usage/audit record per AI request, written to `ai_usage`. */
export interface UsageRecord {
  requestId: string;
  restaurantSlug: string;
  /** ISO timestamp the record was written. */
  at: string;
  /** Which AI feature produced this request (e.g. "health", "context", "copilot"). */
  feature: string;
  status: "ok" | "error";
  /** Token/cost accounting for the request. */
  tokensUsed: number;
  costUsd: number;
  /** Number of audit events captured this request. */
  eventCount: number;
  /** Bounded copy of the audit events (most recent first). */
  events: Array<{ event: string; at: string; details?: Record<string, unknown> }>;
  /** Tool orchestration summary, when a context was assembled. */
  toolsRun?: string[];
  toolsFailed?: { tool: string; error: string }[];
  degraded?: boolean;
  /** Optional free-form note (e.g. error message). */
  note?: string;
}
