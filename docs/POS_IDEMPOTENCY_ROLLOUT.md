# POS order idempotency — rollout, compatibility & retention

Covers deploying Fix 1 (durable `localOrderId`) and Fix 2 (atomic server-side
idempotency) to restaurants that are **live and taking orders right now**,
including Tricia's Kitchen.

## What changed

One cashier transaction now owns one stable `localOrderId` that survives reload
**and browser restart**, and both order entry points funnel through a single
atomic commit:

| | |
|---|---|
| `POST /api/admin/pos` | online create — key **optional during rollout** |
| `POST /api/admin/pos/sync` | offline queue drain — key **required** |
| `pos_order_claims/{restaurantId}__{localOrderId}` | server-only reservation; the uniqueness guarantee |

The claim, the order document and the `orderCounter` increment commit in one
Firestore transaction. A replay writes nothing and returns the canonical order.

---

## 1. Durable draft identity (client)

```
localStorage["rf_pos_drafts"]      { [draftId]: PosDraft }   durable
localStorage["rf_pos_draft_cart"]  the cart                  unchanged
sessionStorage["rf_pos_draft_id"]  the draftId THIS tab owns  per-tab
```

Durable storage holds the records; per-tab storage holds only *ownership*. That
split gives tab isolation and browser-restart recovery at the same time:

| Event | Outcome |
|---|---|
| Reload the tab | `sessionStorage` still names the draft → **same id** |
| Reopen the browser with a restored cart | `sessionStorage` is empty, so the tab **adopts** the orphaned draft → **same id** |
| A second tab | the first tab's draft is live, so it is not adoptable → **different id** |
| Order committed / queued / abandoned | only *that* draft is removed; other tabs untouched |
| Several recoverable drafts | reported **ambiguous**: submission is blocked and the cashier is asked to check Open Bills. Never merged, never re-minted. |

**Liveness.** The owning tab refreshes `heartbeatAt` every 5s and sets `released`
on `pagehide`/`beforeunload`. A draft is adoptable only when released or stale.
`STALE_MS` is deliberately long (90s) because Chrome throttles background-tab
timers to ~1/min — a short window would let a second tab adopt a live till's
draft, and two cashiers sharing one identity is worse than the duplicate this
fixes. `released` carries the normal recovery path; staleness is only the
hard-crash backstop.

**Residual gap:** a hard crash (no `pagehide`) followed by a resubmit *within* 90
seconds mints a new identity and can still duplicate. Every clean close — tab
close, browser quit, OS shutdown — fires `pagehide`, so this is limited to a true
crash inside a 90-second window. Asserted in `draft.test.ts` [2a] so it cannot
change silently.

## 2. `firebase.json` compatibility assessment

`firebase.json` **did not previously exist** in this repo, and there is **no
`.firebaserc`** and **no CI workflow** (`.github/`, etc. — none present).
`DEPLOYMENT.md` already instructs operators to run `firebase deploy --only
firestore:rules`, which requires a `firestore.rules` entry; adding the file makes
that path explicit rather than changing behaviour.

Verified, item by item:

| Concern | Result |
|---|---|
| Changes the active Firebase project | **No.** No project id in the file, and no `.firebaserc`. The CLI still requires an explicit `--project` or an interactive choice. |
| Changes hosting configuration | **No.** There is no `hosting` key, so hosting is never deployed. |
| Deploys unintended resources | Only `firestore.rules` is declared. Always deploy with `--only firestore:rules`. |
| Overwrites existing indexes | **No.** `firestore.indexes` is deliberately **not** declared, so the CLI skips index deployment entirely. Declaring it with a stale file is exactly how production indexes get clobbered — that is why it is absent. |
| Alters existing emulator/rules commands | The documented `--only firestore:rules` behaves the same. `--only storage` is intentionally **not** wired here, so storage rules are untouched by this change. |
| Causes Vercel problems | **No.** Vercel reads `vercel.json` and the Next build; `firebase.json` is not consumed by either. |
| Changes a CI deployment workflow | **No workflow exists** to change. |

**Purpose:** this file exists to run the Firestore emulator test suites and to
make the already-documented rules path explicit. Keep it minimal. Do **not** run
a bare `firebase deploy`.

## 3. `firestore.rules` compatibility assessment

The diff is **+10 lines, purely additive** — one new block, no existing rule
edited:

```
match /pos_order_claims/{claimId} {
  allow read:  if false;
  allow write: if false;
}
```

