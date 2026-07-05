# RestoFlow — AI Foundation (Sprint 1A)

The **Restaurant Intelligence Layer**: the shared, trusted layer that sits between
Firestore and every AI capability. It exists so that **no AI feature ever queries
Firestore from a prompt**. Instead, features consume typed, tenant-scoped,
read-only **tools**, an assembled **context**, and a deterministic **decision
engine** — with a provider abstraction and guardrails around all of it.

> Status: foundation only. There is **no Copilot UI, no chat endpoint, and no LLM
> call from any production route** in this sprint. Everything here is read-only
> and additive; existing production behaviour is unchanged.

---

## 1. Where it lives

```
lib/ai/
├── index.ts              # public barrel (Restaurant Intelligence Layer API)
├── types.ts              # shared types (no runtime imports; safe to import anywhere)
├── guardrails.ts         # trust boundary: tenancy, read-only, PII, prompts, budget, audit
├── provider.ts           # provider abstraction: Gemini (fast) + Anthropic (reasoning)
├── context.ts            # assembles the RestaurantContext from the tool layer
├── decision-engine.ts    # deterministic rules → structured insights (NO LLM)
└── tools/
    ├── index.ts          # tool registry (TOOLS, TOOL_REGISTRY)
    ├── _shared.ts        # IntelligenceContext, memoised reads, order normalisation, ranges
    ├── getRevenueSummary.ts
    ├── getTodayOrders.ts
    ├── getTopSellingItems.ts
    ├── getSlowMovingItems.ts
    ├── getInventoryOverview.ts
    ├── getCustomerOverview.ts
    ├── getStaffPerformance.ts
    ├── getKitchenPerformance.ts
    ├── getBusinessProfile.ts
    ├── getRestaurantSettings.ts
    ├── getRecentTransactions.ts
    ├── getMenuAnalytics.ts
    └── getSalesByHour.ts

docs/AI_FOUNDATION.md      # this document
```

---

## 2. Architecture diagram

```
                          ┌──────────────────────────────────────────────┐
                          │             FUTURE AI FEATURES                │
                          │  Copilot · Daily Brief · Recommendations ·    │
                          │  Forecasting · Smart Purchasing · Automation  │
                          └───────────────────┬──────────────────────────┘
                                              │ consume typed data only
                                              │ (never raw Firestore, never SQL-in-prompt)
        ┌─────────────────────────────────────┼─────────────────────────────────────┐
        │             RESTAURANT INTELLIGENCE LAYER  (lib/ai)                        │
        │                                                                            │
        │   ┌────────────────┐   ┌──────────────────┐   ┌────────────────────────┐  │
        │   │  context.ts    │   │ decision-engine  │   │      provider.ts       │  │
        │   │ RestaurantCtx  │──▶│ deterministic    │   │ Gemini (fast) /        │  │
        │   │ (orchestrator) │   │ rules → Insights │   │ Anthropic (reasoning)  │  │
        │   └───────┬────────┘   └──────────────────┘   └────────────────────────┘  │
        │           │ orchestrates                                                   │
        │   ┌───────▼─────────────────────────────────────────────────────────────┐ │
        │   │                        tools/  (13 tools)                            │ │
        │   │  getRevenueSummary · getTodayOrders · getTopSellingItems · …         │ │
        │   │  each: single responsibility · typed ToolResult<T> · testable        │ │
        │   └───────┬─────────────────────────────────────────────────────────────┘ │
        │           │ all reads go through …                                         │
        │   ┌───────▼─────────────────────────────────────────────────────────────┐ │
        │   │                      guardrails.ts (TRUST BOUNDARY)                  │ │
        │   │  TenantReader (read-only, tenant-scoped)  · assertTenant             │ │
        │   │  redactPII · sanitizePrompt · TokenBudget · AuditLogger             │ │
        │   └───────┬─────────────────────────────────────────────────────────────┘ │
        └───────────┼───────────────────────────────────────────────────────────────┘
                    │ getAdminDb() — READ ONLY (where restaurantId == slug)
            ┌───────▼────────┐
            │   Firestore    │   orders · menu_items · prepared_items · users ·
            │  (production)  │   restaurants/{slug}[/loyalty_customers]
            └────────────────┘
```

**Key invariant:** the only path from an AI feature to Firestore is *down* through
the guardrails, and the guardrails only ever **read**, always **filtered to one
tenant**. There is no write surface anywhere in `lib/ai`.

---

## 3. Tool layer diagram

Every tool has one responsibility and returns a structured `ToolResult<T>`:

```
ToolResult<T> = {
  tool: string                 // e.g. "getRevenueSummary"
  restaurantSlug: string       // the tenant
  generatedAt: ISO string
  currency: "NGN"
  range?: { label, from, to }  // present for windowed tools
  data: T                      // the typed payload
  meta: { recordCount?, sampled?, notes? }
}
```

| Tool | Responsibility | Windowed | Payload type |
|------|----------------|:--------:|--------------|
| `getRevenueSummary` | Revenue/order totals + trend vs previous period | ✓ | `RevenueSummary` |
| `getTodayOrders` | Live snapshot of today's orders | – | `TodayOrders` |
| `getTopSellingItems` | Best sellers by quantity | ✓ | `TopSellingItems` |
| `getSlowMovingItems` | Low/never-sold menu items | ✓ | `SlowMovingItems` |
| `getInventoryOverview` | Availability health (no stock model) | – | `InventoryOverview` |
| `getCustomerOverview` | New/returning, repeat rate, loyalty (masked) | ✓ | `CustomerOverview` |
| `getStaffPerformance` | Per-staff throughput & revenue | ✓ | `StaffPerformance` |
| `getKitchenPerformance` | Avg prep/ready times | ✓ | `KitchenPerformance` |
| `getBusinessProfile` | Identity, open state, subscription, channels | – | `BusinessProfile` |
| `getRestaurantSettings` | Operational settings (sensitive keys excluded) | – | `RestaurantSettings` |
| `getRecentTransactions` | Recent order transactions (masked) | ✓ | `RecentTransactions` |
| `getMenuAnalytics` | Menu structure, price distribution | – | `MenuAnalytics` |
| `getSalesByHour` | 24-hour sales distribution, peak hours | ✓ | `SalesByHour` |

