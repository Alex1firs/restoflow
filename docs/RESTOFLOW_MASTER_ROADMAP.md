# RestoFlow Master Roadmap

Workstreams and milestones for the whole platform. Read
[`RESTOFLOW_PRODUCT_CHARTER.md`](./RESTOFLOW_PRODUCT_CHARTER.md) first for the
product definition, and
[`RESTOFLOW_CURRENT_STATE.md`](./RESTOFLOW_CURRENT_STATE.md) for where each item
actually stands today.

Workstreams are **not** phases. They run in parallel and at different speeds. A
milestone belongs to exactly one workstream, so "which phase are we in" stops
being a meaningful question.

---

## WS1 · Customer Marketplace

The consumer app and everything a customer touches.

| Milestone | Scope |
|---|---|
| **1.1 Core ordering loop** | Address → discovery → storefront → cart → checkout → payment. The V1 magic path. |
| **1.2 Live order story** | The six post-payment stages as one continuous narrative, map and ETA appearing only when useful. |
| **1.3 Discovery quality** | Ranking that actually reaches the customer app: distance, open state, delivery availability, prep time, ETA, popularity. |
| **1.4 Return behaviour** | Order Again, reorder, favourites, recent orders. |
| **1.5 After delivery** | Rate food, rate delivery, report a problem, support route. |
| **1.6 Order communication** | Order-scoped customer ↔ courier chat, then masked calling. |

## WS2 · Restaurant Commerce

What a restaurant using the full product sees.

| Milestone | Scope |
|---|---|
| **2.1 Marketplace order handling** | Receive, accept, reject, preparing, ready — inside the normal RestoFlow workflow. |
| **2.2 Menu & modifiers** | Categories, sizes, proteins, extras, instructions, availability. |
| **2.3 Kitchen & prep signals** | Prep-time accuracy and historical performance, which WS5 needs for smart dispatch. |
| **2.4 Merchant mobile** | The portal usable on a phone in a kitchen. |

## WS3 · Partner Models & RestoFlow Connect

The three relationships beyond a full RestoFlow restaurant.

| Milestone | Scope |
|---|---|
| **3.1 Marketplace Partner** | Simplified merchant interface for restaurants without the POS: information, menu, prices, hours, location, prep. |
| **3.2 RestoFlow Connect** | Request-a-courier without originating the food order — pickup, drop-off, package, ready now/later. Logistics revenue on orders RestoFlow did not take. |
| **3.3 Partner API** | Programmatic marketplace and delivery requests for enterprise systems, with keys, quotas and idempotency. |

## WS4 · Payments, Payable & Settlement

Money in, money owed, money out.

| Milestone | Scope |
|---|---|
| **4.1 Customer payments** | Intent, webhook, reconciliation, idempotency. |
| **4.2 Ledger & payable** | Append-only, balanced, per-order: restaurant payable, delivery payable, platform revenue, processor cost. |
| **4.3 Payout execution** | Connect the settlement state machine to a provider, human gate intact. |
| **4.4 Statements & reconciliation** | What a restaurant and a courier partner can each see and trust. |

## WS5 · Dispatcher Logistics

The engine underneath, which must stay invisible to customers.

| Milestone | Scope |
|---|---|
| **5.1 Delivery integration** | Quote, acceptance-gated handoff, rider board, handover codes, tracking. |
| **5.2 Smart dispatch timing** | Start the rider search from prep time, rider travel and restaurant history rather than immediately on acceptance. |
| **5.3 Delivery exceptions** | Reassignment, courier cancellation, unreachable customer, failed delivery — as customer-safe stories. |

## WS6 · Platform Operations

The things that decide whether any of the above stays working.

| Milestone | Scope |
|---|---|
| **6.1 Notification delivery** | 🟡 **CODE COMPLETE / STAGING VERIFIED / PHYSICAL SMS ACCEPTANCE BLOCKED** (2026-09-12). Both send ports implemented on the existing Termii/Telegram channels, inline drain at every enqueue site plus a backstop cron, tracking links carry their token. **Not closed:** no message has been received on a real handset. Two external blockers, neither to be faked or worked around with production credentials — the Termii staging account needs credit, and the staging QA customer needs a real test phone number. Transport is SMS; native push is 6.5 and is **not** implemented. |
| **6.2 Customer discovery integration** | ✅ **COMPLETE. Staging physical regression PASSED 2026-09-14.** The customer app reads the discovery engine: `/feed` and `/search` converged onto it, the duplicate ranking path deleted, marketplace opt-in enforced as a hard gate, delivery radius enforced, opening state made honest, prices kept out of the index. Maintained by write-time reindex plus a daily reconcile. |
| **6.2b Remaining scheduled jobs** | Geocoding on a schedule; sweeps. Geocoding needs a Google Geocoding API key, unset on staging — not on the critical path while restaurants carry usable pins. |
| **6.3 Environment integrity** | Staging/production isolation, automated deploys, required environment variables present. |
| **6.3a Rider radius — production rollout** | 🟡 Fixed and verified on staging; **production rollout pending.** The production delivery service must enforce eligibility **before** the rider app stops filtering locally — that order is mandatory, because shipping the app first leaves production riders seeing every job nationwide. Until then the app's fallback is what protects production. |
| **6.3b Production service-account rotation** | 🚫 **Deferred technical debt. The live credential risk is open.** One `pack-delivery-live` key is shared by two live services and is present in git history. Rotation requires a controlled maintenance window and a coordinated update of every copy; the staging cleanup did not close it. |
| **6.4 Observability** | Knowing a subsystem has stopped working before a customer tells you. |
| **6.6 Discovery signals** | Ratings (no genuine source today), Local Favourites' long-term local signal, and a marketplace publication timestamp for New on RestoFlow. All three sections stay hidden until the data is real. |
| **6.5 Device push** | Replace the SMS transport behind `sendCustomerPush` with real push in the customer app. The port exists; only the transport changes. |

---

## Deferred until the core is excellent

Loyalty · wallet · subscriptions · scheduled ordering · group ordering ·
promotions · AI food discovery · advanced recommendations.

These do not enter a milestone without separate approval.

---

## Sequencing principles

1. **Wire what is already built before building more.** Several subsystems are
   complete and tested but not connected to anything.
2. **A customer-visible failure outranks a missing feature.**
3. **Decide before duplicating.** Where two implementations of one capability
   exist, converge rather than maintaining both.
4. **Dispatcher is never the product.** It is WS5 of six workstreams.
