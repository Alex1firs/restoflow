# RestoFlow Current State

Living status of every capability. **Last reconciled: 2026-09-14** (WS6.1, WS6.2), by
reading the code and querying staging — not from prior reports.

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
| Discovery ranking reaching the app | ✅ | `/feed` and `/search` read `discovery_restaurants` / `discovery_dishes`; `lib/marketplace/search.ts` **deleted** rather than maintained alongside. Parity asserted before retirement | — | — |
| Customer Discovery Integration | ✅ | **COMPLETE — staging physical regression PASSED on hardware 2026-09-14.** Discovery → cart → payment → restaurant acceptance → **exactly one** Dispatcher job (`-P1Tpjw6R1R66xa1VGeb`, order `B11sR5FdUR77nNOlO1ih`, `sequence: 1`). Rider completion **not repeated**: the QA rider's genuine GPS was 366.5 km from the synthetic Lekki pickup, and the run was not manufactured by moving the restaurant, faking GPS or widening the radius. That leg was already proven on hardware 2026-09-12 and discovery changed no rider code | — | — |
| Order Again (discovery) | ✅ | Feed section from genuine `orders` history; empty and hidden without it, and never resurrects an out-of-range restaurant | Re-adding a past basket in one tap | — |
| Restaurant deliverability | ✅ | `deliveryRadiusKm` is enforced. Was configured (5 km / 15 km on staging) and read by nothing — the platform offered every restaurant to everyone | — | — |
| Zero-coverage address | ✅ | Approved empty state on Home and Search with "Change address"; proven from Abuja against Lagos restaurants | — | — |
| Opening state honesty | ✅ | Missing hours are **unknown**, never Open — and never Closed either. `checkIsOpen` keeps its lenient behaviour for the storefront | Hours should become required marketplace information | — |
| Local Favourites | ⬜ | Deliberately hidden. Needs long-term local repeat ordering — a different signal from Popular Around You, not a second view of it | A distinguishing signal | — |
| New on RestoFlow | ⬜ | Deliberately hidden. No restaurant has a marketplace publication timestamp, and `createdAt` is absent on 3/3 | A genuine publication date | — |
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
| RestoFlow Connect — foundation | ✅ **COMPLETE / VERIFIED ON STAGING** | `connect` capability on the existing tenant (two switches: super-admin approval **and** a configured margin, no default); `connect_deliveries` / `connect_handover` / `connect_ledger_entries`, all deny-all in rules; session-derived tenant scoping; super-admin activation route; indexes deployed | — | — |
| RestoFlow Connect — quote → payment → Dispatcher | ✅ **COMPLETE / VERIFIED ON STAGING** | `lib/connect/service.ts` over the proven Dispatcher client/contract. Staging: cost ₦850 + 10% test margin = ₦935; Dispatcher sent ₦850 only; replay returned one job; expired quote → 409; ledger balanced; job stamped `restoflow_connect` | — | — |
| Connect margin | ✅ | Per-partner basis points, no default. Staging uses 10% flagged `marginIsTest`; **production refuses a test-flagged margin**, so a verification value cannot become a commercial rate | Set real commercial rates before any production partner | Owner decision |
| Connect — customer-paid and restaurant-paid | ✅ **BOTH VERIFIED** | **Verified end to end on staging with real Paystack TEST payments, 2026-09-14.** No wallet. Payer chosen per delivery; platform-collected, no subaccount split; dispatch happens inside the webhook so a courier is never engaged against uncleared money. Customer-paid (`cn_8767affb…`) and restaurant-paid (`cn_21fad249…`): one payment each, one Connect delivery, one Dispatcher job, ledger `+93,500 / −85,000 / −8,500` = 0, `payer` correct, no marketplace order, link transitioned to tracking. Signed webhook replay changed nothing; a wrong signature → 401 | — | — |
| Connect — refund execution | ✅ **VERIFIED** | **Verified on staging with a genuine definitive non-fulfilment** (`cn_17d543d5…`): the Connect Dispatcher partner was deactivated so the create was really refused → `payment_held_unfulfilled`, **no automatic refund**. After reactivation, reconciliation proved 0 Dispatcher jobs → one refund → Paystack accepted (`18271222`) → replay returned `alreadyRefunded`, **no second refund**. Ledger nets to 0 across 6 entries, both events preserved | Paystack settlement is **asynchronous**: the provider's own status is persisted beside ours, and ours follows it rather than declaring success on acceptance | — |
| Connect refunds | 🟡 | Paystack refund adapter built; one obligation per payment claimed by compare-and-set; provider "already refunded" treated as success. Ambiguous Dispatcher results reconcile by `externalOrderId` before any retry or refund | Unexercised against a real payment | Same test checkout |
| Connect guest pay/track page | ✅ | `/d/{id}?t={token}` — mobile-first, restaurant-led, "Delivery powered by RestoFlow", no Dispatcher anywhere, receiving code withheld until `PICKED_UP`/`EN_ROUTE`/`ARRIVING`. Live: 200 with token, **404** without | — | — |
| Connect merchant UI / tracking / cancellation | ⬜ | Deliberately not started — foundation only, pending approval | Slices 3–6 | Owner approval |
| Dispatcher partner classification | ✅ | Was hardcoded to the marketplace; now derived from the authenticated client, and the webhook emitter resolves each job's callback from its own partner record. Records without a `partner` field remain marketplace, so existing behaviour is unchanged | Deploy to the production Dispatcher with the rest of 6.3a | **WS6.3** |
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
| Rider job visibility radius | 🟡 | **FIXED AND VERIFIED ON STAGING (2026-09-14). Production rollout pending.** `systemSettings/deliveryRadius` governs; the server enforces it against `users/<uid>/liveLocation` from the verified token; `lat`/`lng`/`radiusKm` are no longer read from the query string. The app defers to `eligibilityEnforced` and its fallback reads the same setting, never a constant. Staging: 5 km → empty board, spoofed `radiusKm=1000` → ignored, admin 400 km → same job offered to the same real GPS | **Production rollout.** Deployment order is mandatory: the production delivery service must enforce **before** the app stops filtering. Ship the app first and production riders see every job nationwide | **WS6.3** |
| Staging credential contamination | ✅ | **FIXED in the staging working copy and runtime.** Two production service accounts (`pack-delivery-live`, `pack-delivery`) were sitting unused in the staging service directory; removed, and `staging-bootstrap.js` now refuses to start while any production credential is merely present. Deployed staging was already clean | Does **not** close the live credential risk — see the row below | — |
| Tracking & timestamps | ✅ | `pickedUpAt` / `deliveredAt` real and ordered on hardware runs | — | — |
| "Food is on the way" message | ✅ | Was wired to `PICKED_UP`, which no live delivery reaches — the rider app's pickup maps to `EN_ROUTE_TO_CUSTOMER`. That state now notifies; a test holds the push list and the tracking copy's `notify` flag in agreement | — | — |
| Smart dispatch timing | 🔄 | `computeConfirmAt()` exists and is stored as `deliveryConfirmAt`, but release is now immediate at acceptance; the confirm sweep is a safety net | Re-enable timed release once prep history exists | Depends on WS2 prep history |
| Delivery exceptions | 🟡 | States exist in the contract (`REASSIGNING`, `DELIVERY_FAILED`, `CUSTOMER_UNREACHABLE`); customer-facing stories unproven | Exercise and design the customer copy | — |

