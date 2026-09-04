# Marketplace staging — setup and runbook

Phase 1.5 needs a real non-production environment on both sides. This is what
must exist, what has been prepared in the repository, and what still needs a
human with console access.

## Status

| Piece | State |
|---|---|
| `.env.staging.example` — every variable, with the traps called out | ✅ in repo |
| `scripts/seed-staging-marketplace.ts` — synthetic seed, refuses production | ✅ in repo |
| Guarded project allowlist + `--confirm` | ✅ in repo |
| Firebase **staging project** for RestoFlow | ⛔ **needs console access** |
| Firebase **staging project** for Dispatcher | ⛔ **needs console access** |
| Vercel Preview environment variables | ⛔ **needs Vercel access** |
| Dispatcher staging partner API key | ⛔ **needs the Dispatcher admin dashboard** |

Everything a repository can carry is carried. The three ⛔ rows need somebody
signed in to Firebase, Vercel and the Dispatcher dashboard; they are the
remaining blocker on running the journey against real infrastructure rather
than in-process.

## RestoFlow staging

1. **Create the Firebase project** — id `restoflow-staging`. It must not be the
   production project, and the seed script refuses to run against anything on
   its production denylist.
2. **Enable** Firestore, Auth (phone + email), Storage.
3. **Deploy rules, explicitly named**:
   ```
   firebase deploy --only firestore:rules --project restoflow-staging
   ```
   Never a bare `firebase deploy` — it would push hosting, functions, indexes
   and storage rules you did not intend.
4. **Service account** → `FIREBASE_ADMIN_*` in Vercel Preview.
5. **Paystack test keys only.** A live secret here would take real money from a
   synthetic customer.
6. **Seed**:
   ```
   npx tsx scripts/seed-staging-marketplace.ts --confirm
   ```
   Creates two synthetic restaurants — one marketplace-active, one deliberately
   internal-only so the opt-in default is visible — three menu items and one
   customer. **No production data is copied.** Every name carries "(SYNTHETIC)"
   so a staging screenshot can never be mistaken for live data.

## Dispatcher staging

1. Firebase project `pack-delivery-staging` (one already exists for the
   `delivery-service-staging` microservice and the Flutter staging flavor).
2. Deploy the integration functions, explicitly named:
   ```
   firebase deploy --only functions:marketplaceApi,functions:onMarketplaceDeliveryChange,functions:onRiderProfileWritten --project pack-delivery-staging
   ```
3. Set `MARKETPLACE_INTEGRATION_ENABLED=true` **in staging only**.
4. Issue a partner API key from the admin dashboard, then store the record at
   `api_keys/{sha256(key)}` with `clientId`, `signingSecret`, `callbackUrl` and
   `callbackSecret`.
5. **Do not deploy the new RTDB rules yet** — see `RULES_MIGRATION.md` in the
   Dispatcher repo. Three Flutter queries must ship first.

## The two secrets

`DISPATCHER_SIGNING_SECRET` signs our requests **to** Dispatcher.
`DISPATCHER_WEBHOOK_SECRET` verifies Dispatcher's events **to** us.

They are deliberately different values: compromising one direction must not
grant the other.

## Production stays off

| Flag | Production | Staging |
|---|---|---|
| `MARKETPLACE_ENABLED` | **unset** | `true` |
| `MARKETPLACE_PAYMENTS_ENABLED` | **unset** | `true` |
| `DELIVERY_INTEGRATION_ENABLED` | **unset** | `true` |
| `MARKETPLACE_INTEGRATION_ENABLED` (Dispatcher) | **unset** | `true` |

With the flags unset the marketplace routes 404, the cron sweep no-ops, the
Dispatcher functions 404, and no restaurant is listed. Deploying this code to
production changes nothing observable — which is what makes it safe to ship
ahead of launch.

## Verifying without infrastructure

Until the staging projects exist, the full journey runs in-process with real
HTTP and real signatures between the two products:

```
npm run demo:marketplace     # quote → pay → accept → dispatch → deliver → ledger
npm run demo:delivery        # the Phase 1 integration journey
```

Both assert the same end state: one payment, one order, one delivery job, one
ledger, one delivery — after deliberately replaying every callback.

