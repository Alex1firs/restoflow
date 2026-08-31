# RestoFlow ⇄ Dispatcher integration — Phase 1

The RestoFlow side of the delivery boundary. Dispatcher owns the delivery;
RestoFlow owns the order, the customer and the money. Neither reads the other's
database.

Phase 1 is the **integration layer only**. The customer mobile app is not built
yet, and marketplace orders are not yet created by any customer-facing flow.

## Status: not reachable in production

Everything is gated on `DELIVERY_INTEGRATION_ENABLED`. With it unset:

- `/api/webhooks/dispatcher` answers 404
- `/api/mobile/v1/orders/{id}/tracking` answers 404
- no outbound call is ever made
- `readDeliveryConfig()` returns `{ enabled: false }` and nothing constructs a client

A **half-configured** integration is refused rather than degraded: if the flag is
on and any credential is missing, the config read fails and the webhook route
returns 503. A half-working delivery integration takes money for deliveries it
cannot arrange, which is worse than one that is plainly off.

## Environment variables

| Variable | Required when enabled | Purpose |
|---|---|---|
| `DELIVERY_INTEGRATION_ENABLED` | — | Master switch. Must be exactly `true`. |
| `DISPATCHER_API_BASE_URL` | yes | Base URL of Dispatcher's `marketplaceApi`, including `/v1`'s parent path. |
| `DISPATCHER_API_KEY` | yes | Identifies RestoFlow to Dispatcher. |
| `DISPATCHER_SIGNING_SECRET` | yes | Signs our **outbound** requests. |
| `DISPATCHER_WEBHOOK_SECRET` | yes | Verifies Dispatcher's **inbound** events. Deliberately a different secret. |
| `DELIVERY_ENVIRONMENT` | no | `development` \| `staging` \| `production`. Guards against pointing a dev build at a live fleet. |

Two secrets, not one: a compromise of one direction must not grant the other.

## Files

| Path | Role |
|---|---|
| `lib/delivery/contract.ts` | The versioned contract. The only shared vocabulary. |
| `lib/delivery/signature.ts` | HMAC signing + replay window, both directions. |
| `lib/delivery/status.ts` | Dispatcher status → canonical → customer copy, plus the order reducer. |
| `lib/delivery/projection.ts` | The delivery read-model and the event-application rules. |
| `lib/delivery/ingest.ts` | Webhook orchestration over the store port. |
| `lib/delivery/store.ts` | Storage port. |
| `lib/delivery/firestore-store.ts` | Firestore adapter. The only module that touches `orders`. |
| `lib/delivery/dispatcher-client.ts` | The one module that calls Dispatcher. |
| `lib/delivery/tracking.ts` | Customer tracking authorisation and payload shaping. |
| `lib/delivery/config.ts` | Environment reading. |
| `app/api/webhooks/dispatcher/route.ts` | Inbound event receiver. |
| `app/api/mobile/v1/orders/[orderId]/tracking/route.ts` | Customer tracking gateway. |

## Data written

Only three things, all additive:

- `orders/{orderId}.delivery` — the projection, written with a **field-path
  update**, never a document set, and only on orders whose `orderSource` is
  `marketplace`
- `marketplace_delivery_events/{eventId}` — the replay claim
- `marketplace_delivery_timeline/{entryId}` — the support timeline

Both new collections are `read:false, write:false` in `firestore.rules`,
following the `pos_order_claims` pattern.

## What is guaranteed about the POS

`lib/delivery/__tests__/pos-isolation.test.ts` scans this subsystem's own source
and fails if it so much as mentions `pos_order_claims`, `localOrderId`,
`orderCounter`, `orderNumber` or `prepared_items`, imports anything from
`lib/pos`, sets an order document wholesale, or accepts a customer identity from
a request body. The compatibility promise is mechanical, not aspirational.

## Idempotency, in four layers

1. **Outbound.** The marketplace order id is the idempotency key and is never
   regenerated. A timeout and a 502 both mean *unknown*, and unknown means retry
   with the same key — minting a new one on failure is exactly how one POS
   transaction once became three orders.
2. **Dispatcher-side.** A transactional claim on `clientId + externalOrderId`.
3. **Inbound event id.** An atomic `create` on `marketplace_delivery_events`.
4. **Sequence + state rank.** A late or duplicated event cannot rewind an order,
   and nothing reopens a terminal delivery.

## Dispatch timing

`computeConfirmAt` releases the job to riders at

```
readyAt − (searchBuffer + riderTravelToPickup + safety)
```

never earlier than now. A 25-minute prep with a rider 11 minutes away confirms
at minute 8. The restaurant's own "ready" signal is the backstop, and confirm is
idempotent so both firing is harmless.

## Running it

```bash
npm run test:delivery         # 133 checks, 9 suites
npm run demo:delivery         # full cross-system demonstration
```

The demonstration boots both products in one process with real HTTP and real
signatures between them, drives a complete order from quote to delivered, then
deliberately replays every create and every webhook to prove one order → one
delivery job → one delivery. It needs the Dispatcher repository on disk; set
`DISPATCHER_REPO` if it is not at `~/Desktop/pack_delivery/pack_delivery`.

## Not in Phase 1

Marketplace order creation, the customer app, push delivery, the operations UI,
messaging, masked calling, the reconciler cron, and the marketplace ledger. The
seams for each exist; see the audit for what Phase 2 must build.