## WS6 · Platform Operations

| Capability | Status | Evidence | Remaining | Next action |
|---|---|---|---|---|
| Marketplace notification delivery | 🟡 | **Code complete, staging verified, physical SMS acceptance blocked.** `outbox-adapters.ts` implements both ports on Termii/Telegram; `deliver-now.ts` drains inline at all 3 enqueue sites; `/api/cron/outbox` is the backstop (401 anonymous). Staging: 12 claimed/12 retried, replay claimed 0 | **No message has been received on a real handset.** Termii staging credit; a real test phone number on the staging QA customer | Unblock externally — **do not fake either, and do not use production credentials** |
| Storefront SMS notifications | ✅ | Link now carries `?t=`, and is dropped rather than sent broken when there is no token. Staging: bare link **404**, tokenised link **200** | — | — |
| Native push notifications | ⬜ | **Not implemented.** The customer app has no push dependencies — `expo-notifications` is absent. The `sendCustomerPush` port delivers by **SMS**; the name describes the message, not the transport | Device registration, a real push transport, and only then foreground / background / terminated and tap-to-deep-link behaviour — **none of which exists or has been exercised today** | **WS6.5** |
| Discovery engine | ✅ | Marketplace-aware: `marketplaceVisible` is a second, stricter gate beside `visible`, so a live SaaS tenant that never opted in cannot reach customers (`stg-internal-only` confirmed absent) | — | — |
| Discovery scheduled jobs | ✅ | `/api/cron/discovery` daily (reconcile + popularity, CRON_SECRET-gated) **plus** write-time reindex on menu and settings writes. No CLI run required | — | — |
| Discovery index population | ✅ | Staging: 3 restaurants, 8 dishes indexed; 7 marketplace-visible. A menu edit is reflected without a backfill command (proven) | — | — |
| Geolocation coverage | 🟡 | Geocoding and geohash built; backfill script exists | Coverage across real restaurants unmeasured | — |
| Computed popularity | ✅ | Genuine values on staging: 14 orders → `stg-trishas-kitchen` 1.000 vs cold-start 0.500. Popular Around You requires `popularityOrders > 0`, so the neutral score cannot pose as a ranking | — | — |
| Staging/production isolation | ✅ | Separate Firebase projects, separate bundle ids, fail-loud guards, 8 isolation tests | — | — |
| Dispatcher deploy automation | 🟡 | `scp` + `pm2 restart`; host git remote is a local path | Real pipeline | **WS6.3** |
| Production service-account rotation | 🚫 | **DEFERRED TECHNICAL DEBT — the live credential risk is OPEN, not closed.** One `pack-delivery-live` service account (`b737ea86…`) is *shared* by `adminprod` and `paystackprod`; copies sit in `admin-dashboard/` and `paystackwebhook/` under **both** the prod and staging trees; and the key is in git history (`GIT_HISTORY_CLEANUP.md`). Removing the staging strays reduced exposure — it did not rotate anything | Rotation invalidates the key for two live services at once, so it needs a controlled maintenance window and a coordinated update of every copy | **Owner decision — schedule a window** |
| `SENDGRID_API_KEY` on staging | 🚫 | Unset; no account can self-verify email | Provision a sandbox key | **WS6.3** |
| Observability | ⬜ | Nothing alerts when a subsystem silently stops | — | — |

