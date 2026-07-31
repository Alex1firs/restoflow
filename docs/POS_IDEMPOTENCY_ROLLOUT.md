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

---

# Part 2 — POS reliability (Fix 3, Fix 5, Fix 4)

## 9. Fix 3 — bounded submission

`POS_SUBMIT_TIMEOUT_MS = 20_000`, `POS_SYNC_TIMEOUT_MS = 30_000` (`lib/pos/submit.ts`).

**Why 20s.** Sized for real Nigerian networks, not a lab. Tills run on mobile
broadband and tethered 3G/4G where a slow-but-working request takes many seconds,
and the server side of one order is itself several round trips (Firebase session
verification → subscription read → menu query → transaction). A short timeout
would abort requests that were about to succeed, and every false timeout pushes an
order into the queue and delays the kitchen ticket. 20s is roughly 4–6× a healthy
submission and still short enough that a cashier never sits guessing. The sync
timeout is longer because no cashier is waiting on it.

**Lifecycle.** Every submission reaches exactly one state:

The governing question is never "did the request fail?" but **"do we KNOW whether
the server committed?"**

| Classification | Preserved? | Queue state | Why |
|---|---|---|---|
| `timeout` | yes | `pending` | outcome UNKNOWN — the order may already exist |
| `network` | yes | `pending` | connection died mid-flight, outcome unknown |
| `offline` | yes | `pending` | never reached the server |
| `server-retryable` (408/425/429/500/502/503/504) | yes | `pending` | **may have committed** — see §9a |
| `auth-required` (401/403) | yes | `auth_required` | preserved but PAUSED — see §9b |
| `server-permanent` (501/505) | yes | `attention` | preserved, but repetition cannot fix it |
| `teardown` | **no** | — | unmount/navigation; cart + key are still persisted, so the cashier resubmits under the same key and the server replays |
| `validation` (4xx) | **no** | — | payload rejected before any write |
| `conflict` (409) | **no** | — | this key already belongs to a different order |

### 9a. Why a 5xx is uncertain, not a failure

An earlier revision of this work classified 5xx as "definitely not committed".
**That was wrong.** `app/api/admin/pos/route.ts` wraps the whole handler in a catch
that returns 500, and there is real work *after* the Firestore transaction commits:

- the replay branch re-reads the order document (`orders.doc(id).get()`), a network
  call that can throw once the order already exists
- response serialisation runs inside the same try
- a proxy or serverless layer can return 502/504 after the function returned

So a 500 cannot be read as "no order was created". Retryable 5xx responses are
therefore preserved under the **same** `localOrderId` and retried, and the cashier
is told *"We could not confirm the server response. Your order has been preserved
and can be retried safely."* — never "order not created".

### 9b. 401 / 403 handling

A 401 is **not** an ordinary network failure. Retrying it on every reconnect is an
authentication loop that can never succeed.

- The order, its `localOrderId`, cart, `customPrice`, item notes, order note,
  pricing mode, modifiers, service mode and table are all preserved untouched.
- The record is parked as `auth_required`, with **no** `nextRetryAt` — it waits for
  a sign-in, not a timer, and is skipped by every automatic sync run.
- Cashier message: *"Your session has expired. This order is safely preserved.
  Please sign in again to complete synchronisation."* It deliberately does **not**
  claim the order reached the restaurant server.
- `resumeAuthRequiredRecords()` un-parks records **only after a request has
  actually succeeded**, which is proof the session works. Resumed records reuse the
  original key, so the server replays if it had already accepted the order.
- Parked records remain in the cashier-visible attention count.

A timeout **never** mints a new key. The queued copy carries the same
`localOrderId`, so synchronisation returns the canonical existing order.

**Ordered hand-off.** `await dbPut` → `finishActiveDraft()` → clear cart. If the
IndexedDB write throws, none of that runs: the cart and the transaction identity
are both preserved and the cashier sees *"Could not save this order on the device.
The cart has been kept — please try again."* It never claims the order was saved.

**Double-submit.** A synchronous `submitInFlightRef` blocks re-entry within the
same tick, which React state alone cannot. The server remains the real barrier.

## 9c. Retry backoff

Bounded exponential backoff with ±20% jitter (`RETRY_SCHEDULE_MS`), on
`nextRetryAt` / `lastAttemptAt` / `lastErrorCode` / `lastErrorCategory`:

| Failure | Delay before next attempt |
|---|---|
| 1st | ~12s |
| 2nd | ~30s |
| 3rd | ~60s |
| 4th | ~2.5 min |
| 5th and beyond | ~5 min (cap) |

Quick enough that a brief drop-out resolves while the customer is still at the
counter; slow enough that a weak link is not hammered. Jitter stops many terminals
reconnecting in lockstep. Delays are clamped, so they can never be negative or
exceed the cap.

- A reconnect retries only when `nextRetryAt` has arrived.
- **Never applied** to `synced` records, live leases, 409 conflicts,
  `auth_required` records, or anything parked as non-retryable.
- A **recovered stranded** record is due immediately — it was interrupted, not
  rejected, so it does not inherit a backoff window it never earned.
- After `MAX_AUTO_ATTEMPTS` (8) the record is parked as `attention`. It is
  **never deleted** and stays visible.
- Success clears the schedule and the diagnostics.
- **Manual "Sync now"** clears the wait for waiting records, but still goes
  through the atomic claim — so it cannot steal an in-flight attempt, two tabs
  cannot both retry the same record, and no second queue record is created. It
  deliberately skips parked records.

## 9d. 409 conflicts — operational state

- Parked as `attention`; **never** retried automatically.
- Full order contents and identity preserved; nothing deleted.
- Counted in the cashier-visible "N orders need attention" indicator.
- Cashier-safe wording only: *"Could not be matched to an existing order — needs
  review"*. No fingerprints, claim ids, or internal identifiers are exposed.
