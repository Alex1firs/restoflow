# Production Deployment Checklist — RestoFlow

Work through this list top-to-bottom before accepting real customers.
Every unchecked item is a known risk to security, data integrity, or revenue.

---

## 1. Firebase Console (manual — do these first)

- [ ] **Enable Email/Password sign-in**
  - Firebase Console → Authentication → Sign-in method → Email/Password → Enable
- [ ] **Create the first super-admin user**
  - Firebase Console → Authentication → Add user (email + temporary password)
  - Run `npx tsx scripts/create-admin.ts` to create the matching Firestore `users/` doc with `role: "super_admin"`
- [ ] **Deploy Firestore security rules**
  ```
  firebase deploy --only firestore:rules
  ```
- [ ] **Deploy Storage security rules**
  ```
  firebase deploy --only storage
  ```
- [ ] **Seed subscription plans**
  ```
  npx tsx scripts/seed-plans.ts
  ```

---

## 2. Environment Variables (Vercel → Project Settings → Environment Variables)

All of these must be set for **Production** (and optionally Preview/Development).

### Firebase Client SDK (public)
| Variable | Where to find it |
|---|---|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Firebase Console → Project Settings → General → Your apps |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | same |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | same |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | same |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | same |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | same |

### Firebase Admin SDK (server-only — never public)
| Variable | Where to find it |
|---|---|
| `FIREBASE_ADMIN_PROJECT_ID` | Firebase Console → Project Settings → Service Accounts → Generate new private key |
| `FIREBASE_ADMIN_CLIENT_EMAIL` | same JSON file |
| `FIREBASE_ADMIN_PRIVATE_KEY` | same JSON file — paste the full `"private_key"` value including `\n` characters |

### Paystack (server-only)
| Variable | Where to find it |
|---|---|
| `PAYSTACK_SECRET_KEY` | Paystack Dashboard → Settings → API Keys & Webhooks → Secret Key |

### App URL
| Variable | Value |
|---|---|
| `NEXT_PUBLIC_APP_URL` | Your production domain, e.g. `https://app.restoflow.org` (no trailing slash) |

### Webhook relay
| Variable | Value |
|---|---|
| `WEBHOOK_URL_REST` | `https://your-domain.com/api/webhooks/paystack` |

Point your Paystack **Live Webhook URL** at `https://your-domain.com/api/webhooks/relay`.

### Optional integrations
| Variable | Value |
|---|---|
| `WHATSAPP_ACCESS_TOKEN` | Meta for Developers → your app → WhatsApp → API Setup |
| `WHATSAPP_PHONE_NUMBER_ID` | same |
| `WHATSAPP_TEMPLATE_NEW_ORDER` | Name of approved WhatsApp template for new orders |
| `TERMII_API_KEY` | Termii dashboard → API Keys |
| `GOOGLE_CLIENT_ID` | Google Cloud Console → OAuth 2.0 credentials |
| `GOOGLE_CLIENT_SECRET` | same |
| `GOOGLE_REDIRECT_URI` | `https://your-domain.com/api/admin/google-business/callback` |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | Required when `GOOGLE_CLIENT_ID` is set. Run `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` to generate. |
| `NEXT_PUBLIC_SUPPORT_WHATSAPP` | Support WhatsApp number (digits only, e.g. `2347012345678`). Leave blank to hide the help button. |
| `VERCEL_API_TOKEN` | Vercel account settings → Tokens (needed for custom domain registration) |
| `VERCEL_PROJECT_ID` | Vercel project settings → General |

---

## 3. Paystack Setup

- [ ] Switch Paystack keys to **Live** mode (not Test)
- [ ] Set **Webhook URL** in Paystack Dashboard → Settings → API Keys & Webhooks:
  `https://your-domain.com/api/webhooks/relay`
- [ ] Create a **Paystack Subaccount** for the first restaurant (or use the payment settings UI in the admin panel)
- [ ] Test a real transaction end-to-end in Live mode

---

## 4. Domain & Hosting

- [ ] Custom domain added and verified in Vercel
- [ ] `proxy.ts` — update `MAIN_HOSTS` and `BASE_DOMAINS` to match your production domain
- [ ] SSL certificate auto-provisioned by Vercel (check green lock in browser)
- [ ] Wildcard subdomain `*.restoflow.org` (or your domain) configured if using subdomain routing

---

## 5. Pre-Launch Smoke Test

Run these in order on the production URL:

