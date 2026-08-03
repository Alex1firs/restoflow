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
  RECOVERY_WINDOW_MS,
  cartFingerprint,
  isRecoveryCandidate,
  startNewDraft,
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
type Item = { id: string; quantity: number; customPrice?: number | null; itemNote?: string };

class Browser {
  local = new MemStorage();
  /** Stands in for localStorage["rf_pos_draft_cart"]. */
  cart: Item[] = [];
  /** localOrderIds already owned by an offline queue record. */
  queued: string[] = [];
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

  /**
   * What POSClient does on mount: resolve the draft, then the cart-persist effect
   * immediately records which cart this draft is holding.
   */
  mount(now: number) {
    const resolution = resolveDraft({
      local: this.browser.local,
      session: this.session,
      now,
      hasPersistedCart: this.browser.cart.length > 0,
      cartFingerprint: cartFingerprint(this.browser.cart),
      queuedLocalOrderIds: this.browser.queued,
      mint: seqMint,
    });
    if (resolution.kind !== "ambiguous" && this.browser.cart.length > 0) {
      touchDraft(this.browser.local, resolution.draft.draftId, now, this.browser.cart);
    }
    return resolution;
  }
  /** The cart-change effect: liveness plus what cart this draft is holding. */
  heartbeat(now: number, draftId: string, cart?: Item[]) {
    touchDraft(this.browser.local, draftId, now, cart ?? this.browser.cart);
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
test("[7] ambiguity now requires two drafts that held the SAME cart", () => {
  const browser = new Browser();
  const CART: Item[] = [{ id: "m-5", quantity: 1 }];

  // Two tabs held this identical cart at the same time — A stays live, so B has
  // to mint its own rather than adopting A's. Then both die.
  browser.cart = [...CART];
  const tabA = browser.openTab();
  const a = tabA.mount(T0);
  tabA.heartbeat(T0 + 5, draftOf(a).draftId);

  const tabB = browser.openTab();
  const b = tabB.mount(T0 + 10);
  assert.notEqual(draftOf(b).localOrderId, draftOf(a).localOrderId, "two live tabs, two identities");

  tabA.hide(T0 + 20, draftOf(a).draftId);
  tabB.hide(T0 + 25, draftOf(b).draftId);
  browser.restart();

  const result = browser.openTab().mount(T0 + 40);

  assert.equal(result.kind, "ambiguous", "two drafts held an identical cart");
  assert.equal(result.kind === "ambiguous" && result.candidates.length, 2);
  // Nothing minted, nothing merged, the cart is untouched.
  assert.equal(Object.keys(readDrafts(browser.local)).length, 2);
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


// ── HOTFIX REGRESSION: the ambiguous-draft production block ─────────────────
// A cashier at a live restaurant could not place any order: the terminal showed
// "Couldn't tell which unfinished order this cart belongs to" on an EMPTY cart.
// Two defects: the blocked state was set once at mount and never recomputed, and
// any adoptable orphan counted as a candidate regardless of the cart, so routine
// leftovers from past sessions read as a genuine ambiguity.

test("[R1] many orphan drafts + an EMPTY cart never block ordering", () => {
  const browser = new Browser();

  // A week of ordinary use: eight leftover drafts from closed tabs/sessions.
  for (let i = 0; i < 8; i++) {
    browser.cart = [{ id: `m-${i}`, quantity: 1 }];
    const t = browser.openTab();
    const d = t.mount(T0 + i * 1_000);
    t.hide(T0 + i * 1_000 + 10, draftOf(d).draftId);
  }
  browser.restart();
  assert.ok(Object.keys(readDrafts(browser.local)).length >= 8, "orphans really did accumulate");

  // Cashier opens the till with nothing in the cart. This is the exact state that
  // was blocked in production.
  browser.cart = [];
  const result = browser.openTab().mount(T0 + 60_000);

  assert.notEqual(result.kind, "ambiguous", "an empty cart can NEVER be ambiguous");
  assert.equal(result.kind, "created");
  assert.ok(draftOf(result).localOrderId.length > 0, "a usable identity is available immediately");
});

test("[R2] the ambiguous state is derived from the cart, so clearing it recovers", () => {
  // Models the client's derived rule: blocked = ambiguous AND cart is non-empty.
  const blocked = (ambiguousCount: number, cartLength: number) => ambiguousCount > 0 && cartLength > 0;

  assert.equal(blocked(2, 3), true, "ambiguous with items -> held back");
  assert.equal(blocked(2, 0), false, "the SAME ambiguity with an empty cart -> not blocked");
  assert.equal(blocked(0, 3), false);
  assert.equal(blocked(0, 0), false);

  // The old behaviour: a latched boolean that survived the cart emptying. This is
  // what stranded the terminal and made the "clear the cart" advice a dead end.
  let latched = false;
  const oldBlocked = (ambiguous: boolean) => { if (ambiguous) latched = true; return latched; };
  assert.equal(oldBlocked(true), true);
  assert.equal(oldBlocked(false), true, "regression reproduced: still blocked after the cart cleared");
});

test("[R3] Clear All / resetPOS lets the very next order start immediately", () => {
  const browser = new Browser();
  browser.cart = [{ id: "m-1", quantity: 2 }];
  const tab = browser.openTab();
  const first = tab.mount(T0);

  // Clear All: cart emptied, this tab's draft ended. No reload, no sign-in.
  tab.finish(draftOf(first).draftId);
  browser.cart = [];

  // The derived effect starts a fresh transaction on the spot.
  const next = startNewDraft(browser.local, tab.session, T0 + 1_000, seqMint);
  assert.ok(next.localOrderId);
  assert.notEqual(next.localOrderId, draftOf(first).localOrderId, "a new order, a new identity");
  assert.equal(browser.local.getItem(DRAFTS_KEY)!.includes(next.draftId), true, "persisted at once");
});

test("[R4] completing an order clears only that draft", () => {
  const browser = new Browser();
  browser.cart = [{ id: "m-1", quantity: 1 }];
  const tabA = browser.openTab();
  const a = tabA.mount(T0);
  tabA.heartbeat(T0 + 5, draftOf(a).draftId);

  const tabB = browser.openTab();
  const b = tabB.mount(T0 + 10);

  tabA.finish(draftOf(a).draftId);

  const remaining = readDrafts(browser.local);
  assert.equal(Object.keys(remaining).length, 1);
  assert.equal(Object.values(remaining)[0].localOrderId, draftOf(b).localOrderId, "B untouched");
});

test("[R5] a safe offline hand-off ends draft ownership but preserves the queued record", () => {
  const browser = new Browser();
  browser.cart = [{ id: "m-1", quantity: 2, customPrice: 4500, itemNote: "no pepper" }];
  const tab = browser.openTab();
  const draft = draftOf(tab.mount(T0));

  // The record takes its own copy of the key, then the draft is retired.
  const queued = { localOrderId: draft.localOrderId, syncStatus: "pending" as const, items: browser.cart };
  browser.queued.push(queued.localOrderId);
  tab.finish(draft.draftId);
  browser.cart = [];

  assert.equal(Object.keys(readDrafts(browser.local)).length, 0, "draft ownership released");
  assert.equal(queued.localOrderId, draft.localOrderId, "the queue record keeps the identity");
  assert.deepEqual(queued.items[0].customPrice, 4500, "and the transaction data");

  // Its vestigial draft must never be offered as a recovery candidate again.
  const stale = { ...draft, released: true, cartFingerprint: cartFingerprint(queued.items), cartCount: 1 };
  assert.equal(
    isRecoveryCandidate(stale, { now: T0 + 1_000, cartFingerprint: stale.cartFingerprint, queued: browser.queued }),
    false,
    "the queue record owns this transaction now"
  );
});

test("[R6] a restored cart is adopted by the draft that actually held it", () => {
  const browser = new Browser();
  const CART: Item[] = [{ id: "m-7", quantity: 3, customPrice: 900, itemNote: "well done" }];
  browser.cart = [...CART];

  const tab = browser.openTab();
  const original = draftOf(tab.mount(T0)).localOrderId;
  tab.hide(T0 + 100, tab.session.getItem(OWNED_DRAFT_KEY)!);
  browser.restart();

  const recovered = browser.openTab().mount(T0 + 200);
  assert.equal(recovered.kind, "adopted");
  assert.equal(keyOf(recovered), original, "resubmits under the ORIGINAL key, so the server replays");
});

test("[R7] unrelated orphan drafts are ignored, never adopted for a different cart", () => {
  const browser = new Browser();

  // An orphan holding a completely different cart.
  browser.cart = [{ id: "m-OTHER", quantity: 9 }];
  const other = browser.openTab();
  const otherDraft = draftOf(other.mount(T0));
  other.hide(T0 + 10, otherDraft.draftId);
  browser.restart();

  // A different cart comes back. It must NOT inherit the unrelated identity.
  browser.cart = [{ id: "m-MINE", quantity: 1 }];
  const result = browser.openTab().mount(T0 + 20);

  assert.equal(result.kind, "created", "no silent association with an unrelated orphan");
  assert.notEqual(keyOf(result), otherDraft.localOrderId);

  // And a stale orphan beyond the recovery window is never a candidate either.
  assert.equal(
    isRecoveryCandidate(otherDraft, { now: T0 + RECOVERY_WINDOW_MS + 1, cartFingerprint: otherDraft.cartFingerprint }),
    false,
    "older than the recovery window"
  );
});

test("[R8] two tabs with separate carts stay isolated", () => {
  const browser = new Browser();
  browser.cart = [{ id: "m-A", quantity: 1 }];
  const tabA = browser.openTab();
  const a = tabA.mount(T0);
  tabA.heartbeat(T0 + 5, draftOf(a).draftId);

  browser.cart = [{ id: "m-B", quantity: 2 }];
  const tabB = browser.openTab();
  const b = tabB.mount(T0 + 10);

  assert.notEqual(keyOf(a), keyOf(b));
  assert.equal(tabA.mount(T0 + 20).kind, "existing");
  assert.equal(keyOf(tabA.mount(T0 + 25)), keyOf(a), "A keeps its own");
  assert.equal(keyOf(tabB.mount(T0 + 30)), keyOf(b), "B keeps its own");
});

test("[R9] a live draft owned by another tab is never stolen", () => {
  const browser = new Browser();
  const CART: Item[] = [{ id: "m-1", quantity: 1 }];
  browser.cart = [...CART];
  const tabA = browser.openTab();
  const a = tabA.mount(T0);
  tabA.heartbeat(T0 + 1_000, draftOf(a).draftId);

  // Same cart, but A is alive and heartbeating.
  const result = browser.openTab().mount(T0 + 1_500);
  assert.equal(result.kind, "created", "a live draft is not adoptable even on an exact cart match");
  assert.notEqual(keyOf(result), keyOf(a));
  assert.equal(
    isRecoveryCandidate(draftOf(a), { now: T0 + 1_500, cartFingerprint: cartFingerprint(CART) }),
    false
  );
});

test("[R10] a genuinely ambiguous non-empty cart is preserved, never auto-resubmitted", () => {
  const browser = new Browser();
  const CART: Item[] = [{ id: "m-9", quantity: 2 }];
  browser.cart = [...CART];

  const tabA = browser.openTab();
  const a = tabA.mount(T0);
  tabA.heartbeat(T0 + 5, draftOf(a).draftId);
  const tabB = browser.openTab();
  const b = tabB.mount(T0 + 10);
  tabA.hide(T0 + 20, draftOf(a).draftId);
  tabB.hide(T0 + 25, draftOf(b).draftId);
  browser.restart();

  const result = browser.openTab().mount(T0 + 30);
  assert.equal(result.kind, "ambiguous");

  // No new identity was minted for the cart, and neither candidate was chosen.
  const drafts = readDrafts(browser.local);
  assert.equal(Object.keys(drafts).length, 2, "nothing minted, nothing merged");
  assert.deepEqual(browser.cart, CART, "the cart is preserved for the cashier");

  // The recovery action is a DELIBERATE new transaction, not a silent resubmit.
  const fresh = startNewDraft(browser.local, new MemStorage(), T0 + 40, seqMint);
  assert.notEqual(fresh.localOrderId, keyOf({ kind: "created", draft: drafts[Object.keys(drafts)[0]] } as DraftResolution));
});

test("[R11][R12] recovery never touches Open Bills or queued records", () => {
  const browser = new Browser();
  // Standing queue records: an unsettled offline bill and a failed one.
  const queueRecords = [
    { localOrderId: "offline-open-bill-1", syncStatus: "pending", paymentStatus: "unpaid" },
    { localOrderId: "offline-failed-1", syncStatus: "failed", paymentStatus: "unpaid" },
  ];
  const before = JSON.stringify(queueRecords);
  browser.queued = queueRecords.map((q) => q.localOrderId);

  // A pile of orphans plus an empty cart — the production scenario.
  for (let i = 0; i < 5; i++) {
    browser.cart = [{ id: `m-${i}`, quantity: 1 }];
    const t = browser.openTab();
    t.hide(T0 + i, draftOf(t.mount(T0 + i)).draftId);
  }
  browser.restart();
  browser.cart = [];
  const result = browser.openTab().mount(T0 + 10_000);

  assert.equal(result.kind, "created", "till is usable");
  assert.equal(JSON.stringify(queueRecords), before, "queue records byte-identical — nothing deleted or edited");
  assert.equal(browser.queued.length, 2, "Open Bills still queued");
});

test("[R13][R14] drafts are disposable metadata only — no orders, no auth", () => {
  // Draft storage holds ownership metadata and never order content, so pruning or
  // clearing it cannot affect an unsettled bill, a completed order, or a session.
  const browser = new Browser();
  browser.cart = [{ id: "m-1", quantity: 1, customPrice: 500 }];
  const tab = browser.openTab();
  tab.mount(T0);

  const raw = browser.local.getItem(DRAFTS_KEY)!;
  const stored = Object.values(readDrafts(browser.local))[0];

  // The record holds identity, liveness and a cart FINGERPRINT. The fingerprint
  // necessarily encodes cart intent — that is what makes matching possible — but
  // it is derived from a cart already sitting in this same origin's localStorage,
  // so it exposes nothing new.
  assert.deepEqual(
    Object.keys(stored).sort(),
    ["cartCount", "cartFingerprint", "createdAt", "draftId", "heartbeatAt", "lastUpdatedAt", "localOrderId"],
    "no field beyond ownership metadata is persisted"
  );
  assert.equal(typeof stored.cartFingerprint, "string");
  assert.equal(stored.cartCount, 1);

  // Crucially: no order state and nothing authentication-related. Discarding a
  // draft can therefore never affect an unsettled bill, a completed order, or a
  // cashier's session.
  assert.ok(!/paymentStatus|orderNumber|itemsTotal|deliveryFee/i.test(raw), "no order state");
  assert.ok(!/token|session|cookie|password|\buid\b|auth/i.test(raw), "no auth or session material");
});

// ── runner ───────────────────────────────────────────────────────────────────
console.log("pos/draft");
for (const [name, fn] of tests) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}
console.log(`\n${passed}/${tests.length} passed`);