- Safe actions are to check Open Bills or ask a manager to review. There is
  deliberately **no** button that re-submits the same cart under a new identity.

## 10. Fix 5 — stranded-record recovery

Lease fields on each queue record: `syncOwnerId`, `syncAttemptId`, `syncStartedAt`,
`leaseExpiresAt`, `attemptCount`, `lastErrorAt`, plus `syncedOrderId` /
`syncedOrderNumber` on success.

- A record is `syncing` **only** via an atomic claim, and only if not already held.
- Startup and every sync run first recover records whose lease has lapsed, and
  records left `syncing` by an older app version with **no lease metadata at all**
  (treated as having no credible owner).
- Recovery is idempotent, never deletes anything, and never re-mints an identity.
  `localOrderId`, items, `customPrice` and notes are all preserved.
- Stranded records are now counted in the cashier-visible pending badge and appear
  in Open Bills. Their absence from those filters is what made a lost order
  invisible.
- On recovery the cashier sees *"N unsynced orders were recovered and will sync
  automatically"* — no internals.

## 11. Fix 4 — cross-tab ownership

`dbUpdateAtomic` (`lib/offline-db.ts`) performs read-modify-write inside **one**
IndexedDB transaction. IndexedDB serialises transactions per origin, so no other
tab can interleave — this is the authoritative claim.

**Web Locks is deliberately unused.** It is not available in every context this POS
runs in, and a lock some context silently lacks is not a lock. BroadcastChannel
(`lib/pos/sync-channel.ts`) is advisory only: it lets a non-syncing tab refresh its
counts, and is guarded so a missing API degrades to a no-op. The receiver **only**
refreshes counts — never prints a ticket, opens a receipt, clears a cart or ends a
draft, so a second tab cannot duplicate completion effects.

`LEASE_DURATION_MS = 120_000`: comfortably longer than the 30s sync timeout and
longer than background-tab timer throttling (~1/min), so a live-but-backgrounded
till is never robbed of its record.

**Timeout / lease relationship (verified in `sync-lease.test.ts` [T1]):** the 30s
sync request cannot outlive the 120s lease — a 4x margin. A request that returns
before expiry releases the lease immediately rather than holding it for the rest of
the window. A dead tab's lease is still respected past the request timeout (so a
slow-but-alive request is never stolen) and becomes reclaimable once it lapses.
Backoff is scheduled from `lastAttemptAt`, i.e. from the completed attempt, so
attempts can never overlap. A manual retry refuses to touch a live lease.

## 12. The remaining hard-crash gap

**Sequence.** Cashier submits → server commits → acknowledgement lost → the
renderer or device dies *without* firing `pagehide`/`beforeunload` (an "Aw, Snap!"
crash, a kernel panic, or power loss) → the browser is reopened and the cart
restored **within 90 seconds** → the cashier resubmits. The orphaned draft still
looks live, so a new identity is minted and a second order can be created.

**Probability.** Low. It needs a hard crash (clean closes, browser quit and OS
shutdown all fire `pagehide`, which releases the draft for immediate recovery),
*and* a reopen-and-resubmit inside 90s, *and* the first request to have actually
committed. Reopening a browser and re-keying an order typically takes longer than
the window on its own.

**Why it was not eliminated.** Evaluated and rejected:
- *Shorten the staleness window.* Would let a second tab adopt a live
  background-throttled till's draft — two cashiers sharing one identity, with the
  second genuine order refused as a conflicting replay. Strictly worse.
- *Persist a "submission in flight" marker and adopt it immediately.* The draft
  cart lives in shared localStorage, so two tabs can hold the same cart; immediate
  adoption without a liveness check reintroduces exactly the cross-tab sharing the
  requirement forbids.
- *Cart-fingerprint matching.* Resolves *which* orphan to adopt, but still cannot
  bypass the liveness check, so it does not close this window.

**Mitigation in place.** `pagehide` **and** `beforeunload` both release, so only a
true crash reaches the staleness path. If a duplicate does occur it is immediately
visible: both orders appear in Open Bills / the dashboard with sequential order
numbers, rather than being silent.

**Cashier recovery procedure.** After any crash-and-reopen, check Open Bills
before re-ringing. If two identical orders appear, void the later one (the higher
order number) using the existing void flow — do not delete anything by hand.

## 13. Playwright

Added as a **devDependency** (`@playwright/test`), with `playwright.config.ts`
scoped to `lib/pos/__tests__/browser`.

- **Why:** the multi-tab guarantees (separate identities per tab, per-record
  claims, restart recovery) can only be proven in a real browser with real
  IndexedDB and real sessionStorage semantics. Without an automated test they can
  regress silently.
- **Production impact: none.** It is dev-only and no application code imports it,
  so it cannot enter the client bundle. `next build` never sees the specs —
  `testDir` is scoped and `tsconfig.json` excludes that folder.
- **Vercel:** installs devDependencies at build time, but browsers download only
  on an explicit `playwright install`, which Vercel never runs. No change to
  deploy size or time. Do not add `playwright install` to the Vercel build.
- **CI:** run `npx playwright install --with-deps chromium` in a dedicated job,
  then `npm run test:pos:browser:build && npm run test:pos:browser`. Playwright's
  `webServer` starts and stops the static harness itself.

## 14. Test commands (all)

```bash
npm run test:pos                                    # 79 unit checks, 6 suites
npm run test:pos:emulator                           # real Firestore + real route handlers (JDK 21)
npm run test:pos:browser:build && npm run test:pos:browser   # 7 real-browser multi-tab checks
npx tsc --noEmit && npm run build
```