- [ ] `/` — landing page loads
- [ ] `/get-started` — onboarding form renders; submit with a test card (Paystack test mode first)
- [ ] `/admin/login` — login form works with a real Firebase Auth user
- [ ] `/admin/[slug]/dashboard` — dashboard loads with no errors
- [ ] `/admin/[slug]/menu` — add a menu item; image upload works
- [ ] `/r/[slug]` — storefront renders the new menu item
- [ ] Place a cash order → check `/track/[orderId]?t=[token]` link works
- [ ] Place an online order (Paystack test card) → verify callback and tracking link
- [ ] `/admin/[slug]/kitchen` — new order appears in KDS
- [ ] `/admin/[slug]/orders` — status update to "preparing" → verify real-time update on track page
- [ ] `/super-admin` — overview loads; restaurants list shows the test restaurant
- [ ] Webhook delivery — Paystack webhook logs show 200 response; no events in `relay_dead_letter` Firestore collection

---

## 6. Firestore TTL Setup (one-time)

Enable automatic cleanup of rate-limit documents:

- [ ] Firebase Console → Firestore → Indexes → TTL → Add field
  - Collection: `rate_limits`, Field: `expiresAt`, Mode: Timestamp

**To verify TTL is active after configuration:**
1. In Firebase Console → Firestore → Indexes → TTL, the `rate_limits / expiresAt` entry should appear with status **Enabled**.
2. Wait 10–15 minutes after enabling, then check whether old `rate_limits` documents (those with `expiresAt` in the past) are being deleted automatically.
3. Alternatively, run this check from the Firebase CLI (requires `jq`):
   ```
   firebase firestore:get rate_limits --project YOUR_PROJECT_ID | jq '.[].fields.expiresAt'
   ```
   If TTL is working, documents past their `expiresAt` timestamp will no longer appear within ~24 hours of expiry.

> Without TTL enabled the `rate_limits` collection will grow unboundedly. Rate limiting still works correctly; only the cleanup does not happen automatically.

---

## 7. Post-Deploy Verification

- [ ] **Firestore rules deployed** — test in Firebase Console → Firestore → Rules Playground:
  - Anonymous user cannot `list` orders
  - Anonymous user cannot `write` to restaurants
  - Restaurant staff can `update` order status
- [ ] **Storage rules deployed** — test in Firebase Console → Storage → Rules
- [ ] Check Vercel function logs for any startup errors (missing env vars throw immediately)
- [ ] Review `relay_dead_letter` collection — should be empty; non-empty means a webhook delivery failed
- [ ] Confirm no `pendingResetLink` fields are left indefinitely in `users/` docs (should be cleared once email delivery is configured)

---

## 8. Google Business Token Migration (post-deploy — required for any early adopters)

Restaurants that connected Google Business **before** this deploy have plaintext OAuth tokens stored in Firestore. The new deploy encrypts all tokens at rest (AES-256-GCM).

**What happens without migration:** Calls to the Google Business API will return HTTP 401 with `{ "reconnect": true }` for those restaurants. No data is corrupted.

**Required action per affected restaurant:**
1. Admin user goes to **Dashboard → Google Business → Disconnect**
2. Reconnects via **Connect Google Business** — this stores new encrypted tokens
3. Verify the Google Business panel shows "Connected" with the correct email

There is no automated migration script — the reconnect flow is the migration.

---

## 9. Reset Link Delivery (pre-launch — manual workflow)

Password reset links are currently **not emailed automatically**. They are stored in Firestore and must be delivered manually by an admin.

**Onboarding reset links** (new restaurant owners):
- Stored at: `onboardings/{id}.resetLink`
- Retrieve: Firebase Console → Firestore → `onboardings` → find by restaurant slug → copy `resetLink`
- Send to the owner via email or WhatsApp manually

**Staff account reset links**:
- Stored at: `users/{uid}.pendingResetLink`
- Retrieve: Firebase Console → Firestore → `users` → find by UID → copy `pendingResetLink`
- Send to the staff member manually
- Clear the field after delivery: set `pendingResetLink` to `FieldValue.delete()`

**Security note:** Reset links are single-use Firebase Auth links. They are never returned in API responses. Access is restricted to the Firebase Admin SDK (`onboardings` rules block all client reads).

**Future sprint:** Implement email delivery via SendGrid or Resend to automate this workflow.

---

## 10. Known Gaps (Schedule for first sprint after launch)

These were audited and accepted as P2 — not launch blockers, but must be tracked:

- [ ] Implement email delivery for onboarding reset links (currently manual — see §9)
- [ ] Implement email delivery for staff account reset links (currently manual — see §9)
- [ ] Add cursor-based pagination to loyalty customer list (currently hard-capped at 100)
- [ ] Reconcile Terms of Service vs. Refund Policy (Terms says "non-refundable", Refund Policy lists exceptions)
- [ ] Implement Google OAuth token refresh (1-hour expiry — users must re-connect after expiry)