---

# The customer mobile API (`/api/mobile/v1`)

The one surface the phone talks to. It never reaches Firestore, never reaches
Dispatcher, and never reaches Paystack's server API directly.

| Method & path | Auth | What it does |
|---|---|---|
| `GET /feed?lat&lng` | public | Nearby restaurants that opted in. |
| `GET /search?q&lat&lng` | public | Same, filtered. |
| `GET /restaurants/{slug}` | public | One restaurant and its customer-priced menu. |
| `GET /me` · `PATCH /me` | customer | Profile. `status` is deliberately not patchable. |
| `GET /me/addresses` · `POST` | customer | The address book. |
| `PATCH /me/addresses/{id}` · `DELETE` | customer | One address. |
| `POST /cart/quote` | customer | Server-computed price for a cart. |
| `POST /orders` | customer | Checkout → a payment intent, not an order. |
| `GET /orders` | customer | The caller's own orders. |
| `GET /orders/{id}` | customer | One of the caller's own orders. |
| `GET /orders/{id}/tracking` | customer | Courier position, when it may be shown. |

## Five properties, and where each is enforced

**1. Identity comes from the token, never the request.**
`withCustomer` (`lib/marketplace/mobile-api.ts`) calls `authenticateCustomer`,
which calls `verifyIdToken(token, true)` — `checkRevoked: true`, so a signed-out
or disabled account stops working immediately rather than when its hour-long
token happens to expire. There is no query parameter, header or body field
anywhere on this surface through which a caller could name a different
customer. A test enumerates every route and asserts this.

**2. Not-yours and not-there are indistinguishable.**
Every ownership failure returns 404 with the same body. `/orders/{id}` has
three separate reasons to refuse — no such order, not a marketplace order, not
yours — and one answer, so the endpoint cannot be used to discover which order
ids exist.

**3. The client never names a price.**
`QuoteLineRequest` is `{ itemId, quantity, options[], note }`. Prices come from
`menu_items`, markup from the restaurant's config, delivery from Dispatcher.
Options are resolved against the menu's own option groups, so a client cannot
invent a cheap option. `POST /orders` re-prices from scratch rather than
trusting the quote the app is holding.

**4. The customer sees what they are charged, and nothing behind it.**
`toCustomerOrderSummary` / `toCustomerOrderDetail` build responses field by
field. `restaurantPayableMinor`, `platformGrossMinor` and `processorFeeMinor`
live on the stored order and never appear in a response; a test asserts the
whole surface for their absence, and for the absence of a spread that could
reintroduce them.

**5. Checkout creates a payment intent, not an order.**
The order document comes into existence in one transaction, keyed on the
payment reference, when money actually arrives. A customer can press pay twice,
lose the network, and return an hour later without producing two orders.

## Restaurant separation

The mobile API never reads `prepared_items` (the POS catalogue) and never
writes to a POS order. `RestoFlow` restaurants keep two unlinked catalogues,
which is exactly what makes marketplace markup free of consequences for POS
prices. Two tests assert this: one over the mobile routes, one over the whole
delivery module.

## The marketplace sweep cannot run per-minute on Vercel Hobby

`vercel.json` asks for `/api/cron/marketplace` every minute. Vercel **Hobby
accounts allow daily crons only**, and a deployment carrying `* * * * *` is
rejected outright — a production deploy of this branch would fail the same way.

The schedule is therefore set to `0 3 * * *` so deployments succeed. That is
not sufficient for the real workload: the sweep exists to fire `confirmAt`
transitions and reconcile deliveries whose events were lost, and a daily pass
would leave an order stuck for hours.

Two ways to restore per-minute cadence, neither of which needs Vercel Pro:

1. **External scheduler (recommended, free).** The Dispatcher droplet already
   runs cron. One line hitting the endpoint with the shared secret:

       * * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" \
         https://<host>/api/cron/marketplace >/dev/null 2>&1

   The endpoint is already secret-guarded and idempotent, so a duplicate or
   overlapping run is harmless.

2. **Vercel Pro**, which lifts the restriction.

Until one is in place, treat the sweep as manual in staging.
