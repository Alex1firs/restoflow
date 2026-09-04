# Creating the staging environment

Everything in this repository that could be built without a cloud account has
been built. What remains needs an account owner, because it needs a login, a
console, or a billing decision.

This document is the exact sequence. Do the steps in order — later steps need
values that earlier steps produce.

---

## What "done" looks like

Three staging systems that can talk to each other and to nothing in production:

    RestoFlow Staging  ←→  Dispatcher Staging
    (Vercel Preview)        (pack-delivery-staging)
    (restoflow-staging)
            ↑
    RestoFlow Customer Mobile (Expo, EXPO_PUBLIC_ENVIRONMENT=staging)

Separate Firebase projects, separate credentials, separate webhook secrets,
Paystack **test** keys, and synthetic data throughout.

---

## Guardrails already in the code

These are in place now and need no action; they are listed so you know what is
protecting you while you work.

| Guard | Where | What it prevents |
|---|---|---|
| No `default` Firebase alias | `.firebaserc`, `FIREBASE_TARGETS.md` | A bare `firebase deploy` resolving to production. It errors instead. |
| Production project denylist | `scripts/seed-staging-marketplace.ts` | Seeding synthetic data over real restaurants. |
| Staging allowlist + `--confirm` | same | Seeding a project nobody vetted, or seeding by accident. |
| Explicit-project deploy script | `pack_delivery/infra/rules-migration/deploy.sh` | Deploying RTDB rules to production without typing the project id. |
| Marketplace feature flag | `lib/marketplace/config.ts` | The whole marketplace API 404s while the flag is off. |
| Opt-in default | `readMarketplaceSettings` | A restaurant with no `marketplace` map is invisible to customers. |
| Bundle scan | `restoflow-customer/scripts/scan-bundle.sh` | A server secret reaching a phone. |

---

## The projects, confirmed

Verified against `firebase projects:list` and the Flutter flavour config
(`mapp/lib/firebase_config.dart`) on 2026-09-03. Several of these are not named
what you would guess, which is exactly why they are written down here.

| Project ID | What it actually is | Plan | How it is selected |
|---|---|---|---|
| `restaurant-saas-64235` | **RestoFlow PRODUCTION** | — | `.env.local` |
| *(none yet)* | RestoFlow staging — **must be created**, as `restoflow-staging` | — | step 2 |
| `pack-delivery-live` | **Dispatcher PRODUCTION** | Blaze | Flutter `prod` flavour |
| `pack-delivery-staging` | Dispatcher staging | **Spark** | Flutter `staging` flavour |
| `pack-delivery` | Dispatcher **dev** | Blaze | Flutter `dev` flavour (default options) |

Two things follow that are easy to get wrong:

- **RestoFlow production is `restaurant-saas-64235`.** The name contains
  neither "restoflow" nor "prod". Any guard that pattern-matches on the product
  name will not catch it; the seed script's denylist now carries the literal id.
- **`pack_delivery/.firebaserc` aliases `default` to `pack-delivery`, which is
  the DEV project, not production.** A bare `firebase deploy` there hits dev.
  That is much less dangerous than it looks, but it is still not what you want:
  pass `--project pack-delivery-staging` explicitly. Production
  (`pack-delivery-live`) is aliased nowhere, which is correct.

**The Flutter app already has a staging flavour** wired to
`pack-delivery-staging` (`main_staging.dart` → `firebase_config.dart`). Nothing
needs building there; it needs running.

---

## Step 1 — Authenticate the Firebase CLI

**Service:** Firebase CLI (already installed, v15.24.0)
**Where:** your terminal
**Action:** in this session, type

    ! firebase login

Sign in with the Google account that owns the RestoFlow Firebase project.
**Billing:** none.
**Do NOT:** select a project, run `firebase use`, or run any `deploy` command.
**Tell me when done:** "firebase logged in"

---

## Step 2 — Create the RestoFlow staging Firebase project

**Service:** Firebase console
**Where:** https://console.firebase.google.com → **Add project**
**Actions, in order:**

1. Project name: `restoflow-staging`
   Confirm the generated **Project ID** is exactly `restoflow-staging`. If it
   is taken, the console will append a suffix — write down whatever it gives
   you; several files below need the exact string.
2. Google Analytics: **disable**. Staging does not need it and it creates a
   linked GA property you would have to clean up.
3. Create.
4. **Build → Firestore Database → Create database**
   - Mode: **Production mode** (locked). The rules in this repo are deployed
     in step 5; starting locked means there is no window in which the database
     is open.
   - Location: the same region as production, so latency and index behaviour
     match. If unsure, `eur3` or `nam5`.
