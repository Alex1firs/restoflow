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
