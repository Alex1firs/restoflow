/**
 * POS durable draft identity tests.
 * Run: npx tsx lib/pos/__tests__/draft.test.ts
 *
 * The gap these close: sessionStorage survives a reload but not the browser
 * closing. If the server committed an order, the acknowledgement was lost, and
 * the browser closed before the offline hand-off finished, the restored cart used
 * to be resubmitted under a NEW key — and duplicated the order.
 *
 * Storage model under test:
 *   localStorage["rf_pos_drafts"]     durable, survives browser restart
 *   sessionStorage["rf_pos_draft_id"] per-tab ownership only
 *
 * A `Browser` owns the localStorage; each `Tab` gets its own sessionStorage.
 * Closing the browser drops every tab session but keeps localStorage — exactly
 * the real failure this has to survive.
 */

import assert from "node:assert/strict";
import {
  DRAFTS_KEY,
  OWNED_DRAFT_KEY,
  STALE_MS,
  endDraft,
  isAdoptable,
  readDrafts,
  releaseDraft,
  resolveDraft,
  touchDraft,
  type DraftResolution,
  type KeyValueStorage,
  type PosDraft,
} from "../draft";
import { normalizeQueuedOrderKey } from "../idempotency";
import { mintTxnId } from "../txn-id";

let passed = 0;
const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

class MemStorage implements KeyValueStorage {
  readonly map = new Map<string, string>();
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

/** One browser profile: durable localStorage plus the persisted draft cart. */
class Browser {
  local = new MemStorage();
  /** Stands in for localStorage["rf_pos_draft_cart"]. */
  cart: unknown[] = [];
  /** Closing the browser destroys tab sessions but NOT localStorage. */
  restart(): void {
    this.tabs = [];
  }
  tabs: Tab[] = [];
  openTab(): Tab {
    const tab = new Tab(this);
    this.tabs.push(tab);
    return tab;
  }
}

/** One tab: its own sessionStorage, sharing the browser's localStorage. */
class Tab {
  session = new MemStorage();
  constructor(readonly browser: Browser) {}