5. **Build → Authentication → Get started**
   - Enable **Email/Password** only.
   - Do **not** enable Phone. Phone auth sends SMS and is billable — see the
     billing section below.

**Billing:** none. Firestore and Email/Password auth are on the free Spark plan.
**Do NOT:** touch the existing production project, and do not enable Phone,
Google, or Apple sign-in yet.
**Tell me when done:** "restoflow staging project created, id = `<the exact id>`"

---

## Step 3 — Create the staging service account

**Service:** Firebase console
**Where:** `restoflow-staging` → ⚙ **Project settings → Service accounts**
**Action:** click **Generate new private key** → **Generate key**. A JSON file
downloads.

**Billing:** none.
**Do NOT:**
- commit that file to Git (both repos ignore `*.json` keys, but do not rely on it),
- reuse the production service account,
- paste the private key into chat.

**What I need from it** — three values, and only these:
- `project_id`
- `client_email`
- `private_key` — do not send it to me; you will paste it into Vercel yourself
  in step 6.

**Tell me when done:** "staging service account created" (and the
`client_email`, which is not a secret).

---

## Step 4 — Check the Dispatcher staging project

**Service:** Firebase console
**Where:** https://console.firebase.google.com
**Action:** look for a project with id `pack-delivery-staging`.
`pack_delivery/.firebaserc` already aliases `staging` to that id, so it may
exist already.

**If it does not exist,** create it exactly as in step 2, with these differences:
- **Build → Realtime Database → Create database** (Dispatcher uses RTDB, not
  Firestore), locked mode, same region as the production RTDB.
- Authentication → enable **Email/Password**.

**Billing — read this before continuing.**
Dispatcher's integration API is a Cloud Function (`functions/api_integration.js`,
plus the new `functions/integration/`). **Cloud Functions requires the Blaze
pay-as-you-go plan.** The Spark free plan cannot deploy functions at all.

- **What needs billing:** Firebase Blaze plan on `pack-delivery-staging`.
- **Why:** RestoFlow Staging calls Dispatcher Staging over HTTPS to quote and
  create deliveries; that endpoint is a Cloud Function. Without it there is no
  RestoFlow ↔ Dispatcher link, which is the point of this environment.
- **Can we proceed without it?** Partly. Everything up to and including the
  cart quote can be tested against the Firebase emulator suite locally. The
  full three-system end-to-end demo cannot: it needs a deployed Dispatcher
  staging endpoint that Vercel can reach.
- **Cost:** Blaze bills on usage with a free monthly tier. A staging project
  with a handful of test orders sits inside that tier; the realistic bill is
  ₦0–small. Set a budget alert (below) so it cannot surprise you.
- **Exact step if you approve:** `pack-delivery-staging` → ⚙ **Usage and
  billing → Details & settings → Modify plan → Blaze**, attach a billing
  account, then **Set a budget alert** at a low figure (e.g. $5/month).

**Do NOT** upgrade the production project's plan, and do not attach billing to
`restoflow-staging` — it does not need it.

**Tell me when done:** "dispatcher staging exists, blaze ON" — or
"dispatcher staging exists, blaze NOT approved", and I will scope the
end-to-end demo down to what the emulator can prove.

---

## Step 5 — Deploy rules and indexes to staging

**Service:** your terminal
**Where:** this repository
**Action:** run these exactly. Both name the project explicitly; neither is a
bare `firebase deploy`.

    ! firebase deploy --only firestore:rules --project restoflow-staging
    ! firebase deploy --only firestore:indexes --project restoflow-staging

Then, in `~/Desktop/pack_delivery/pack_delivery`:

    ! ./infra/rules-migration/deploy.sh staging

**Billing:** none.
**Do NOT:** run any of these without `--project`, and do not pass `production`
to the Dispatcher script — the Flutter query migration has to ship and be
adopted first (`infra/rules-migration/README.md`).
**Tell me when done:** "staging rules deployed" plus anything the CLI printed
in red.

---

## Step 6 — Vercel

**Service:** Vercel
The CLI is not installed here. Install it first so the remaining steps can be
scripted:

    ! npm i -g vercel
    ! vercel login

**Then, before anything is pushed,** open
https://vercel.com → the RestoFlow project → **Settings**, and check two things:

1. **Settings → Git → Production Branch.** Confirm it is `main` (or whatever
   your production branch is) and that it is *not* set to "all branches".
   This is what guarantees pushing `feat/dispatcher-integration` produces a
   Preview and cannot promote to Production.
2. **Settings → Environment Variables.** For each existing variable, check
   which environments it is scoped to. **If any production Firebase or Paystack
   value is ticked for "Preview", a preview build will connect to production.**
   Untick Preview on those before continuing.

This is why I have not pushed the branches: I cannot read either setting
without the CLI or the dashboard, and pushing before checking them is the one
action in this whole sequence that could reach production data.

