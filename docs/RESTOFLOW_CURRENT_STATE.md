# RestoFlow Current State

Living status of every capability. **Last reconciled: 2026-09-12**, by reading
the code and querying staging — not from prior reports.

Legend: ✅ COMPLETE · 🟡 PARTIAL · ⬜ NOT STARTED · 🔄 SUPERSEDED · 🚫 BLOCKED

Repos: `rest` (Next.js backend, admin, storefront) · `restoflow-customer` (Expo
customer app) · `pack_delivery` (Dispatcher).

---

## WS1 · Customer Marketplace

| Capability | Status | Evidence | Remaining | Next action |
|---|---|---|---|---|
| Customer Home | ✅ | `app/(tabs)/index.tsx` — Deliver-to header, "What are you craving?", Featured / Near you / Fast delivery / Popular right now / Offers | Order Again and New on RestoFlow sections | — |
| Search | ✅ | `app/(tabs)/search.tsx`; `/api/mobile/v1/search` | — | — |
| Orders | ✅ | `app/(tabs)/orders.tsx`; `/api/mobile/v1/orders` | — | — |
| Favourites | ✅ | `app/(tabs)/favourites.tsx`; `/api/mobile/v1/me/favourites` | — | — |
| Account | ✅ | `app/(tabs)/account.tsx` | — | — |
| Address / location handling | ✅ | `app/addresses.tsx`; `customers/{uid}/addresses`; address-first, no forced GPS | — | — |
| Restaurant storefront | ✅ | `app/restaurant/[slug].tsx` | — | — |
| Menu categories & modifiers | ✅ | Size/protein/extras/instructions; option pricing verified against server | — | — |
| One-restaurant cart | ✅ | `src/state/cart.ts` returns `kind:"conflict"`; prompt wired at `app/restaurant/[slug].tsx:333` | — | — |
| Checkout & payment | ✅ | `app/checkout.tsx` → `/api/mobile/v1/orders` → Paystack; server-authoritative totals | — | — |
| Post-payment tracking | ✅ | `app/order/[id].tsx`; six stages; map/ETA gated by stage; verified on hardware | — | — |
| Discovery ranking reaching the app | 🟡 | App feed uses `lib/marketplace/discovery.ts` → `menu_items` directly, **not** `lib/discovery/*` | Converge the two paths | **Decide** which discovery path is canonical |
| Reorder / Order Again | ⬜ | Order history exists; no reorder action | Reorder from a past order | — |
| Ratings & reviews | ⬜ | `rating` is a named ranking signal pinned at 0 — reserved slot, no data source | Order-verified reviews | — |
| Report a problem / support | ⬜ | No support route after delivery | Problem reporting | — |
| Order chat | ⬜ | `canMessageCourier: false` returned honestly; Dispatcher has `integration/chat.js` unmounted | Partner endpoint + app UI | — |
| Masked calling | ⬜ | `canCallCourier: false`; contract carries an opaque `contactHandle` | Masking provider | — |

## WS2 · Restaurant Commerce

| Capability | Status | Evidence | Remaining | Next action |
|---|---|---|---|---|
| Marketplace order handling | ✅ | `app/admin/[slug]/orders/` — accept / reject / preparing / ready; rider pickup code on the card | — | — |
| Menus & modifiers | ✅ | `menu_items` with `marketplace.options`; category normalisation in `lib/menu-utils.ts` | — | — |
| Merchant mobile / PWA | ✅ | Installable; manifest scoped to the restaurant's own orders board | — | — |
| Full-RestoFlow restaurant integration | ✅ | Marketplace orders enter the normal admin workflow | — | — |
| Prep-time accuracy & history | ⬜ | `prepMins` is a static per-restaurant config | Measure actual prep vs promised | Needed by WS5.2 |

## WS3 · Partner Models & RestoFlow Connect

| Capability | Status | Evidence | Remaining | Next action |
|---|---|---|---|---|
| Marketplace Partner mode | ⬜ | No partner mode in `lib/marketplace/config.ts`; every marketplace restaurant is a full RestoFlow restaurant | Simplified merchant interface | — |
| RestoFlow Connect (delivery-only) | ⬜ | No request-courier surface. `requestDeliveryForOrder` requires a paid marketplace order | Standalone courier request | — |
| Partner / Enterprise API | ⬜ | No `app/api/partner` or versioned public API | Keys, quotas, idempotency | — |

## WS4 · Payments, Payable & Settlement

