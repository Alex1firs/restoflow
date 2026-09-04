# Staging setup checklist

> **Superseded in part by [`STAGING_SETUP.md`](./STAGING_SETUP.md)**, which is
> the ordered, step-by-step version of this and is the one to follow. Two
> things have changed since this file was written:
>
> - **Phone auth is out.** Staging sign-in uses Email/Password only. Phone auth
>   sends SMS, which is billable; there is no reason to spend that on synthetic
>   accounts.
> - **The indexes are now in the repository** as `firestore.indexes.json` and
>   deploy with `firebase deploy --only firestore:indexes --project restoflow-staging`,
>   rather than being created by hand from the list below.
>
> This file remains useful as the reference for what each value is *for*.


## What I can create: nothing

`firebase login:list` → **no authorized accounts**. `vercel` → **not installed**.
I have no authenticated access to either console, so I cannot create a project,
enable a service, set an environment variable, or provision a key — and would
not create billable resources without approval even if I could.

Everything below needs a human signed in. Everything a repository *can* carry is
already committed: `.env.staging.example`, `scripts/seed-staging-marketplace.ts`
(three guards, synthetic data only), and
`infra/rules-migration/deploy.sh` in the Dispatcher repo.

**No production secret value appears anywhere in this repository.** Only names.

---

## 1. RestoFlow staging Firebase

**Project id:** `restoflow-staging` — must NOT be the production project. The
seed script carries a production denylist and refuses to run against one.

| Resource | Setting |
|---|---|
| Firestore | Native mode, `nam5` or your production region |
| Authentication | **Email/Password** (restaurant staff) and **Phone** (customers) |
| Storage | Default bucket |
| Service account | Firebase Admin SDK key → `FIREBASE_ADMIN_*` |

Rules — explicitly named, never a bare deploy:
```
firebase deploy --only firestore:rules --project restoflow-staging
```

Firestore indexes needed by the marketplace queries:
- `orders`: `orderSource` ASC, `createdAtMs` DESC
- `orders`: `orderSource` ASC, `restaurantId` ASC, `createdAtMs` DESC
- `orders`: `orderSource` ASC, `delivery.state` ASC, `deliveryConfirmAt` ASC
- `orders`: `orderSource` ASC, `delivery.lastEventAt` ASC
- `marketplace_ledger_entries`: `orderId` ASC

Seed:
```
npx tsx scripts/seed-staging-marketplace.ts --confirm
```

## 2. Dispatcher staging Firebase

**Project id:** `pack-delivery-staging` (one already exists for the
`delivery-service-staging` microservice and the Flutter staging flavor).

| Resource | Setting |
|---|---|
| Realtime Database | Same region as production |
| Authentication | Email/Password, Phone |
| Cloud Functions | Node 20 |
| Cloud Messaging | For rider push |

Functions — named individually:
```
firebase deploy --only functions:marketplaceApi,functions:onMarketplaceDeliveryChange,functions:onRiderProfileWritten --project pack-delivery-staging
```

Rules — **only after** the Flutter release carrying the four query changes is
adopted:
```
cd infra/rules-migration && ./deploy.sh staging
```

Partner record at `api_keys/{sha256(key)}`:
`clientId`, `isActive`, `signingSecret`, `callbackUrl`, `callbackSecret`.

## 3. Environment variable NAMES

**RestoFlow — Vercel Preview**

`NEXT_PUBLIC_FIREBASE_API_KEY` · `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` ·
`NEXT_PUBLIC_FIREBASE_PROJECT_ID` · `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` ·
`NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` · `NEXT_PUBLIC_FIREBASE_APP_ID` ·
`FIREBASE_ADMIN_PROJECT_ID` · `FIREBASE_ADMIN_CLIENT_EMAIL` ·
`FIREBASE_ADMIN_PRIVATE_KEY` · `PAYSTACK_SECRET_KEY` (**test key**) ·
`NEXT_PUBLIC_APP_URL` · `MARKETPLACE_ENABLED` · `MARKETPLACE_PAYMENTS_ENABLED` ·
`DELIVERY_INTEGRATION_ENABLED` · `DELIVERY_ENVIRONMENT` ·
`DISPATCHER_API_BASE_URL` · `DISPATCHER_API_KEY` · `DISPATCHER_SIGNING_SECRET` ·
`DISPATCHER_WEBHOOK_SECRET` · `CRON_SECRET`

Scope to **Preview only**. A Production-scoped marketplace flag is the one
mistake that would matter.

**Dispatcher — Functions config**

`MARKETPLACE_INTEGRATION_ENABLED` · `MARKETPLACE_PARTNER_KEY` ·
`MARKETPLACE_CALLBACK_URL` · `MARKETPLACE_CALLBACK_SECRET` ·
`FUNCTIONS_REGION` · `RTDB_INSTANCE`

**Customer mobile — `apps/customer-mobile/.env`**

`EXPO_PUBLIC_API_BASE_URL` · `EXPO_PUBLIC_ENVIRONMENT` ·
`EXPO_PUBLIC_FIREBASE_API_KEY` · `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN` ·
`EXPO_PUBLIC_FIREBASE_PROJECT_ID` · `EXPO_PUBLIC_FIREBASE_APP_ID`

Only `EXPO_PUBLIC_*` reaches the bundle. No service secret, no admin key, no
Paystack key, no Dispatcher credential — asserted by a test that scans the built
bundle.

## 4. Service-to-service secrets

Generate on the machine that will hold them:
```
openssl rand -hex 32
```

Two **different** values:

| Secret | Signs | Held by |
|---|---|---|
| `DISPATCHER_SIGNING_SECRET` | RestoFlow → Dispatcher | both |
| `DISPATCHER_WEBHOOK_SECRET` / `callbackSecret` | Dispatcher → RestoFlow | both |

Different because compromising one direction must not grant the other. Rotate
with an overlap window; Dispatcher's `CREDENTIAL_ROTATION_TRACKER.md` has the
existing procedure.

## 5. Allowed domains

- **Firebase Auth authorized domains** (RestoFlow staging): the Vercel preview
  host, `localhost`
- **Dispatcher `ALLOWED_ORIGINS`**: the RestoFlow staging host only. The partner
  API is server-to-server; no browser origin needs it.
- **Paystack test webhook URL**: `https://<preview-host>/api/webhooks/paystack`

## 6. Flutter staging

Flavor `staging` already exists (`mapp/android/app/src/staging/google-services.json`).
Point it at `pack-delivery-staging` and confirm the iOS staging plist matches.

## 7. Verification without any of this

The full journey runs in-process today, with real HTTP and real signatures
between the two products:

```
npm run demo:marketplace
npm run demo:delivery
```

Both end at: one payment, one order, one delivery job, one ledger, one delivery.