What happens when it is eventually deployed:

- **Direct client reads/writes to `pos_order_claims` are denied.** Intended: no
  client ever touches this collection.
- **The server keeps working.** The Admin SDK bypasses security rules entirely,
  so the routes read and write claims normally.
- **Access to `orders` is unchanged.** That block is byte-for-byte identical.
- **Unsettled bills are unchanged.** Settling goes through the server, and the
  client-side `orders` update rule (`status`/`rejectionReason` only) is untouched.
- **Restaurant isolation is unchanged.** No helper function was modified.
- **Cached clients keep working.** They never referenced this collection, and the
  ordinary POS routes are server-side.
- **No order document needs modification.** Claims are separate documents; the
  `localOrderId` field on new orders is additive and optional.

Deploying is also *not a prerequisite* for the code: an undeclared collection is
already client-denied by default. Shipping the rule makes the intent explicit.

## 4. Live-data compatibility (audited via fixtures)

`lib/pos/__tests__/live-compat.test.ts` pins the production shapes — legacy
unsettled counter bills, dine-in bills, paid/completed archives, orders written by
the old sync route, and pre-fix IndexedDB queue records. Confirmed:

- a legacy unsettled order with no `localOrderId` still **views, opens from Open
  Bills, prints and settles**; its document id and `orderNumber` are unchanged
- **no historical order needs a claim**, and none is created for one
- **no migration of existing order documents** is introduced or required
- existing **pending queue records keep their own key** and sync exactly once; an
  absent `customPrice` fingerprints identically to an explicit `null`
- a queue record with a blank key is repaired **once**, then reused
- **paid/completed orders are untouched**
- dashboards and revenue totals aggregate identically across mixed shapes
- a **cached pre-idempotency client still creates orders** (compatibility window)

## 5. Live rollout plan

### A. Code merge
Merge to `main`. No data touched. `POS_REQUIRE_IDEMPOTENCY_KEY` stays unset.

### B. Before deploying
1. **Confirm a Firestore backup / PITR** for the project (Firebase console →
   Firestore → Backups). Do not proceed without one.
2. **Record baseline counts per restaurant** so nothing is ambiguous afterwards:
   total `orders`, plus `orders` where `paymentStatus == "unpaid"` (open bills).
   Take these from the existing super-admin views — do not write a script that
   mutates anything.
3. Note the current Vercel production deployment id for rollback.

### C. Vercel deployment
Deploy server + client together (they ship in one Next build). This is safe in
both directions:
- a **stale cached client** sends no key → the online route keeps today's exact
  behaviour (`routes.test.ts` [R8])
- an **order queued by the old client** is found by the pre-fix safety-net lookup
  and back-filled with a claim instead of duplicated (`emulator.test.ts` [E7])

Prefer a window outside service hours.

### D. PWA update propagation
No `sw.js` change is needed. As inspected:

| Behaviour | Effect |
|---|---|
| POS route is **network-first**, cached to `restoflow-pos-html-v2` | an online terminal gets fresh HTML on its next navigation/reload, which references the new hashed chunks |
| `/_next/static/*` **cache-first** | safe — Next filenames are content-hashed, so new code means new URLs |
| `/api/*` in `BYPASS_PATTERNS` | order requests are never served from cache |
| `skipWaiting()` + `clients.claim()` | the new worker takes over open pages; harmless here because the API is bypassed and static URLs are hashed |
| `activate` deletes caches other than the two current ones | **do not bump `CACHE_NAME` during service hours** — offline, a not-yet-loaded lazy chunk could 404 |

**Do not force a refresh.** No `location.reload()` on `controllerchange`, no
auto-reload prompt mid-cart — that would discard a cashier's open order, which is
the failure this project exists to remove. Terminals upgrade on their next natural
reload; if one needs nudging, ask staff to reload **between** orders.

### E. Restaurant verification (Tricia's Kitchen)
Walk through, in order, and stop at the first failure:
1. Open an **existing unsettled bill** from Open Bills.
2. **Settle** that old bill; confirm the receipt prints with the **original order
   number**.
3. Create a **new online order**; confirm one order appears, numbered sequentially.
4. Turn off the network; create an **offline order**; confirm the kitchen slip
   prints and the bill shows in Open Bills.
5. Restore the network; confirm the queue drains and **exactly one** order appears.
6. **Print the canonical receipt** for that synced order and check the order id
   and number match the dashboard.