---

## The pattern worth naming

Three finished, tested subsystems were each **one wiring job** from being
useful. WS6.1 did the first: the outbox now drains and its links open. Two
remain — the discovery index has no scheduled job, and settlement has no payout
adapter. None of this is missing architecture; it is missing connection.

WS6.1 also found the sharper version of the same pattern. The outbox was not
merely undrained; the "your food is on the way" message was wired to a delivery
state the live pipeline never produces. Something can be built, tested, wired
and still send nothing, because the one fact nobody checked was whether the
state it keys on ever actually occurs. Staging said it plainly: 65 queued
notifications, seven distinct events, not one pickup among them.

**WS6.2 delivered the second wiring job**, and found the same shape of defect
underneath it. The index was not merely empty: it modelled the wrong
relationship (a live SaaS tenant, not a marketplace restaurant), carried the
wrong price (the restaurant's own, not the customer's), and sat beside a
configured delivery radius that nothing read. Three finished subsystems, none
of them connected to the thing they described.

Settlement's payout adapter is the one that remains.

---

**WS6.1 is not closed.** It is code complete and verified on staging, but the
physical SMS acceptance test has never run, so no notification this platform
produces has yet been read by a person on a phone. Two external blockers, and
neither may be faked or substituted with production credentials:

1. The Termii staging account returns `402 Insufficient funds` — it needs credit.
2. The staging QA customer's `+2348111111111` is not a real handset — it needs a
   real test phone number.

Separately and not to be conflated with the above: **native push is not
implemented.** Today's customer transport is SMS. Foreground, background and
terminated behaviour, and tap-to-deep-link, do not exist yet and have not been
tested — they arrive with WS6.5.
