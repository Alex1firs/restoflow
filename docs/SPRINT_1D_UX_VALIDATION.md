# Sprint 1D — Production UX Validation

Goal: prove the approved AI work (Assistant, Quick Actions, conversation memory,
Explain) feels good in the actual product. **No new backend/AI** — one small UI
wiring change (Explain on the Revenue card) plus hands-on validation.

## Code change in this sprint
- `DashboardClient.tsx` — the **Today's Revenue** stat card now shows a small
  "✨ Explain" action (owner/manager only). `StatCard` gained an optional
  `explain` slot; the button is `<ExplainButton widget="revenue" range="today" …/>`.
  This is the first real adoption of the Explain scaffold — a template for every
  other card.

## Automated evidence (already collected)
Dev server (`npm run dev`, Next 16 / Turbopack) booted clean and every new route
compiled and enforced auth:

| Route | Method | Unauthenticated result |
|---|---|---|
| `/api/admin/ai/assistant` | POST | `401 {"error":"Unauthorized"}` |
| `/api/admin/ai/explain` | POST | `401 {"error":"Unauthorized"}` |
| `/api/admin/ai/health` | GET | `401` |
| `/admin/{slug}/assistant` | GET | `307` → `/admin/login` |
| `/admin/login` | GET | `200` |

Plus `npm run test:ai` = **59 checks** green. This proves the code is wired and
safe; it does **not** prove the logged-in UX — that's the manual pass below.

## ⚠️ Production-data caveat
`.env.local` points the dev server at the **live production Firebase**. Validating
authed flows will read real orders and write `ai_usage` records (the AI layer never
writes core collections). Prefer a **test/staging restaurant account** or a quiet
period. Do not run destructive actions.

## How to run locally
```bash
npm run dev            # http://localhost:3000
# log in at /admin/login with a restaurant account (owner or manager)
```

---

## Manual validation checklist

### 1. Explain on the Revenue card
1. Go to `/admin/{slug}/dashboard`.
2. On **Today's Revenue**, click **✨ Explain**.
3. Expect: a popover shows a spinner ("Analysing…"), then a 2–4 sentence
   plain-language explanation citing the real ₦ figure (or a deterministic summary
   if no AI key). Close with ✕.
4. Edge: as a **staff** user, the Explain button should NOT appear.
   📸 *Screenshot: card with Explain open.*

### 2. Quick Actions
1. Go to `/admin/{slug}/assistant` (sidebar → **Intelligence**).
2. Empty state should show a grid of one-click actions (Revenue Today, Revenue This
   Week, Top Selling Meals, Inventory Health, Kitchen Performance, Customer
   Retention, Staff Performance).
3. Click **Revenue Today** → an answer appears with the time-window chip, an
   AI/Data-summary badge, the tools it used, and insights.
   📸 *Screenshot: empty state with Quick Actions; and one answered.*

### 3. Follow-up conversation (the key test)
Ask these in sequence, without re-stating the subject:
1. `How much did we make today?`
2. `Compare with yesterday.`
3. `Why?`
4. `Which menu items caused the drop?`

Expect: each answer builds on the last. #2 compares today vs yesterday; #3 explains
using deterministic insights; #4 stays on the yesterday window and talks about menu
items. Watch the time-window chip change appropriately (today → yesterday →
yesterday → yesterday).
📸 *Screenshot: the full 4-message thread.*

### 4. Loading / empty / error states
- **Loading:** the Ask button shows a spinner; Explain shows "Analysing…".
- **Empty:** a brand-new/quiet restaurant → the assistant should say it doesn't have
  data for the period (not invent numbers); Explain deterministic fallback reads
  cleanly.
- **Error:** temporarily stop the network (or set an invalid AI key) → the assistant
  should still answer in **Data summary** mode (degraded), never a blank crash.
  Rate limit: click a Quick Action ~16×/min → a friendly "slow down" message (429).
  📸 *Screenshots: loading spinner; empty-data answer; degraded/data-summary badge.*

### 5. Real account
Do the above signed in as a real (ideally test) restaurant with actual orders, so
the numbers are meaningful and match the Reports page.

### 6. Screenshots to collect
- [ ] Dashboard Revenue card with Explain popover open
- [ ] Assistant empty state (Quick Actions grid)
- [ ] A single answered Quick Action (chips + insights visible)
- [ ] The 4-message follow-up thread
- [ ] A loading state (spinner)
- [ ] An empty-data or degraded ("Data summary") answer

---

## Sign-off
- [ ] Explain works on Revenue card (owner/manager), hidden for staff
- [ ] Quick Actions answer correctly
- [ ] Follow-up conversation maintains context across all 4 turns
- [ ] Loading / empty / error states behave gracefully
- [ ] Numbers match the Reports page for the same window
- [ ] Screenshots collected