  /** What POSClient does on mount. */
  mount(now: number) {
    return resolveDraft({
      local: this.browser.local,
      session: this.session,
      now,
      hasPersistedCart: this.browser.cart.length > 0,
      mint: seqMint,
    });
  }
  heartbeat(now: number, draftId: string) {
    touchDraft(this.browser.local, draftId, now);
  }
  /** pagehide */
  hide(now: number, draftId: string) {
    releaseDraft(this.browser.local, draftId, now);
  }
  /** Transaction finished: committed, queued, or abandoned. */
  finish(draftId: string) {
    endDraft(this.browser.local, this.session, draftId);
  }
}

let seq = 0;
const seqMint = () => `id-${++seq}`;

const T0 = 1_700_000_000_000;
/** Narrows a resolution to one that carries a draft, failing loudly if not. */
function draftOf(r: DraftResolution): PosDraft {
  assert.notEqual(r.kind, "ambiguous", `expected a resolved draft, got ${r.kind}`);
  return (r as Exclude<DraftResolution, { kind: "ambiguous" }>).draft;
}
const keyOf = (r: DraftResolution) => draftOf(r).localOrderId;

// ── 1 · THE GAP: crash before hand-off, browser restart, restored cart ───────
test("[1] REGRESSION: response lost, browser closes before queue hand-off, restored draft keeps its id", () => {
  const browser = new Browser();

  // Cashier builds a cart and submits. The draft (and its key) is persisted
  // BEFORE the request leaves, which is what makes recovery possible.
  const tabA = browser.openTab();
  browser.cart = [{ id: "m-1", quantity: 2 }];
  const first = tabA.mount(T0);
  assert.equal(first.kind, "created");
  const originalKey = keyOf(first);

  // The server commits the order... the acknowledgement is lost... and the
  // browser is killed before the catch handler can write to IndexedDB. No
  // pagehide fires, so nothing is released — only the heartbeat goes stale.
  browser.restart();

  // Later: browser reopened, cart restored from localStorage, cashier resubmits.
  const tabAfterRestart = browser.openTab();
  const recovered = tabAfterRestart.mount(T0 + STALE_MS + 1_000);

  assert.equal(recovered.kind, "adopted", "the orphaned draft must be recovered");
  assert.equal(
    keyOf(recovered),
    originalKey,
    "the resubmission carries the ORIGINAL key, so the server replays instead of duplicating"
  );

  // And the server sees one key for both attempts → exactly one order.
  const keysSentToServer = new Set([originalKey, keyOf(recovered)]);
  assert.equal(keysSentToServer.size, 1);
});

// ── 2 · full session restart ─────────────────────────────────────────────────
test("[2] a restored draft survives a full simulated session restart", () => {
  const browser = new Browser();
  browser.cart = [{ id: "m-9", quantity: 1 }];

  const tab1 = browser.openTab();
  const original = keyOf(tab1.mount(T0));

  // Clean close: pagehide releases the draft, so no staleness wait is needed.
  const draftId = readDrafts(browser.local)[Object.keys(readDrafts(browser.local))[0]].draftId;
  tab1.hide(T0 + 1_000, draftId);
  browser.restart();

  // Reopened almost immediately — the release makes it adoptable at once.
  const tab2 = browser.openTab();
  const after = tab2.mount(T0 + 2_000);
  assert.equal(after.kind, "adopted");
  assert.equal(keyOf(after), original);

  // Restart again — released again on the way out, so still recovered.
  tab2.hide(T0 + 2_500, draftOf(after).draftId);
  browser.restart();
  const tab3 = browser.openTab();
  const third = tab3.mount(T0 + 3_000);
  assert.equal(third.kind, "adopted");
  assert.equal(keyOf(third), original);
});

// ── 2a · the hard-crash backstop, and why it is slow on purpose ─────────────
test("[2a] a hard crash recovers via staleness; a live background tab is never adopted", () => {
  const browser = new Browser();
  browser.cart = [{ id: "m-c", quantity: 1 }];
  const tab1 = browser.openTab();
  const original = keyOf(tab1.mount(T0));

  // Killed outright: no pagehide, so nothing is released.
  browser.restart();

  // Inside the staleness window the draft still looks live, so it is NOT taken.
  // This is the deliberate trade-off: recovering slowly is safe, whereas stealing
  // a backgrounded till's identity would refuse a genuine order.
  const early = browser.openTab().mount(T0 + STALE_MS - 1_000);
  assert.equal(early.kind, "created", "must not steal a possibly-live draft");
  assert.notEqual(keyOf(early), original);

  // Past the window the original is recoverable.
  const browser2 = new Browser();
  browser2.cart = [{ id: "m-c", quantity: 1 }];
  const t = browser2.openTab();
  const key2 = keyOf(t.mount(T0));
  browser2.restart();
  const late = browser2.openTab().mount(T0 + STALE_MS + 1_000);
  assert.equal(late.kind, "adopted");
  assert.equal(keyOf(late), key2);
});

// ── 3 · two live tabs stay isolated ──────────────────────────────────────────
test("[3] two independent tab drafts receive different ids", () => {
  const browser = new Browser();

  const tabA = browser.openTab();
  const a = tabA.mount(T0);
  assert.equal(a.kind, "created");

  // Tab A is live and heartbeating, so its draft is NOT adoptable...
  const aDraftId = draftOf(a).draftId;
  tabA.heartbeat(T0 + 1_000, aDraftId);
  browser.cart = [{ id: "m-2", quantity: 1 }]; // a cart is present in localStorage

  // ...so a second tab must mint its own identity rather than adopt A's.
  const tabB = browser.openTab();
  const b = tabB.mount(T0 + 1_500);

  assert.equal(b.kind, "created", "a live draft must never be adopted");
  assert.notEqual(keyOf(b), keyOf(a), "two tabs, two identities");

  // Each tab keeps its own across reloads.
  assert.equal(keyOf(tabA.mount(T0 + 2_000)), keyOf(a));
  assert.equal(keyOf(tabB.mount(T0 + 2_500)), keyOf(b));
});

// ── 4 · closing Tab A must not hand Tab B's id to the restored draft ─────────
test("[4] closing tab A and restoring its draft does not reuse tab B's id", () => {
  const browser = new Browser();
  browser.cart = [{ id: "m-3", quantity: 1 }];

  const tabA = browser.openTab();
  const a = tabA.mount(T0);
  const tabB = browser.openTab();
  tabB.mount(T0 + 100); // B mints its own (A is live)
  const bKey = keyOf(tabB.mount(T0 + 200));
  const bDraftId = tabB.session.getItem(OWNED_DRAFT_KEY)!;

  assert.notEqual(keyOf(a), bKey);

  // Tab A closes. B stays open and keeps heartbeating, so B's draft is protected.
  tabA.hide(T0 + 1_000, draftOf(a).draftId);
  tabB.heartbeat(T0 + 1_100, bDraftId);

  // A new tab opens with the cart still present. The only adoptable draft is A's.
  const tabC = browser.openTab();
  const c = tabC.mount(T0 + 1_200);

  assert.equal(c.kind, "adopted");
  assert.equal(keyOf(c), keyOf(a), "recovered A's own identity");
  assert.notEqual(keyOf(c), bKey, "must NOT have taken the live tab's identity");

  // B is still intact.
  assert.equal(keyOf(tabB.mount(T0 + 1_300)), bKey);
});

// ── 5 · ending one draft leaves the other alone ──────────────────────────────
test("[5] clearing one draft does not affect another", () => {
  const browser = new Browser();
  const tabA = browser.openTab();
  const a = tabA.mount(T0);
  browser.cart = [{ id: "m-4", quantity: 1 }];
  tabA.heartbeat(T0 + 500, draftOf(a).draftId);

  const tabB = browser.openTab();
  const b = tabB.mount(T0 + 600);
  const bKey = keyOf(b);

  // Tab A completes its order ("Clear all", or a successful commit).
  tabA.finish(draftOf(a).draftId);

  const remaining = readDrafts(browser.local);
  assert.equal(Object.keys(remaining).length, 1, "only A's record was removed");
  assert.equal(Object.values(remaining)[0].localOrderId, bKey);
  assert.equal(tabA.session.getItem(OWNED_DRAFT_KEY), null, "A released ownership");
  assert.equal(tabB.session.getItem(OWNED_DRAFT_KEY), draftOf(b).draftId, "B untouched");

  // B's next submit still uses B's key.
  assert.equal(keyOf(tabB.mount(T0 + 700)), bKey);
});

// ── 6 · a legacy persisted cart with no draft record ────────────────────────
test("[6] a legacy draft cart without an id receives one exactly once, persisted immediately", () => {
  const browser = new Browser();
  // A cart persisted by a client that predates this model: cart present, and
  // localStorage has no drafts blob at all.
  browser.cart = [{ id: "m-legacy", quantity: 3 }];
  assert.equal(browser.local.getItem(DRAFTS_KEY), null);

  const tab = browser.openTab();
  const first = tab.mount(T0);
  assert.equal(first.kind, "created");
  const key = keyOf(first);

  // Persisted immediately — a crash on the next tick cannot lose it.
  const stored = readDrafts(browser.local);
  assert.equal(Object.keys(stored).length, 1);
  assert.equal(Object.values(stored)[0].localOrderId, key);

  // Reload, and a browser restart, both reuse that one id — never minted twice.
  assert.equal(keyOf(tab.mount(T0 + 1_000)), key);
  tab.hide(T0 + 1_100, draftOf(first).draftId);
  browser.restart();
  const reopened = browser.openTab();
  const after = reopened.mount(T0 + 1_200);
  assert.equal(after.kind, "adopted");
  assert.equal(keyOf(after), key, "exactly one id across the whole lifecycle");
});

// ── 7 · never guess between several recoverable drafts ──────────────────────
test("[7] several recoverable drafts is reported as ambiguous, not merged or re-minted", () => {
  const browser = new Browser();
  browser.cart = [{ id: "m-5", quantity: 1 }];

  // Two orphaned drafts left behind (e.g. two tabs both killed).
  const orphanA = browser.openTab();
  const a = orphanA.mount(T0);
  orphanA.hide(T0 + 10, draftOf(a).draftId);
  const orphanB = browser.openTab();
  browser.cart = []; // force B to mint rather than adopt A
  const b = orphanB.mount(T0 + 20);
  browser.cart = [{ id: "m-5", quantity: 1 }];
  orphanB.hide(T0 + 30, draftOf(b).draftId);
  browser.restart();

  const tab = browser.openTab();
  const result = tab.mount(T0 + 40);

  assert.equal(result.kind, "ambiguous", "must refuse to choose");
  assert.equal(result.kind === "ambiguous" && result.candidates.length, 2);
  // Nothing was minted and nothing was merged.
  assert.equal(Object.keys(readDrafts(browser.local)).length, 2);
  assert.equal(tab.session.getItem(OWNED_DRAFT_KEY), null, "no ownership taken");
  const keys = new Set(Object.values(readDrafts(browser.local)).map((d) => d.localOrderId));
  assert.equal(keys.size, 2, "the two identities remain distinct");
});

// ── 8 · an empty cart is a genuinely new transaction ────────────────────────
test("[8] a new empty cart gets a new id and never adopts a finished transaction's id", () => {
  const browser = new Browser();
  browser.cart = [{ id: "m-6", quantity: 1 }];
  const tab1 = browser.openTab();
  const first = tab1.mount(T0);
  tab1.hide(T0 + 100, draftOf(first).draftId);
  browser.restart();

  // No cart restored → nothing in flight → must NOT adopt the old identity,
  // otherwise a brand new order would collide with a finished one.
  browser.cart = [];
  const tab2 = browser.openTab();
  const second = tab2.mount(T0 + 200);

  assert.equal(second.kind, "created");
  assert.notEqual(keyOf(second), keyOf(first));
});

// ── 9 · queued orders are unaffected by later drafts ───────────────────────
test("[9] handing order A to IndexedDB does not change its id when a new cart begins", () => {
  const browser = new Browser();
  browser.cart = [{ id: "m-7", quantity: 1 }];
  const tab = browser.openTab();
  const a = tab.mount(T0);
  const aKey = keyOf(a);

  // Order A goes into the offline queue carrying its own copy of the key.
  const queuedA = { localOrderId: aKey, syncStatus: "pending" as const };
  tab.finish(draftOf(a).draftId); // safely handed off
  browser.cart = [];

  // Order B begins in the same tab.
  const b = tab.mount(T0 + 1_000);
  assert.equal(b.kind, "created");
  assert.notEqual(keyOf(b), aKey);

  // A still syncs under its original key.
  assert.equal(queuedA.localOrderId, aKey);
  const normalized = normalizeQueuedOrderKey(queuedA, seqMint);
  assert.equal(normalized.changed, false);
  assert.equal(normalized.record.localOrderId, aKey);
});

// ── 10 · adoptability rules ─────────────────────────────────────────────────
test("[10] adoptability: released immediately, otherwise only once the heartbeat is stale", () => {
  const base: PosDraft = {
    draftId: "d1",
    localOrderId: "k1",
    createdAt: T0,
    lastUpdatedAt: T0,
    heartbeatAt: T0,
  };
  assert.equal(isAdoptable(base, T0 + 1_000), false, "a fresh heartbeat is protected");
  assert.equal(isAdoptable(base, T0 + STALE_MS - 1), false);
  assert.equal(isAdoptable(base, T0 + STALE_MS + 1), true, "stale becomes adoptable");
  assert.equal(isAdoptable({ ...base, released: true }, T0 + 1), true, "a clean close is immediate");
});

// ── 11 · corrupt storage must not strand the till ───────────────────────────
test("[11] corrupt or partial draft storage falls back to a fresh identity", () => {
  for (const junk of ["not json", "[]", "null", '{"x":{"draftId":"x"}}', '{"y":{"localOrderId":"  "}}']) {
    const browser = new Browser();
    browser.local.setItem(DRAFTS_KEY, junk);
    browser.cart = [{ id: "m-8", quantity: 1 }];
    const tab = browser.openTab();
    const result = tab.mount(T0);
    assert.equal(result.kind, "created", `junk=${junk} must not crash or block`);
    assert.ok(keyOf(result).length > 0);
  }
});

// ── 12 · minting ────────────────────────────────────────────────────────────
test("[12] minted keys are unique and prefixed", () => {
  const ids = new Set(Array.from({ length: 500 }, () => mintTxnId()));
  assert.equal(ids.size, 500, "no collisions across 500 mints");
  for (const id of ids) assert.ok(id.startsWith("txn-"), `${id} is prefixed`);
});

// ── runner ───────────────────────────────────────────────────────────────────
console.log("pos/draft");
for (const [name, fn] of tests) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}
console.log(`\n${passed}/${tests.length} passed`);