**Billing:** none, on Hobby or Pro.
**Do NOT:** change anything scoped to Production.
**Tell me when done:** "vercel ready, production branch = `<name>`, preview vars
clean"

---

## Step 7 — Staging environment variables (Preview scope only)

**Where:** Vercel → RestoFlow project → **Settings → Environment Variables →
Add**. For every one of these, tick **Preview only**. Leave Production and
Development unticked.

`.env.staging.example` in this repo is the authoritative list with comments.
The values that matter:

| Variable | Value | Notes |
|---|---|---|
| `FIREBASE_ADMIN_PROJECT_ID` | `restoflow-staging` | from step 2 |
| `FIREBASE_ADMIN_CLIENT_EMAIL` | from the step-3 JSON | |
| `FIREBASE_ADMIN_PRIVATE_KEY` | from the step-3 JSON | paste with the `\n` escapes intact |
| `NEXT_PUBLIC_FIREBASE_*` | staging web app config | Project settings → General → Your apps → Web |
| `PAYSTACK_SECRET_KEY` | `sk_test_…` | **test key.** An `sk_live_` here charges real cards. |
| `NEXT_PUBLIC_APP_URL` | the preview host | used for the payment callback |
| `MARKETPLACE_ENABLED` | `true` | staging only — production stays off |
| `MARKETPLACE_PAYMENTS_ENABLED` | `true` | |
| `DELIVERY_INTEGRATION_ENABLED` | `true` | |
| `DELIVERY_ENVIRONMENT` | `staging` | |
| `DISPATCHER_API_BASE_URL` | the staging function URL from step 4 | |
| `DISPATCHER_API_KEY` | newly generated, staging-only | never the production one |
| `DISPATCHER_SIGNING_SECRET` | newly generated, staging-only | signs our requests to Dispatcher |
| `DISPATCHER_WEBHOOK_SECRET` | newly generated, staging-only | verifies Dispatcher's events to us — a **different** secret |
| `CRON_SECRET` | newly generated | |

There is deliberately no Paystack **public** key anywhere. Checkout calls
Paystack server-side and returns an `authorization_url`, so no key of any kind
reaches the phone.

Generate each shared secret with:

    ! openssl rand -hex 32

**Billing:** none.
**Do NOT:** reuse any production secret, and do not tick Production on any row.
**Tell me when done:** "staging env vars set, preview only"

---

## Step 8 — Paystack test keys

**Service:** Paystack dashboard
**Where:** https://dashboard.paystack.com → toggle to **Test mode** →
**Settings → API Keys & Webhooks**
**Actions:**
1. Copy the **test** secret and public keys into the step-7 variables.
2. Add a **test-mode** webhook URL pointing at the staging preview:
   `https://<preview-host>/api/webhooks/paystack`

**Billing:** none — test mode moves no money.
**Do NOT:** change the live-mode webhook URL. It is on a different tab and
changing it would break production payments.
**Tell me when done:** "paystack test keys set, test webhook pointed at staging"

---

## Step 9 — Staging Auth users

**Service:** Firebase console
**Where:** `restoflow-staging` → **Authentication → Users → Add user**
**Action:** create two, with any password you like:
- `staging.customer@example.invalid`
- `staging.other@example.invalid`

Copy each generated **UID**. `.invalid` is a reserved TLD that can never
resolve, so these addresses cannot receive mail even by accident.

The second account is not redundant: customer isolation is only proven by
signing in as one and failing to read the other's orders.

**Billing:** none.
**Tell me when done:** the two UIDs.

---

## Step 10 — Seed synthetic data

**Where:** this repository, after step 7's values exist locally in `.env.staging`

    ! npx tsx scripts/seed-staging-marketplace.ts

Run it with no flag first — it prints what it would do and writes nothing.
Then:

    ! STAGING_CUSTOMER_UID=<uid1> STAGING_OTHER_CUSTOMER_UID=<uid2> npx tsx scripts/seed-staging-marketplace.ts --confirm

The script refuses to run against any project id on its production denylist,
and against any id not on its staging allowlist.

**What it creates:** three invented restaurants (two on the marketplace, one
deliberately never opted in), eight menu items (one POS-only, one sold out, one
belonging to the non-marketplace restaurant), two customers, three addresses.
Nothing is copied from production.

**Tell me when done:** the script's summary output.

---

## Billing summary

