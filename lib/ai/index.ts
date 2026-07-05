import "server-only";

/**
 * Restaurant Intelligence Layer — public entry point.
 *
 * The trusted layer between Firestore and any AI capability. Nothing here calls
 * an LLM by itself; it produces structured, tenant-scoped, read-only data that
 * future phases (Copilot, Daily Brief, Recommendations, Forecasting, Smart
 * Purchasing, Automation) build on without duplicating logic.
 *
 * Typical usage (in a future, authenticated server context):
 *
 *   const { restaurantSlug } = await getAuthenticatedUser();
 *   const context = await buildRestaurantContext(restaurantSlug, { range: { range: "week" } });
 *   const report  = runDecisionEngine(context);
 */

// Context assembly
export { buildRestaurantContext, type RestaurantContext, type BuildContextOptions } from "./context";

// Decision engine
export { runDecisionEngine, confidenceToLevel, THRESHOLDS } from "./decision-engine";

// Tool layer
export * from "./tools";

// Business vocabulary
export {
  VOCABULARY,
  resolveTerm,
  getEntity,
  matchEntities,
  suggestTools,
  glossary,
  type VocabularyEntry,
  type EntityKey,
} from "./vocabulary";

// Usage / audit persistence (ai_usage)
export { writeUsageRecord, buildUsageRecord, AI_USAGE_COLLECTION, type WriteUsageOptions } from "./usage";

// Restaurant Intelligence Assistant (internally "Copilot")
export {
  askAssistant,
  parseRange,
  detectRange,
  resolveConversationalIntent,
  deterministicAnswer,
  type AssistantAnswer,
  type AssistantMode,
  type AskAssistantOptions,
} from "./assistant";

// Shared narration helper
export { narrate, type NarrationResult, type NarrateArgs } from "./narration";

// Quick actions catalog
export { QUICK_ACTIONS, getQuickAction, type QuickAction } from "./quick-actions";

// Daily AI Brief
export {
  generateBrief,
  getBrief,
  lagosDateKey,
  briefConfidence,
  BriefBusyError,
  AI_BRIEFS_COLLECTION,
  type GenerateBriefOptions,
} from "./brief";

// Recommendations Engine
export {
  generateRecommendations,
  listRecommendations,
  updateRecommendationStatus,
  AI_RECOMMENDATIONS_COLLECTION,
  type GenerateRecommendationsOptions,
} from "./recommendations";

// Forecasting Engine (consumes context + decision + recommendations)
export {
  generateForecast,
  getForecast,
  AI_FORECASTS_COLLECTION,
  type GenerateForecastOptions,
} from "./forecasting";

// Smart Purchasing (consumes forecast + recommendations; Recipe Engine seam)
export {
  generatePurchasingPlan,
  getPurchasingPlan,
  menuDemandTranslator,
  AI_PURCHASE_PLANS_COLLECTION,
  type GeneratePurchasingPlanOptions,
  type RecipeResolver,
  type DemandTranslator,
  type TranslatorInput,
  type TranslatorOutput,
} from "./purchasing";

// Voice AI Restaurant Manager (a client on top of the stack — reuses every engine)
export { handleVoiceTurn, buildVoiceGreeting, toSpeech, type VoiceTurnOptions, type VoiceGreetingOptions } from "./voice";

// Proactive voice signals (deterministic, read-only detection over existing engines)
export { detectProactiveSignals, type DetectSignalsOptions } from "./signals";

// AI Automation (approval-first orchestration over approved recs/purchasing actions)
export {
  createAutomationFromRecommendation,
  createAutomationFromPurchasingLine,
  executeAutomation,
  rollbackExecution,
  listAutomations,
  listExecutions,
  getAutomationRule,
  listAutomationRules,
  setAutomationRule,
  availableHandlerKinds,
  notifyHandler,
  purchaseOrderDraftHandler,
  AutomationDisabledError,
  AutomationNotApprovedError,
  AutomationStateError,
  AI_AUTOMATION_RULES_COLLECTION,
  AI_AUTOMATIONS_COLLECTION,
  AI_AUTOMATION_EXECUTIONS_COLLECTION,
  type ActionHandler,
  type HandlerContext,
  type HandlerResult,
} from "./automation";

// Explain Dashboard architecture
export {
  explainWidget,
  isWidgetType,
  WIDGET_REGISTRY,
  type WidgetType,
  type ExplainResult,
  type ExplainWidgetOptions,
} from "./explain";

// Customer-facing branding
export {
  ASSISTANT_NAME,
  ASSISTANT_SHORT,
  ASSISTANT_TAGLINE,
  ASSISTANT_EXAMPLES,
} from "./branding";

// Provider abstraction
export {
  selectProvider,
  getProvider,
  isAnyProviderConfigured,
  providers,
  GeminiProvider,
  AnthropicProvider,
  type AiProvider,
  type ProviderName,
  type Capability,
  type GenerateOptions,
  type GenerateResult,
} from "./provider";

// Guardrails
export {
  createTenantReader,
  TenantReader,
  ReadOnlyQuery,
  AuditLogger,
  TokenBudget,
  assertTenant,
  redactPII,
  sanitizePrompt,
  maskPhone,
  maskEmail,
  maskName,
  customerRef,
  estimateTokens,
  TenantIsolationError,
  ReadOnlyViolationError,
  BudgetExceededError,
  DEFAULT_BUDGET,
  SENSITIVE_SETTING_KEYS,
  type AuditEvent,
  type AuditSink,
  type BudgetConfig,
} from "./guardrails";

// Shared types
export * from "./types";