7. Re-check the baseline counts from step B: total orders should have increased by
   exactly the number of orders actually rung up.

### F. Monitoring
```
POS legacy client: order created without localOrderId. restaurant=<slug> staffId=<uid>
```
A terminal is on a pre-idempotency bundle and **that order had no duplicate
protection**. Distinct `restaurant`/`staffId` pairs are the burn-down.

```
POS INTEGRITY: claim resolves to a missing order. restaurant=<slug> localOrderId=<key> orderId=<id>
```
Should never appear. Means an order document was deleted out of band while its
claim survived. The request is refused with a 500 rather than writing a
replacement, so a duplicate cannot sneak back in. Investigate before touching the
claim.

Also dashboard 409s from either POS route (a key reused for a materially different
order — rare, and cashier-visible).

### G. Enforcement (later)
**Exit criterion:** the `POS legacy client` warning absent for a full business week
across all restaurants. **Then** set `POS_REQUIRE_IDEMPOTENCY_KEY=true`; key-less
requests get `426` and the cashier sees *"This point-of-sale app is out of date.
Please reload the page to continue."* No code change, no client redeploy, revert
by unsetting. Flip it outside service hours only.

## 6. Rollback

**Never deletes orders or claims.**

1. **Vercel:** promote the previous deployment (recorded in step B). That is the
   whole rollback — the code is stateless.
2. If enforcement was enabled, **unset `POS_REQUIRE_IDEMPOTENCY_KEY` first**, or
   rolled-back clients will be rejected.
3. **Leave `pos_order_claims` in place.** Claims are inert to the old code, and
   are picked up again on re-deploy. Deleting them restores the duplicate window
   for every key still sitting in an offline queue.
4. **Do not roll back `firestore.rules`** — the added block only denies client
   access to a collection the old code never used.
5. Orders created while the new code was live keep their `localOrderId` field; the
   old handlers ignore it. No cleanup, no migration.
6. Client-side, `rf_pos_drafts` is ignored by the old bundle and pruned after 7
   days. `rf_pos_draft_cart` is untouched by this change, so no cart is lost.

## 7. `pos_order_claims` growth and retention

One small document per keyed POS order, ~200–300 bytes.

| Volume | Documents/year | Storage/year |
|---|---|---|
| 200 orders/day, 1 restaurant | ~73,000 | ~20 MB |
| 200 orders/day, 50 restaurants | ~3.65 M | ~1 GB |

Negligible, and reads are single document-ID lookups so collection size does not
affect query cost.

**Do not add a TTL.** The claim *is* the uniqueness mechanism: deleting one
restores the duplicate window for that key, and a queue record can be retried
arbitrarily long after creation (a terminal offline over a weekend, a record stuck
in `failed`). A TTL shorter than the longest possible queue lifetime reintroduces
the exact bug this fixes.

Safe future retention, **only once a second permanent uniqueness mechanism
exists** (e.g. a deterministic order document id keyed on
`restaurantId + localOrderId`, so uniqueness survives claim deletion):
1. Establish that mechanism and verify it in the emulator suite.
2. Only then expire claims older than a bound that provably exceeds the maximum
   offline-queue lifetime (suggest 180 days, not 30).
3. Never delete a claim whose order document is missing — that is the integrity
   signal in §5F.

## 8. Test commands

```bash
npm run test:pos              # unit: idempotency, draft identity, live-data compat
npm run test:pos:emulator     # real Firestore + real Next.js route handlers (needs JDK 21)
npx tsc --noEmit
npm run build
```

Browser multi-tab (Playwright not a repo dependency):
```bash
npm i -D @playwright/test && npx playwright install chromium
npx esbuild lib/pos/draft.ts --bundle --format=iife --global-name=PosDraft \
  --outfile=lib/pos/__tests__/browser/draft.bundle.js
npx http-server lib/pos/__tests__/browser -p 8098 &
npx playwright test lib/pos/__tests__/browser/multi-tab.spec.ts
```
If the browser cannot reach loopback (observed in one sandbox), serve on
`0.0.0.0` and set `POS_HARNESS_URL=http://<LAN-IP>:8098/multi-tab.html`.

Manual two-tab check: open `multi-tab.html` in two tabs and use the buttons —
`set-cart` → `mount` in both (ids must differ), reload both (ids must persist),
`handoff` in one (the other's id must not change), then `release` →
`new-session` → `mount` (the id must come back as `adopted`).