| Item | Needed? | Plan | Approval |
|---|---|---|---|
| `restoflow-staging` Firestore + Email/Password auth | yes | Spark (free) | not needed |
| `pack-delivery-staging` RTDB | yes | Spark (free) | not needed |
| `pack-delivery-staging` Cloud Functions | yes, for the end-to-end demo | **Blaze** | **yours — step 4** |
| Phone / SMS auth | no | billable | not requested |
| Google Maps Distance Matrix | no | billable | avoided: `lib/marketplace/geo.ts` estimates road distance from haversine × 1.3, no API key |
| Paystack test mode | yes | free | not needed |
| Vercel Preview deployments | yes | included | not needed |

Two billable services were deliberately designed around rather than enabled:
distance uses a local estimate instead of a paid routing API, and staging sign-in
uses email/password instead of SMS.

---

# Progress log

## Done — 2026-09-03

| | |
|---|---|
| Firebase CLI authenticated | `nwabufohalexander@gmail.com` |
| `restoflow-staging` | created; Firestore (default), native mode |
| Firestore **rules** → `restoflow-staging` | deployed |
| Firestore **indexes** (6) → `restoflow-staging` | deployed |
| Web app on `restoflow-staging` | created — `1:137243969431:web:19cddeadf52dab384fe6d2` |
| `.env.staging` (RestoFlow) | written, gitignored, `chmod 600` |
| RTDB **rules** → `pack-delivery-staging` | deployed (the hardened ruleset) |
| Staging partner credential | generated, written to `api_keys/{sha256}` in `pack-delivery-staging` |
| `.env.pack-delivery-staging` | written, gitignored, `chmod 600` |
| `pack-delivery-staging` | upgraded to Blaze |

Every deploy named its project explicitly. Nothing was written to
`restaurant-saas-64235`, `pack-delivery-live`, or `pack-delivery`.

## A caveat on the staging rules rollback

`deploy.sh` now snapshots a project's live rules **before** overwriting them,
and rolls back to that snapshot rather than to a checked-in file. That change
was made after the first staging deploy, so `pack-delivery-staging.PREVIOUS.json`
currently holds the *already-migrated* rules — rolling staging back today is a
no-op. Staging is disposable, so this does not matter there.

It matters for production, and the mechanism now handles it: the first
production deploy will capture `pack-delivery-live`'s real live rules before
touching them.

**Why this changed.** The committed `database.rules.ROLLBACK.json` turns out to
match commit `77646e55`, not `main`. If production is running `main`'s rules,
"rolling back" would have deployed a third, different, never-tested ruleset in
the middle of an incident. A rollback target has to be read from the system you
are rolling back, at the moment you change it.

## Blocked

### B1 — Cloud Functions cannot deploy to `pack-delivery-staging`

```
Service account 684389898956-compute@developer.gserviceaccount.com was not found.
```

The project's **default compute service account does not exist**. Functions v2
runs on Cloud Run and defaults to that identity. The project was on Spark until
today; the account was most likely removed while it was downgraded.

**Fix (console, ~30 seconds):**
1. https://console.cloud.google.com/apis/library/compute.googleapis.com?project=pack-delivery-staging
2. Click **Enable**. Re-enabling recreates `684389898956-compute@developer.gserviceaccount.com`.
3. If it says already enabled, the account was deleted rather than absent — go to
   https://console.cloud.google.com/iam-admin/serviceaccounts?project=pack-delivery-staging
   and check for a deleted account to **Undelete** (Google keeps them for 30 days).

**Billing:** covered by the Blaze plan already on this project. Enabling the
Compute Engine API does not by itself start any billable resource — nothing is
provisioned until a function is deployed, and staging traffic sits in the free
tier.
**Do NOT** enable anything on `pack-delivery-live` or `pack-delivery`.
**Then tell me:** "compute API enabled" — I will redeploy the three functions.

### B2 — Service-account key for `restoflow-staging`

Needed for the RestoFlow server runtime, for the seed script, and to create the
two synthetic Auth users programmatically. Cannot be generated from the CLI.

1. https://console.firebase.google.com/project/restoflow-staging/settings/serviceaccounts/adminsdk
2. **Generate new private key** → **Generate key**. A JSON file downloads.
3. Open it and copy `client_email` and `private_key` into `~/Desktop/rest/.env.staging`
   (the two `TODO(human)` lines). Keep the `\n` escapes in the private key, and
   wrap the value in double quotes.
4. Delete the downloaded JSON afterwards. Do not put it in either repository.

**Billing:** none.
**Then tell me:** "staging admin key set".

### B3 — Paystack TEST secret key

Dashboard → **Test mode** → Settings → API Keys & Webhooks → copy the
`sk_test_…` secret into `PAYSTACK_SECRET_KEY` in `.env.staging`.
Do not touch the live-mode tab.

### B4 — Vercel

Still not installed; `npm i -g vercel && vercel login`. Needed for the preview
deployment and, before any push, to confirm the production branch and that no
production value is scoped to Preview.
