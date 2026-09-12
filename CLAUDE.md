# CLAUDE.md

## Product Source of Truth

**Read these before proposing or beginning any milestone.** Never redefine the
product from the most recent task — Dispatcher work, payment work and mobile
work are each one part of a larger platform.

1. [`docs/RESTOFLOW_PRODUCT_CHARTER.md`](docs/RESTOFLOW_PRODUCT_CHARTER.md) —
   what RestoFlow is, the four restaurant relationships, the five platform
   layers, and the customer-experience rules.
2. [`docs/RESTOFLOW_MASTER_ROADMAP.md`](docs/RESTOFLOW_MASTER_ROADMAP.md) — the
   six workstreams and their milestones.
3. [`docs/RESTOFLOW_CURRENT_STATE.md`](docs/RESTOFLOW_CURRENT_STATE.md) — living
   status of every capability, with evidence. Update it when a status changes.

In one line: **RestoFlow is the operating system for restaurant commerce.**
Dispatcher is the logistics engine underneath it and must stay invisible to
customers — internally `Customer → RestoFlow → Dispatcher → Rider`, externally
`Customer → RestoFlow`.

Work is tracked by **workstream (WS1–WS6), not by phase number.** Phase
numbering has overlapped and is no longer meaningful.

## Repositories

- `rest` — Next.js backend, restaurant admin, storefront, marketplace APIs.
- `restoflow-customer` — Expo customer marketplace app.
- `pack_delivery` — Dispatcher logistics (rider app + delivery service).

## Environments

Staging and production are separate Firebase projects and must stay isolated.
Production RestoFlow is `restaurant-saas-64235`; staging is `restoflow-staging`.
Dispatcher production is `pack-delivery-live`; staging `pack-delivery-staging`.
Never point a staging build at a production project, and never modify production
configuration to make a build work.
