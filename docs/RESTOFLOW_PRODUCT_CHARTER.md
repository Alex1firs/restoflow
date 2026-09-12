# RestoFlow Product Charter

**This document is the product source of truth.** Read it before proposing or
beginning any milestone. Never redefine the product from the most recent task —
Dispatcher work, payment work and mobile work are each one part of this whole.

---

## What RestoFlow is

RestoFlow is not a food-ordering app. **RestoFlow is the operating system for
restaurant commerce**, and the RestoFlow customer app is its consumer
marketplace.

RestoFlow owns the customer relationship, restaurant discovery, menus,
marketplace orders, customer payments, restaurant workflow, order status,
restaurant payable and accounting, customer communication, and delivery
orchestration.

**Dispatcher is the logistics engine underneath RestoFlow.** From the customer's
point of view it is infrastructure and must stay invisible. Customers experience
one product.

```
Internally   Customer → RestoFlow → Dispatcher → Rider
Externally   Customer → RestoFlow
```

Never surface internal architecture to a customer. "Assigned to Dispatcher" is
wrong; "Your RestoFlow courier has been assigned", or the courier's first name,
is right.

---

## The four restaurant relationships

A restaurant adopts whichever layers it needs. **Dispatcher is not mandatory for
any of them.**

**A · Full RestoFlow Restaurant** — uses the full RestoFlow POS and backend.
Marketplace orders enter its normal workflow; staff receive, accept and prepare;
delivery can dispatch automatically through Dispatcher.

**B · Marketplace Partner** — does not need the POS. Supplies restaurant
information, menu, prices, opening hours, location and preparation information.
Orders arrive through a simplified merchant interface.

**C · Delivery-Only Partner (RestoFlow Connect)** — takes orders anywhere
(WhatsApp, Instagram, phone, its own site, another POS) and asks RestoFlow only
for logistics, supplying pickup, drop-off, package information and ready-now or
ready-later. RestoFlow earns logistics revenue on orders it did not originate.

**D · API / Enterprise Partner** — integrates programmatically to create
marketplace or delivery requests.

---

## The five platform layers

1. **Customer Marketplace** — discovery, menus, ordering, tracking.
2. **Restaurant Commerce** — menus, POS, orders, kitchen, online sales.
3. **RestoFlow Connect** — integration for non-RestoFlow restaurants and
   external systems.
4. **Payments & Settlement** — customer payments, restaurant payable, RestoFlow
   revenue, fees, reconciliation.
5. **Dispatcher Logistics** — quote, rider discovery and assignment, GPS,
   pickup, delivery, proof of completion.

One platform. A restaurant does not have to use all five.

---

## Customer experience rules

The app must feel premium, calm, fast, hospitality-led, trustworthy and
uncluttered — never a noisy generic delivery marketplace.

The customer must always know where they are ordering from, what the food costs,
what delivery costs, roughly when it arrives, and what stage the order is at.

Navigation: **Home · Search · Orders · Favourites · Account**

**Home** is address-first and must not demand GPS permission up front. It leads
with "Deliver to" and the chosen address, then "What are you craving?". Sections
may include Order Again, Restaurants Near You, Fast Delivery, Popular Around
You, Local Favourites, New on RestoFlow. Ranking may consider distance, open
state, delivery availability, preparation time, ETA and popularity. Restaurant
cards stay simple: image, name, cuisine, ETA, delivery fee, opening state.

**Storefront** should feel like walking into that restaurant: cover image,
identity, cuisine, ETA, delivery fee, opening status, menu, sticky category
navigation. Items support size, protein, extras and special instructions.

---

## Pricing

The backend is authoritative. Internal restaurant payable and markup are
accounting data and **must not be exposed to customers**.

> Restaurant receives ₦3,500 · marketplace price ₦4,200 · the customer sees
> **₦4,200**.

Checkout shows Food, Delivery, Service fee *only if explicitly introduced*, and
Total. No surprise charges.

## Cart

One restaurant per cart. Never silently merge restaurants into one delivery. On
a restaurant change, ask clearly before replacing. Preserve quantity, modifiers,
extras and instructions. Server pricing stays authoritative.

## Checkout

Short: delivery address, delivery instructions, payment method, order summary
(food, delivery, total), Place Order.

---

## The post-payment story

Preparation and delivery are **one continuous RestoFlow story**, not two systems
handing off.

1. **Order received** — the restaurant has it.
2. **Preparing** — show expected preparation information. No map yet.
3. **Courier assigned** — first name, relevant identity, vehicle. Map becomes
   useful.
4. **Courier at restaurant** — the rider is collecting.
5. **Picked up / on the way** — map and ETA become prominent.
6. **Delivered** — rate food, rate delivery, reorder, report a problem.

## Smart dispatch timing

Long term, do not necessarily dispatch the moment a restaurant accepts. Weigh
expected preparation time, rider travel time to the restaurant, and the
restaurant's historical preparation performance, so a rider is not left waiting.

> Prep 25 min, rider travel 8 min → begin rider search around 15–17 minutes in.

## Order communication

Build **order-specific** communication, not a general messaging platform.
Customer ↔ courier in-app chat first, scoped to the order. Calling should use
number masking rather than exposing personal numbers. Full VoIP is later.

---

## V1 priority

Keep V1 small. The magical first experience is:

> open RestoFlow → choose delivery address → discover a restaurant → choose food
> → pay → restaurant prepares → courier assigned → track courier → receive food.

That flow must feel exceptional before anything else is added.

**Deferred unless separately approved:** loyalty, wallet, subscriptions,
scheduled ordering, group ordering, promotions, AI food discovery, advanced
recommendations.

---

## Proven foundation — do not rebuild

The full marketplace delivery chain has been verified end to end, on simulators
and then on **physical devices**: customer app → payment → restaurant acceptance
→ Dispatcher job creation → automatic rider availability → rider acceptance →
pickup-code verification → in-progress → customer tracking → receiving-code and
signature → Delivered.

Hardened along the way: server-authoritative pricing, option pricing, payment
retry and idempotency, duplicate order and job prevention, staging/production
isolation, restaurant identity, rider identity, location streaming, pickup and
receiving codes, customer order detail, status and timeline propagation,
delivered timestamps, and authenticated Dispatcher delivery projections.

Treat this as a proven foundation.

---

## Companion documents

- [`RESTOFLOW_MASTER_ROADMAP.md`](./RESTOFLOW_MASTER_ROADMAP.md) — workstreams
  and milestones.
- [`RESTOFLOW_CURRENT_STATE.md`](./RESTOFLOW_CURRENT_STATE.md) — living status
  of every capability, with evidence.