Every tool signature is uniform:

```ts
getX(ctx: IntelligenceContext, input?: RangeInput): Promise<ToolResult<T>>
```

They are **independently testable** (construct one `IntelligenceContext`, call one
tool) and **reusable** (the same tools power the context builder and, later, the
Copilot's tool-calling). The machine-readable `TOOL_REGISTRY` describes each tool
so a future Copilot can expose them to an LLM without re-declaring anything.

### Data-source fidelity

Tools mirror the **exact** revenue-recognition and prep-time rules used by the
production Reports route (`app/api/admin/reports/route.ts`) so AI numbers always
match what owners already see:

- Revenue order = `paymentStatus === "paid" && status !== "rejected"`.
- Prep time = `preparingAt − createdAt`; ready time = `readyAt − createdAt`.
- Amounts are whole **Naira** (matching `orders.total`), never kobo.
- Tenancy: `restaurantId == slug` for most collections; `restaurantSlug` for `users`.

> **Known data gaps (honest by design):**
> RestoFlow has **no quantitative inventory** — items only carry an `available`
> boolean. `getInventoryOverview` reports availability, sets
> `quantitativeStockTracked: false`, and flags the gap. Per-station kitchen timing
> is not recorded on orders (`byStation: null`). These are the seams Forecasting
> and Smart Purchasing will need to fill.

---

## 4. Request flow

```
(future) authenticated server context
   │  user = await getAuthenticatedUser()      ← existing auth, session cookie
   │  slug = user.restaurantSlug               ← tenant derived from SESSION, never a prompt
   ▼
buildRestaurantContext(slug, { range })
   │
   ├─ new IntelligenceContext(slug)            ← creates TenantReader + AuditLogger + TokenBudget
   │
   ├─ Promise.all( run each of the 13 tools )  ← concurrent; per-tool try/catch (resilient)
   │      │
   │      └─ tool → ctx.getOrders(from,to)      ← MEMOISED: overlapping windows fetched ONCE
   │             → reader.scoped("orders")      ← where restaurantId == slug (read-only)
   │             → assertOwned(row)             ← defence-in-depth tenant check per row
   │
   ├─ assemble RestaurantContext { business, sales, orders, menu, customers,
   │                               staff, inventory, reports, settings, meta }
   │
   └─ redactPII(context)                        ← final mask pass before it can reach an LLM
   ▼
runDecisionEngine(context) → DecisionReport { insights[], counts }
   ▼
(future) provider = selectProvider("reasoning") → narrate / recommend
```

**Performance:** because all tools share one `IntelligenceContext`, the ~13 tools
that would each fetch orders instead hit a per-request memo cache — a shared window
is one Firestore query, not thirteen. Nothing runs on the customer/POS hot path;
these calls are intended for admin/insight surfaces and (later) cron precompute.

---

## 5. Context assembly

`buildRestaurantContext()` produces the structured tree the sprint specifies:

```
RestaurantContext
├── business      BusinessProfile        (identity, open state, subscription, channels)
├── settings      RestaurantSettings     (fees, minimums, channels, payments; secrets excluded)
├── sales
│   ├── summary   RevenueSummary         (+ trend vs previous window)
│   └── byHour    SalesByHour            (24-hour distribution, peak hours)
├── orders        TodayOrders            (today's live snapshot)
├── menu
│   ├── analytics MenuAnalytics
│   ├── topItems  TopSellingItems
│   └── slowItems SlowMovingItems
├── customers     CustomerOverview       (masked; new/returning/repeat/loyalty)
├── staff         StaffPerformance
├── inventory     InventoryOverview      (availability health)
├── reports
│   ├── kitchen            KitchenPerformance
│   └── recentTransactions RecentTransactions
└── meta          { toolsRun, toolsFailed, degraded, auditEventCount }
```

Assembly properties:

- **Resilient / graceful degradation** — each section runs independently; a failing
  tool degrades that section to `null` and is recorded in `meta.toolsFailed`
  (`meta.degraded = true`). The Copilot can still reason over whatever succeeded.
- **Safe** — a final `redactPII` pass runs over the whole tree; even if a tool
  returned a raw phone/address, it is masked/dropped before leaving the layer.
- **Reusable** — accepts either a `slug` (creates a context) or an existing
  `IntelligenceContext` (for tests or when a caller already has one).

---

## 6. Decision engine

`decision-engine.ts` applies **deterministic business rules** to the assembled
context. **It uses no LLM and generates no natural language** — every `reason` and
`suggestedAction` is a template filled from numbers, so results are auditable and
unit-testable. The judgement lives in code, not in a prompt.

Output is `DecisionReport { insights: Insight[], counts }`, ranked by severity then
confidence. Each insight:

```ts
{
  type: "anomaly" | "trend" | "opportunity" | "warning" | "highlight",
  severity: "info" | "low" | "medium" | "high" | "critical",
  code: "REVENUE_DROP",          // stable machine key
  title: "Revenue down 50% vs previous period",
  reason: "Paid revenue was ₦50,000 this period vs ₦100,000 previously (-50%).",
  suggestedAction: "Review order volume, opening hours, and unavailable items.",
  confidence: 0.83,              // 0..1, heuristic: signal strength × sample adequacy
  metrics: { changePct: -50, current: 50000, previous: 100000 }
}
```

Rules currently implemented (all thresholds centralised in `THRESHOLDS`):

| Code | Type | Fires when |
|------|------|-----------|
| `REVENUE_DROP` / `REVENUE_SURGE` | warning / highlight | revenue vs previous window ≤ −25% / ≥ +25% |
| `NO_SALES_TODAY` | anomaly | open + operational but 0 orders today |
| `HIGH_CANCELLATION` | warning | cancellation rate ≥ 15% (min 5 orders) |
| `TOP_SELLER` | highlight | a best seller exists |
| `SLOW_MOVERS` | opportunity | menu items with zero sales |
| `KITCHEN_SLOW` | warning | avg ready time > 30 min (min 5 measured) |
| `PEAK_HOUR` | trend | a busiest hour is identifiable |
| `SUBSCRIPTION_GRACE` / `SUBSCRIPTION_EXPIRING` | warning | in grace / ≤ 5 days remaining |
| `ITEMS_UNAVAILABLE` | warning | any items marked unavailable |
| `MENU_LARGELY_UNAVAILABLE` | warning | ≥ 20% of menu unavailable |
| `LOW_REPEAT_RATE` | opportunity | repeat rate < 20% (min 10 customers) |
| `LOYALTY_DISABLED` / `UNREDEEMED_REWARDS` | opportunity | loyalty off / rewards outstanding |
| `UNPAID_ORDERS` | warning | unpaid ≥ 10% of billed value |

**Confidence** = `(0.55 + 0.4·strength) × (0.6 + 0.4·sampleAdequacy)`, clamped to
`[0, 0.98]` — stronger signals on larger samples score higher. This keeps
low-evidence findings visibly less certain.

Adding a rule = add one pure `Rule` function to the `RULES` array. No other change.

---

## 7. Provider abstraction

`provider.ts` exposes **one interface** over two backends, selected by capability:

```ts
interface AiProvider {
  name: "gemini" | "anthropic";
  model: string;
  capabilities: ("fast" | "reasoning")[];
  isConfigured(): boolean;
  generate(prompt: string, opts?: GenerateOptions): Promise<GenerateResult>;
}

selectProvider("fast")       // → Gemini (gemini-2.5-flash), falls back to Anthropic
selectProvider("reasoning")  // → Anthropic (claude), falls back to Gemini
selectProvider(...) === null // when nothing is configured (caller handles 503)
```

- **Gemini** — fast/cheap; wraps `@google/generative-ai` (same model the existing
  `lib/ai-server.ts` uses).
- **Anthropic (Claude)** — reasoning; wraps `@anthropic-ai/sdk` (already a
  dependency, previously unused).
- **Budget-aware** — every `generate()` reserves against a `TokenBudget` before the
  call and records real usage after, with per-provider USD cost estimates.
- **Graceful** — providers never throw at import time; `isConfigured()` returns
  `false` when a key is missing, mirroring the existing `AiTextHelper` 503-hide
  pattern. **No route calls `generate()` in this sprint.**

Business logic asks for a *capability*, never a vendor — a third provider can be
added by implementing `AiProvider` and registering it, with zero caller changes.

> Cost constants in `PRICING` are **budgeting estimates only** (they cap the
> in-memory ceiling); they never affect real billing. Update when vendor pricing
> changes.

---

## 8. Guardrails (the trust boundary)

Everything crosses `guardrails.ts`. Responsibilities and primitives:

| Concern | Primitive | Guarantee |
|--------|-----------|-----------|
| Tenant isolation | `TenantReader`, `assertTenant` | queries pre-filtered to the slug; every row re-checked |
| Read-only enforcement | `ReadOnlyQuery`, `TenantReader` | **no** `set/update/delete/add/create` surface exists |
| PII redaction | `redactPII`, `maskPhone/Email/Name`, `customerRef` | phones masked, addresses/links dropped, customers referenced by non-reversible keys |
| Prompt sanitisation | `sanitizePrompt` | strips control chars, defuses injection phrases, truncates |
| Cost limits | `TokenBudget` (USD ceiling) | throws `BudgetExceededError` past the cap |
| Token budgeting | `TokenBudget`, `estimateTokens` | hard per-request token ceiling |
| Audit logging | `AuditLogger` (+ `AuditSink`) | every privileged read recorded; sink swappable |

Design choices:

- **Read-only is structural, not conventional.** The AI layer is only ever handed
  a `ReadOnlyQuery` / `TenantReader`, which expose `where/orderBy/limit/get` and
  nothing that writes. Read-only enforcement can't be bypassed by forgetting a
  check.
- **All accounting is in-memory.** Cost/token/audit state lives in per-request
  objects — the foundation performs **zero Firestore writes**, satisfying the
  strict read-only constraint. A durable `ai_usage` / `ai_audit` sink can be added
  later by swapping `AuditLogger`'s sink, with no caller changes.
- **Sensitive settings never leak.** `SENSITIVE_SETTING_KEYS` (PINs, Paystack
  subaccount codes, tokens, `pinHash`, `ownerUid`, …) are excluded from
  `getRestaurantSettings`, which also reports how many keys it omitted.

---

## 9. Security, tenancy & authorization posture

- **Tenant is derived from the authenticated session** (`getAuthenticatedUser()` →
  `restaurantSlug`), never from an LLM prompt or request body. `buildRestaurantContext`
  takes the slug as its first argument by design.
- **Isolation is enforced twice:** every scoped query filters by the tenant field,
  and every row is re-verified with `assertOwned` before use.
- **No cross-tenant reads are possible** through the layer — a mis-scoped query
  would throw `TenantIsolationError` on the first foreign row.
- **Authorization** (which roles may run which AI feature) belongs to the *calling*
  route in later sprints; this layer assumes an already-authenticated tenant and
  focuses on isolation + redaction.

---

## 10. Testing

Pure logic is verified without Firebase (guardrails, ranges, decision engine,
provider selection, and the read-only structural guarantee). Tools are structured
for isolation via an injectable clock (`now`), an injectable `AuditSink`, and the
`IntelligenceContext` seam — so a fake `TenantReader` can drive them in unit tests.

Recommended test layers going forward:
1. **Pure unit** (no I/O): guardrails, `resolveRange`, `decision-engine` rules.
2. **Tool unit** (mocked `TenantReader`): each tool's aggregation math.
3. **Contract** (later, when routes exist): assert cross-tenant access returns
   empty/403 and that no route calls `generate()` unexpectedly.

---

## 11. Future extension points

The foundation is deliberately open for the roadmap phases:

- **Phase 1 — Copilot.** Expose `TOOL_REGISTRY` + `TOOLS` to an LLM for
  tool-calling; feed `buildRestaurantContext()` as grounding. `sanitizePrompt`
  guards untrusted turns; `TokenBudget` caps spend; `selectProvider("reasoning")`
  routes to Claude.
- **Phase 2 — Daily Brief.** Run `buildRestaurantContext` + `runDecisionEngine` on
  a schedule (Vercel Cron), narrate the top insights with a provider, cache the
  result. (Introduces the first *new* infra — a scheduler — and a write to a new
  `ai_briefs` collection, outside this sprint's read-only scope.)
- **Phase 3 — Recommendations.** Promote decision-engine insights to persisted,
  accept/dismiss-able `ai_recommendations`.
- **Phase 4 — Forecasting.** Add a stock/time-series model; new tools
  (`getDemandForecast`) slot into the same `ToolResult` contract.
- **Phase 5 — Smart Purchasing.** Requires the quantitative inventory model the
  `getInventoryOverview` gap flags; builds reorder suggestions from forecasts.
- **Phase 6 — Automation.** The only phase that writes to core collections — and
  only through existing services, dry-run-first, human-approved, and audited via
  the `AuditLogger` sink promoted to a durable store.

New extension seams already in place:
- **New tool** → drop a file in `tools/`, export it, add a `TOOL_REGISTRY` entry.
- **New rule** → add a pure function to `RULES` in `decision-engine.ts`.
- **New provider** → implement `AiProvider`, register it, done.
- **Durable audit/usage** → swap `AuditLogger`'s `AuditSink`.

---

## 12. Constraints honoured this sprint

- ✅ No Copilot UI, no chat endpoints.
- ✅ No LLM called from any production route (provider is infrastructure only).
- ✅ No modification to `orders`, `payments`, `restaurants`, `menu`, or inventory
  collections — the layer performs **zero writes**.
- ✅ Everything read-only and tenant-scoped.
- ✅ Only new files added under `lib/ai/` and `docs/`; existing production
  behaviour is unchanged (full `tsc` typecheck passes with 0 errors).

---

## 13. Production-readiness additions (pre-Copilot)

Six additions harden the foundation for support and scale before the Copilot is
built. These introduce the module's **first and only** Firestore write — always to
a dedicated `ai_usage` collection, never to a core collection.

### 13.1 Persistent usage/audit log → `ai_usage`
`lib/ai/usage.ts` flushes a request's in-memory audit buffer + token/cost totals to
**one** document in `ai_usage` (`writeUsageRecord(ctx, opts)`). The collection name
is a hard-coded constant (`AI_USAGE_COLLECTION`) — no caller can redirect the write.
One summary doc per request (not per event) keeps write volume tiny. `firestore.rules`
now has an explicit `ai_usage` block (client read/write denied; Admin-SDK only). A
durable audit trail replaces the purely in-memory buffer without changing any tool.

### 13.2 Tool registration metadata
`TOOL_REGISTRY` (in `tools/index.ts`, typed by `ToolDescriptor` in `types.ts`) now
carries per-tool: **`id`**, `description`, `category`, `acceptsRange`,
**`permissions`** (roles allowed — advisory; the route enforces), **`readsCollections`**,
and **`estimatedCost`** (`{ tokens, usd, tier }`). Future Copilot tool-calling,
permission checks, and budgeting can reason about a tool from metadata alone.

### 13.3 Business vocabulary layer
`lib/ai/vocabulary.ts` maps restaurant/Nigerian terminology ("takings", "covers",
"chit", "best seller", "counter", "small chops", …) to internal entities,
collections, and tools. `resolveTerm`, `matchEntities`, `suggestTools`, and
`glossary` let the Copilot translate colloquial questions into the typed tools it is
allowed to call — no collection names guessed in a prompt.

### 13.4 Standardised confidence levels
`confidenceToLevel(score)` maps the numeric `confidence` to **Very High (≥0.85) /
High (≥0.7) / Medium (≥0.5) / Low**. Every `Insight` now carries `confidenceLevel`
alongside the raw score, stamped centrally in `runDecisionEngine`.

### 13.5 AI health endpoint
`GET /api/admin/ai/health` (authenticated; staff receive 403). Verifies — **without
calling any LLM** — (1) provider configuration (Gemini/Anthropic `isConfigured`),
(2) tool-registry integrity (descriptors ⇄ implementations), (3) tenant context via
a real tenant-scoped read, and (4) the token-budget guard. Writes one `ai_usage`
record. Returns `200` for `ok`/`degraded` (missing provider key = degraded) and
`503` when a hard component is broken.

### 13.6 Integration tests — no core writes
`npm run test:ai` runs two suites (`lib/ai/__tests__/`):
- **foundation.test.ts** — 24 pure-logic checks (guardrails, ranges, confidence
  levels, provider selection, registry integrity, vocabulary).
- **no-core-writes.test.ts** — drives context assembly + decision engine + usage
  persistence + a health-style read through a **fake Firestore that records every
  write**, and asserts: exactly one collection written (`ai_usage`); **zero** writes
  to `restaurants`/`orders`/`payments`/`menu_items`/`prepared_items`/`users`/…; a
  pure read run writes nothing; and tenant isolation holds (a second seeded tenant's
  data never leaks in). The fake honours `where` filters, so isolation is proven, not
  assumed.

New seams added: `IntelligenceContext` and `TenantReader` accept an injectable
`db` (defaults to the Admin SDK) purely to enable offline testing — production
always uses the real handle.

---

## 14. Sprint 1B — Restaurant Intelligence Assistant

The first customer-facing AI feature. **Product name: "Restaurant Intelligence"**
(internally "Copilot"; centralised in `lib/ai/branding.ts`). It is a **grounded
question-answering engine, not a chatbot** — every answer is derived from the tool
layer + context builder, never from a direct DB query or a model guess.

### Flow (`lib/ai/assistant.ts` → `askAssistant`)

```
question
  → sanitizePrompt (guardrails)
  → parseRange(question)            deterministic time window (today/yesterday/week/month)
  → matchEntities/suggestTools      deterministic topics (business vocabulary)
  → buildRestaurantContext(range)   THE ONLY DATA SOURCE (tool layer + context builder)
  → runDecisionEngine(context)      deterministic candidate explanations (no LLM)
  → selectProvider("reasoning")     Claude narrates STRICTLY from the grounding…
        │                           …or a deterministic summary if no LLM is configured
  → writeUsageRecord (ai_usage)     one audit/usage doc; never a core collection
  → AssistantAnswer { answer, mode, range, groundedOn, insights, data, usage, … }
```

### Grounding guarantee
The model receives a compacted JSON of the tenant's own context + the
decision-engine insights, and a system prompt that forbids inventing any number,
item, customer, or trend, requires citing figures from the data, and instructs it
to say "I don't have that data" when a section is missing. Tests assert the prompt
contains the tenant's real figures and **never** another tenant's data.

### Graceful degradation
When no provider is configured (or the call errors / exceeds budget), the assistant
returns a **deterministic summary** composed from the trusted numbers + top
insights (`mode: "deterministic"`, `degraded: true`) instead of failing — so the
feature always answers. The endpoint returns `200` in both modes.

### Endpoint
`POST /api/admin/ai/assistant` — body `{ question }`. Auth required; managerial
surface (staff → 403); rate-limited (15/min/user) to bound cost. Returns the
`AssistantAnswer` (answer, mode, time window, `groundedOn` tools, insights, and the
full redacted context for a "sources" view).

### UI
`app/admin/[slug]/assistant/` (`AssistantClient`) — an ask box with example
prompts, per-answer chips showing the time window, whether it was an AI answer vs a
data summary, and which tools grounded it, plus the deterministic insights. Reached
from the admin sidebar ("Intelligence", owner/manager). *Backend is test-verified;
the React UI needs one manual pass in the running app.*

### Reuse
The assistant adds **no new data access and no new business rules** — it composes
the existing tools, context builder, decision engine, provider abstraction,
guardrails, and usage persistence. Injectable `provider` (like `db`) lets tests run
with a fake LLM. Tests: `lib/ai/__tests__/assistant.test.ts` (13 checks) — grounding,
tenant isolation in the prompt, range parsing, deterministic fallback, and
write-safety (only `ai_usage`).

---

## 15. Sprint 1B improvements (pre-Phase-2)

Three additions on top of the approved Assistant. All preserve the invariants:
tenant-scoped, grounded in the tool layer, writes only to `ai_usage`.

### 15.1 Conversation memory (server-stateless)
The assistant answers follow-ups ("Compare with yesterday." → "Why?" → "Which
items caused the drop?") without the user repeating the subject. Design choice:
**the client sends recent turns back** in `history` (bounded to 6, answers
truncated) — there is NO conversation collection, so the assistant stays read-only.

Two mechanisms (`lib/ai/assistant.ts`):
- **Deterministic intent carry-forward** (`resolveConversationalIntent`): if a
  question omits its own time window or subject and looks like a follow-up, it
  inherits the window/topics from the most recent prior turn that stated them.
  `detectRange` returns an explicit window or `null` (vs `parseRange` which
  defaults to today).
- **Prompt context**: prior turns are included in the model prompt so the LLM
  resolves references ("why", "them", "compare"). The system prompt instructs it
  to use the earlier conversation. Grounding is still freshly fetched for the
  resolved window, so answers never drift from the data.

### 15.2 Quick Actions
`lib/ai/quick-actions.ts` — a pure, client-safe catalog of one-click prompts
(Revenue Today, Revenue This Week, Top Selling Meals, Inventory Health, Kitchen
Performance, Customer Retention, Staff Performance). Each is a canned question
routed through the normal assistant endpoint (same grounding/guardrails). The
assistant UI renders them as the empty-state instead of a blank box.

### 15.3 Explain Dashboard architecture (reusable scaffold)
Any dashboard widget can expose an "Explain" action. The reusable contract:

```
<ExplainButton widget="revenue" data={cardSnapshot} />
   → POST /api/admin/ai/explain { widget, range?, clientData? }
   → explainWidget(slug, widget)
        → WIDGET_REGISTRY[widget].run(ctx, range)   // RE-FETCH authoritative data via tools
        → narrate in plain business language          // clientData is reconciled, NOT trusted
        → writeUsageRecord (ai_usage)
```

`lib/ai/explain.ts` holds `WIDGET_REGISTRY` (revenue, todayOrders, topItems,
inventory, kitchen, customers, staff, salesByHour, menu) mapping each widget to
the tool that authoritatively backs it, plus a deterministic fallback. **Key
safety property:** the client's displayed number is only a hint; the explanation
is grounded in a fresh tool fetch, so a tampered/ stale client value can't drive
the answer. Adding Explain to a new card = one registry entry + drop the
`<ExplainButton>` component on. (Scaffold only this sprint — individual cards
adopt it incrementally; `ExplainButton` lives in
`app/admin/[slug]/components/`.)

### Shared narration
`lib/ai/narration.ts` (`narrate`) centralises provider selection + budget +
error handling + deterministic fallback; the Assistant, Explain, and the future
Daily Brief all use it. Tests: `lib/ai/__tests__/improvements.test.ts` (12 checks)
cover follow-up intent, quick-action integrity, and explain grounding/isolation/
write-safety. Full suite: `npm run test:ai` = 59 checks.

---

## 16. Phase 2 — Daily AI Brief

Makes RestoFlow **proactive**: a morning brief is generated per restaurant on a
schedule and cached, so the dashboard shows it instantly with no LLM on the
request path. Built entirely on the foundation — no duplicated business logic.

### Generation (`lib/ai/brief.ts` → `generateBrief`)
```
generateBrief(slug)                     // window defaults to "yesterday" (last complete day)
  → cost control: if today's brief is already complete → return it (no LLM)
  → transactional "generating" lock      // dedupes concurrent generation (BriefBusyError)
  → buildRestaurantContext(yesterday)    // tool layer = the only data source
  → runDecisionEngine                    // highlights / recommendations / anomalies (deterministic)
  → narrate                              // prose summary (LLM) or deterministic fallback
  → write ai_briefs (complete) + ai_usage
```
The brief content: `summary` (prose), `highlights`, `recommendations`,
`anomalies`, `metrics` (headline numbers), `confidence`/`confidenceLevel`,
`generatedAt`, `restaurantId`, `timeWindow`, `modelUsed`, `mode`, `degraded`,
`status`, `version`, `usage`. Highlights/recommendations/anomalies come from the
decision engine (deterministic); only the prose summary uses the LLM.

### Collection: `ai_briefs`
Doc id `${slug}:${dateKey}` where `dateKey` is the Africa/Lagos calendar day.
`firestore.rules`: client read/write denied (server/Admin-SDK only), like
`ai_usage`. Served to the UI via the API, never read client-side.

### Scheduler (Vercel Cron)
`vercel.json` → `{ path: "/api/cron/ai-brief", schedule: "0 6 * * *" }` (06:00 UTC
= 07:00 WAT). `app/api/cron/ai-brief/route.ts`:
- Guarded by `CRON_SECRET` (`Authorization: Bearer …`).
- Reads `restaurants` (read-only), filters to operational subscriptions.
- Generates each brief with **bounded concurrency (3)**; per-tenant failures
  isolated; **skips restaurants whose brief already exists today** (cost control).
- Off the customer/POS request path entirely.

### Routes
- `GET  /api/admin/ai/brief` — today's cached brief (instant Firestore read, **no LLM**). Managerial; staff 403.
- `POST /api/admin/ai/brief` — manual refresh (owner/manager), `force: true`, rate-limited; returns `409` if a generation is already in flight.
- `GET  /api/cron/ai-brief` — Vercel Cron entrypoint (secret-guarded).

### Dashboard card
`app/admin/[slug]/dashboard/AiBriefCard.tsx` — loads the cached brief via `GET`
on mount (no LLM), renders summary + metrics + recommendations + anomalies +
highlights + confidence, with a Refresh/Generate button for owner/manager. Wired
into `DashboardClient` above the stats grid (hidden for staff).

### Safety invariants (all preserved)
Tenant-scoped; business data read-only; writes only to `ai_briefs` + `ai_usage`;
graceful degradation + deterministic fallback (brief still generates with no LLM,
`mode: "deterministic"`); token budget via `narrate`; no change to any production
workflow.

### ⚠️ Deployment requirements
1. Set **`CRON_SECRET`** in Vercel — without it the cron route runs unguarded (anyone could trigger generation for all tenants). Also set an AI provider key (`ANTHROPIC_API_KEY`/`GEMINI_API_KEY`) for AI-mode briefs; otherwise briefs are deterministic.
2. Deploy the updated **`firestore.rules`** (adds the `ai_briefs` deny-to-client block).
3. `vercel.json` cron is picked up on deploy; adjust the schedule/timezone if 07:00 WAT isn't desired.

Tests: `lib/ai/__tests__/brief.test.ts` (12 checks) — grounded generation, tenant
isolation, cost-control skip, force-refresh, concurrency dedupe, deterministic
fallback, write-safety. Full suite: `npm run test:ai` = **71 checks**.

---

## 17. Phase 3 — Recommendations Engine

Turns insights into **specific, actionable recommendations** ("raise Jollof Rice
by ₦200", "add staff 12–2pm", "bundle X with Y", "re-enable Z"). The DECISION is
deterministic (rules in code, no LLM), grounded only in the tool layer — and each
recommendation carries a structured `action` so the future **Automation** phase can
execute an approved one without re-parsing prose.

### Engine (`lib/ai/recommendations.ts`)
Deterministic rules over the assembled context (default window: week):
- **price_increase** — top seller + high volume + low cancellations → suggest a rounded ₦ uplift (`currentPrice`/`suggestedPrice`/`delta`).
- **staffing** — a 2-hour window holding ≥22% of orders → staff that peak (stronger if prep time is already high).
- **bundle** — a never-sold item + the best seller → combo suggestion.
- **reenable_item** — an unavailable menu item → restock/re-enable (highest priority; lost sales).
- **promote_item** — an available but barely-selling item → promote/discount.
- **loyalty** — low repeat rate + loyalty off → enable rewards.

Each recommendation: `id` (stable, `type:target`), `title`, `rationale`,
`expectedImpact`, `action`, `confidence`/`confidenceLevel`, `priority`, `status`.

### Lifecycle & persistence (`ai_recommendations`)
Doc id `${slug}:${rec.id}`. On (re)generation: candidates are upserted, an owner's
**accept/dismiss/snooze status is preserved** across regenerations, and previously-
"new" recs that no longer apply are marked **expired**. Cost control: today's set is
returned as-is unless `force`. `firestore.rules`: client-denied, server-only.

### Routes
- `GET  /api/admin/ai/recommendations` — active set (cached read).
- `POST /api/admin/ai/recommendations` — generate/refresh (`{force}`), rate-limited.
- `PATCH /api/admin/ai/recommendations/[id]` — accept/dismiss/snooze (tenant re-verified; won't cross tenants).

### Dashboard
`RecommendationsCard.tsx` — lists recs with per-item Accept/Dismiss; generates once
if empty (deterministic, no LLM); Refresh regenerates. Wired below the brief card
(owner/manager).

### Safety
Deterministic (no LLM, near-zero cost) · tenant-scoped · business data read-only ·
writes only `ai_recommendations` + `ai_usage` · status updates re-verify ownership.
Tests: `lib/ai/__tests__/recommendations.test.ts` (12) — rule outputs, priority
ranking, status persistence, cost-control skip, cross-tenant guard, write-safety.
Full suite: `npm run test:ai` = **83 checks**.
```

## 18. Phase 4 — Forecasting Engine

Answers **"what will happen next?"** — and, crucially, **why** — with confidence
scores. Its defining constraint: it **consumes the existing layers and duplicates
no business logic**.

### What it consumes (no duplicate logic)
- **Restaurant Context** (`buildRestaurantContext`, window: week) — current state, top items, sales-by-hour, revenue summary.
- **Decision Engine** (`runDecisionEngine`) — its trend/anomaly/warning insights become the forecast's **"why" drivers** (type `insight`).
- **Recommendation Engine** (`listRecommendations`) — active recs are **linked** to the item demand they affect, and surface as a `recommendation` driver.
- **Tool layer** — the historical daily series is bucketed from `ctx.getOrders` using the shared `isRevenueOrder` rule; the revenue rule is **not** re-implemented.

The **only** new computation is the statistical projection over the historical
series: trailing average + dampened week-over-week trend + variance-based interval
+ day-of-week seasonality. Deterministic (no LLM) → near-zero cost.

### Engine (`lib/ai/forecasting.ts`)
- `buildDailySeries` — buckets 28 days of orders into **completed** Lagos days (today's partial day excluded; leading empty days before the first order are not fabricated, so new restaurants aren't unfairly averaged).
- `windowStats` — mean, coefficient of variation, recent-vs-prior-half trend.
- Produces `Forecast`: `revenue`/`orders` `ForecastPoint`s (predicted + `[low, high]` interval, `next_7_days`), `itemDemand[]` (per-item `expectedUnitsNext7`/`expectedUnitsPerDay` — the structured input **Smart Purchasing** consumes), `peakWindows[]` (the input **Automation** consumes for staffing), `drivers[]` (baseline / trend / seasonality / insight / recommendation), and `confidence` + `confidenceLevel`.
- Confidence scales with history depth (~2 weeks → full marks) and revenue stability.

### Persistence (`ai_forecasts`)
Doc id `${slug}:${dateKey}`. Cost control: today's forecast is returned as-is unless
`force`. `firestore.rules`: client-denied, server-only.

### Routes
- `GET  /api/admin/ai/forecast` — today's cached forecast (no computation).
- `POST /api/admin/ai/forecast` — generate/refresh (`{force}`), rate-limited, owner/manager.

### Dashboard
`ForecastCard.tsx` — 7-day revenue & orders outlook (with range), expected peak
window, per-item demand ("what to prep/buy"), and the "why" drivers. Generates once
if empty; Refresh regenerates. Wired below the recommendations card (owner/manager).

### Downstream contract
`itemDemand[].expectedUnitsNext7` → Smart Purchasing (Phase 5) buy/prep quantities.
`peakWindows[]` + `revenue`/`orders` points → Automation (Phase 6). `relatedRecommendationIds`
keep forecasts and planned actions coherent.

### Safety
Deterministic (no LLM) · tenant-scoped · business data read-only · writes only
`ai_forecasts` + `ai_usage` · reads re-verify ownership (`assertTenant`).
Tests: `lib/ai/__tests__/forecast.test.ts` (13) — projection shape & interval,
confidence, WHY drivers, item-demand for Smart Purchasing, peak windows, recommendation
linking, cost-control skip, tenant isolation, write-safety.
Full suite: `npm run test:ai` = **96 checks**.

## 19. Phase 5 — Smart Purchasing

Converts forecasted demand into a concrete **purchasing & preparation plan** —
closing the operational loop:

```
what happened (Brief) → what to do (Recommendations) → what's next (Forecast)
  → what to buy & prep (Smart Purchasing) → execute (Automation)
```

### Architecture — the Demand Translator seam
```
Menu Item Demand ──▶ [RecipeResolver?] ──▶ Demand Translator ──▶ Purchasing Plan
                       (future Recipe Engine)   (STABLE)
```
- **Today**: no `RecipeResolver`, so `ingredientDemand` is undefined and the plan is **menu-item granular** — prep batches, LOW/MEDIUM/HIGH reorder signals, peak-production timing — with **zero owner setup**.
- **Later**: a Recipe Engine implements `RecipeResolver` (menu demand → bill-of-materials → ingredient demand) and is injected **below** the translator. Nothing above it changes — not Forecasting/Recommendation/Decision/Context, not the public purchasing API, not the output shape. `ingredientDemand` simply becomes populated. This is proven by a test that injects a fake resolver and asserts the menu plan is byte-identical while ingredient lines appear.

### Engine (`lib/ai/purchasing.ts`)
- **Consumes** the Forecasting Engine (`getForecast`/`generateForecast` — the demand source) and the Recommendation Engine (`generateRecommendations` — restock/promo signals). No duplicated business logic.
- `buildMenuDemand` merges forecast `itemDemand` with recommendation signals: `reenable_item` → `unavailable` (added to the plan even with zero recent sales), `promote_item` → `promoted`.
- `menuDemandTranslator` (the stable `DemandTranslator`) → `MenuPurchaseLine[]`: `preparationBatches` (ceil of per-day demand over a `BATCH_UNITS` heuristic), `reorderSignal` (volume rank + trend, forced HIGH when unavailable), `peakWindow`, deterministic `guidance`. Lines sort HIGH-first.
- `RecipeResolver` seam + optional `ingredientDemand` on the plan (`IngredientPurchaseLine`: required qty, on-hand, `reorderQuantity = max(0, required − onHand)`, supplier, signal).
- Confidence/degraded inherited from the forecast (a plan is only as good as its forecast); `basedOnForecastAt` records provenance.

### Persistence (`ai_purchase_plans`)
Doc id `${slug}:${dateKey}`. Cost control: today's plan returned as-is unless `force`.
`firestore.rules`: client-denied, server-only.

### Routes
- `GET  /api/admin/ai/purchasing` — today's cached plan (no computation).
- `POST /api/admin/ai/purchasing` — generate/refresh (`{force}`), rate-limited, owner/manager.

### Dashboard
`PurchasingCard.tsx` — summary, peak-prep window, per-item lines with a colour-coded
LOW/MED/HIGH reorder chip + guidance + expected units/batches, and a note that
ingredient-level planning unlocks with recipes. Wired below the forecast card.

### Downstream contract
Item-level plan is ready for **Automation** (Phase 6) to act on (prep schedules,
low-stock alerts, execute approved restock recs). `ingredientDemand` becomes the
supplier-purchasing feed the moment a Recipe Engine exists — no rewiring above the translator.

### Safety
Deterministic (no LLM) · tenant-scoped · business data read-only · writes only
`ai_purchase_plans` + `ai_usage` (plus the forecast/recs it generates on demand) ·
reads re-verify ownership (`assertTenant`).
Tests: `lib/ai/__tests__/purchasing.test.ts` (13) — menu plan shape, reorder signals,
HIGH restock for unavailable items, HIGH-first sort, ingredient-off-by-default, the
RecipeResolver extension-point contract, translator purity, cost-control skip, tenant
isolation, write-safety.
Full suite: `npm run test:ai` = **109 checks**.

## 20. Phase 6 — AI Automation

The orchestration layer that **executes** approved decisions — the first and only
part of the AI system permitted to cause side effects, under strict control.

### Invariants (all enforced by tests)
- **Approval-first**: an automation is created only from an APPROVED source — an
  `accepted` recommendation or a HIGH Smart-Purchasing line. Non-approved sources are
  refused. **Execution requires the owner to have enabled a rule** for that capability;
  with no enabled rule, execution throws `AutomationDisabledError` and writes no record.
- **Consumes, never re-computes**: reads `ai_recommendations` / `ai_purchase_plans`; the
  Recommendation/Forecasting/Purchasing engines keep the judgement. No duplicated logic.
- **Fully auditable**: every execution writes an `ai_automation_executions` record with
  actor, start/finish timestamps, source, status, attempt count, error, and rollback info.
- **Write-safe**: the engine writes ONLY `ai_automation_rules`, `ai_automations`,
  `ai_automation_executions`, `ai_usage`. **Handlers receive no Firestore handle** — they
  cannot mutate business data. Core collections stay read-only.

### Pluggable handlers (the integration seam)
```
approved source ─▶ Automation ─▶ [rule enabled?] ─▶ ActionHandler.execute ─▶ audited record
```
`ActionHandler { kind, reversible, mutatesCore, validate, execute, rollback? }` is the
standardized contract. Integrations (WhatsApp, email, suppliers, POS, staff scheduling,
inventory) register by `kind` — their logic lives in the handler, never in the engines.
Shipped handlers (safe, no external send, no core mutation):
- `notify` — records a notification (owner/staff to-do) as an execution record (outbox). A real WhatsApp/email handler replaces it under the same `kind`.
- `purchase_order_draft` — drafts a restock order (item/qty/supplier) from a HIGH purchasing line; reversible. A real supplier handler plugs in later.

### Engine (`lib/ai/automation.ts`)
- Rules: `getAutomationRule` (defaults disabled), `listAutomationRules`, `setAutomationRule`.
- Create: `createAutomationFromRecommendation` (requires `accepted`), `createAutomationFromPurchasingLine` (requires HIGH). Idempotent by stable id (`recommendation:${recId}` / `purchasing:${dateKey}:${item}`).
- Execute: `executeAutomation` — approval gate → validate → `execute` with **retries** (`MAX_ATTEMPTS`) → one audit record with final status + attempt count → automation status `succeeded`/`failed`.
- Reverse: `rollbackExecution` — reversible handlers only; records `rollback {rolledBackAt, by, detail}` on the audit trail and sets the automation `rolled_back`.
- Registry is injectable (`opts.handlers`) so real integrations and test fakes plug in.

### Route
`/api/admin/ai/automation` — `GET` (rules, automations, executions, handler kinds);
`POST` dispatches `set_rule` / `create_from_recommendation` / `create_from_purchasing` /
`execute` / `rollback`. Owner/manager only, rate-limited. `AutomationDisabledError` /
`AutomationNotApprovedError` → 409; `AutomationStateError` → 400.

### Dashboard
`AutomationCard.tsx` — approval-first control center: capability toggles (rules, default
off), accepted recommendations offered as "Automate", per-automation Run/Undo, and status
chips backed by the audit trail. Wired below the purchasing card.

### Safety
Deterministic control flow · tenant-scoped (every read re-verifies ownership) · handlers
cannot write Firestore · writes only `ai_automation_*` + `ai_usage`.
Tests: `lib/ai/__tests__/automation.test.ts` (13) — approval-first creation & execution
gates, full audit record, retry, failure, unknown-handler, rollback, non-reversible guard,
tenant isolation, write-safety.
Full suite: `npm run test:ai` = **122 checks**.

---

**The AI operating system is now complete end-to-end:**
Brief (what happened) → Recommendations (what to do) → Forecasting (what's next) →
Smart Purchasing (what to buy & prep) → **Automation (do it, with approval + audit)**.
Future integrations snap into the `ActionHandler` and `RecipeResolver` seams without
touching the engines.