| Capability | Status | Evidence | Remaining | Next action |
|---|---|---|---|---|
| Customer payments | ✅ | Intent → webhook → order; reconciliation sweep; idempotent under replay | — | — |
| Restaurant payable & revenue | ✅ | `marketplace_ledger_entries`, 5 entries per order summing to 0 | — | — |
| Settlement state machine | ✅ | `lib/marketplace/settlement.ts` — CALCULATED→APPROVED→PAYOUT_PENDING→PAID, human gate, payout-as-reservation | — | — |
| Payout execution | ⬜ | No provider adapter; no route or cron calls it; no Paystack Transfer anywhere | Adapter behind the existing gate | **WS4.3** |
| Statements & reconciliation views | ⬜ | Ledger exists; nothing surfaces it to a restaurant or courier partner | Partner-facing statements | — |
| Provider abstraction | 🔄 | Paystack only, called directly at 10 sites. No default-provider concept exists — superseded by "one processor" | Revisit only if a second processor is needed | — |

## WS5 · Dispatcher Logistics

| Capability | Status | Evidence | Remaining | Next action |
|---|---|---|---|---|
| Delivery integration | ✅ | Acceptance-gated handoff; 0 jobs before acceptance; released at acceptance; verified on physical devices | — | — |
| Handover codes | ✅ | Pickup code to restaurant, receiving code to customer; each stored where only its audience can read it | — | — |
| Rider board security | ✅ | `/deliveries/active` requires an approved rider; anonymous → 401; 9 authorization tests | — | — |
| Tracking & timestamps | ✅ | `pickedUpAt` / `deliveredAt` real and ordered on hardware runs | — | — |
| Smart dispatch timing | 🔄 | `computeConfirmAt()` exists and is stored as `deliveryConfirmAt`, but release is now immediate at acceptance; the confirm sweep is a safety net | Re-enable timed release once prep history exists | Depends on WS2 prep history |
| Delivery exceptions | 🟡 | States exist in the contract (`REASSIGNING`, `DELIVERY_FAILED`, `CUSTOMER_UNREACHABLE`); customer-facing stories unproven | Exercise and design the customer copy | — |

## WS6 · Platform Operations

| Capability | Status | Evidence | Remaining | Next action |
|---|---|---|---|---|
| Marketplace notification delivery | 🚫 | 6 entries enqueued per order; `drainOutbox` is called **only in tests**; no adapter, no cron | Ports implemented + scheduled drain | **WS6.1** |
| Storefront SMS notifications | 🚫 | Wired into 4 live routes, but `lib/customer-notifications.ts:70` builds `/track/{id}` with no `?t=`, and `app/track/[orderId]/page.tsx:19` 404s without it | Append the token | **WS6.1 — one line** |
| Customer push notifications | ⬜ | No `expo-notifications` in the customer app | Device registration + delivery | — |
| Discovery engine | 🟡 | `lib/discovery/*` complete: geo, taxonomy, ranking, popularity, indexer; `/discover` live (HTTP 200) | Index is empty | **WS6.2** |
| Discovery scheduled jobs | 🚫 | `scripts/discovery-{backfill,geocode,popularity}.ts` are manual CLI only; crons are `ai-brief` and `marketplace` only | Promote to cron routes | **WS6.2** |
| Discovery index population | 🚫 | `/api/discovery/categories` → `{"facets":[],"total":0}` on staging | First real backfill | Blocked by scheduled jobs |
| Geolocation coverage | 🟡 | Geocoding and geohash built; backfill script exists | Coverage across real restaurants unmeasured | — |
| Computed popularity | 🟡 | Computed from `orders`; ranking explicitly refuses owner-typed vanity fields | Refresh job unscheduled | — |
| Staging/production isolation | ✅ | Separate Firebase projects, separate bundle ids, fail-loud guards, 8 isolation tests | — | — |
| Dispatcher deploy automation | 🟡 | `scp` + `pm2 restart`; host git remote is a local path | Real pipeline | **WS6.3** |
| `SENDGRID_API_KEY` on staging | 🚫 | Unset; no account can self-verify email | Provision a sandbox key | **WS6.3** |
| Observability | ⬜ | Nothing alerts when a subsystem silently stops | — | — |

---

## The pattern worth naming

Three finished, tested subsystems are each **one wiring job** from being useful:
the notification outbox has no drain, the discovery index has no scheduled job,
and settlement has no payout adapter. Plus one live customer-facing bug — every
SMS tracking link 404s. None of this is missing architecture; it is missing
connection.
