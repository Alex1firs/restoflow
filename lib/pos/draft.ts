/**
 * POS draft records — durable transaction identity.
 *
 * A cashier transaction's `localOrderId` must outlive far more than a reload: if
 * the server commits an order but the acknowledgement is lost and the tab or the
 * whole browser closes before the offline hand-off completes, the cart is later
 * restored from localStorage and resubmitted. If that resubmission carries a NEW
 * key, the server cannot recognise it and a duplicate order is created. So the
 * identity has to be persisted somewhere that survives the browser closing, and
 * be re-associated with the restored draft on the way back up.
 *
 * ── The model ───────────────────────────────────────────────────────────────
 *
 *   localStorage["rf_pos_drafts"]      { [draftId]: PosDraft }   durable
 *   sessionStorage["rf_pos_draft_id"]  the draftId THIS tab owns  per-tab
 *
 * Durable storage holds the records; per-tab storage holds only *ownership*. That
 * split is what gives both properties at once:
 *
 *   reload the tab      → sessionStorage still names the draft   → same id
 *   reopen the browser  → sessionStorage is empty, so the tab ADOPTS the
 *                         orphaned draft from localStorage       → same id
 *   a second tab        → the first tab's draft is still live, so it is not
 *                         adoptable; the new tab creates its own → different id
 *
 * ── Liveness, and why adoption needs it ─────────────────────────────────────
 * The dangerous mistake is a fresh tab adopting a draft that another tab is
 * actively using — two cashiers would then share one identity and the second
 * order would be refused as a conflicting replay. localStorage cannot tell us
 * which tabs are alive, so the owning tab advertises liveness itself:
 *
 *   - it refreshes `heartbeatAt` every few seconds while it holds the draft
 *   - on pagehide it sets `released`, marking the draft immediately adoptable
 *
 * A draft is adoptable only when it was released, or when its heartbeat has gone
 * stale. A live tab therefore keeps its draft private, while a closed browser
 * leaves one behind to be recovered.
 *
 * `released` carries the normal path — closing a tab, quitting the browser and an
 * OS-initiated shutdown all fire pagehide/beforeunload, so recovery is immediate.
 * Staleness is only the backstop for a hard crash, and is intentionally slow (see
 * STALE_MS) because being slow to recover is safe while stealing a live tab's
 * identity is not.
 *
 * ── Deliberate refusal to guess ─────────────────────────────────────────────
 * If several orphaned drafts are recoverable, this module does NOT merge them or
 * hand them all one id. It reports `ambiguous` and the caller must present a
 * recoverable state instead of submitting, because silently minting an identity
 * is precisely what produced duplicate orders.
 *
 * The cart itself continues to live in `rf_pos_draft_cart`, untouched by this
 * module. Cart persistence is load-bearing for restaurants that are live right
 * now, so it is deliberately not restructured here; only identity is added.
 */

import { mintTxnId } from "./txn-id";

export const DRAFTS_KEY = "rf_pos_drafts";
export const OWNED_DRAFT_KEY = "rf_pos_draft_id";

/** How often the owning tab refreshes its heartbeat. */
export const HEARTBEAT_MS = 5_000;
/**
 * A draft whose heartbeat is older than this is treated as orphaned.
 *
 * Deliberately far longer than the heartbeat interval. Chrome throttles timers in
 * background tabs to roughly once a minute, so a POS tab that is merely behind
 * another window can look idle for a long time. If this window were short, a
 * second tab could adopt a draft that a live till is still using — two cashiers
 * sharing one identity, and the second order refused as a conflicting replay.
 * That is worse than the duplicate this project is fixing, so the window errs
 * long and `released` carries the common recovery case instead.
 */
export const STALE_MS = 90_000;
/**
 * How long an orphaned draft stays eligible for recovery.
 *
 * A cart is only recoverable while it plausibly belongs to the shift it was rung
 * up in. Anything older is stale bookkeeping, not an in-flight transaction, and
 * treating it as a candidate is what made ordinary accumulated orphans look like
 * a genuine ambiguity on a busy terminal.
 */
export const RECOVERY_WINDOW_MS = 12 * 60 * 60 * 1_000;

/**
 * Draft records are disposable ownership metadata — never orders. They are pruned
 * aggressively so a terminal that has been opened and closed all week does not
 * accumulate a pile of candidates. Order queue records live in IndexedDB and are
 * NEVER touched by this module.
 */
export const PRUNE_AFTER_MS = 48 * 60 * 60 * 1_000;

export interface PosDraft {
  draftId: string;
  /** The idempotency key for this transaction. Never reassigned. */
  localOrderId: string;
  createdAt: number;
  lastUpdatedAt: number;
  /** Refreshed by the owning tab; staleness is what makes a draft adoptable. */
  heartbeatAt: number;
  /** Set on pagehide so a clean close is adoptable without waiting for staleness. */
  released?: boolean;
  /**
   * Fingerprint of the cart this draft was last seen holding.
   *
   * This is what makes recovery *matching* possible rather than guessing: a
   * restored cart is only ever adopted by the draft that was actually holding
   * that cart. Covers only item-level intent (id, quantity, size, modifiers,
   * custom price, item note) because that is exactly what `rf_pos_draft_cart`
   * persists and restores.
   */
  cartFingerprint?: string;
  /** Item count, so a draft that never held anything is not a candidate. */
  cartCount?: number;
}

/** Minimal shape needed to fingerprint a cart line. */
export interface DraftCartItem {
  id?: unknown;
  quantity?: unknown;
  customPrice?: unknown;
  itemNote?: unknown;
  selectedSize?: { name?: unknown } | null;
  selectedModifiers?: Array<{ name?: unknown }> | null;
}

/**
 * Stable fingerprint of a persisted cart, used only to match a restored cart to
 * the draft that was holding it. Lines are sorted so ordering is not identity.
 */
export function cartFingerprint(cart: readonly DraftCartItem[]): string {
  if (!Array.isArray(cart) || cart.length === 0) return "";
  const lines = cart.map((item) => {
    const id = String(item?.id ?? "");
    const qty = Number(item?.quantity ?? 0);
    const size = String(item?.selectedSize?.name ?? "");
    const mods = (Array.isArray(item?.selectedModifiers) ? item.selectedModifiers : [])
      .map((m: { name?: unknown }) => String(m?.name ?? ""))
      .sort()
      .join(",");
    const custom =
      item?.customPrice === null || item?.customPrice === undefined || item?.customPrice === ""
        ? ""
        : String(Number(item.customPrice));
    const note = String(item?.itemNote ?? "").trim();
    return `${id}:${qty}:${size}:${mods}:${custom}:${note}`;
  });
  lines.sort();
  return `c1|${lines.join(";")}`;
}

export type DraftResolution =
  /** This tab already owned the draft (same tab, e.g. after a reload). */
  | { kind: "existing"; draft: PosDraft }
  /** Recovered an orphaned draft — browser restart, crash, or tab reopen. */
  | { kind: "adopted"; draft: PosDraft }
  /** Nothing to recover; a fresh transaction identity was minted and persisted. */
  | { kind: "created"; draft: PosDraft }
  /**
   * More than one orphaned draft could match the restored cart. The caller must
   * NOT submit: minting a new identity risks a duplicate, and picking one at
   * random risks a false conflict. Ask a human.
   */
  | { kind: "ambiguous"; candidates: PosDraft[] };

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

// ── Storage helpers ──────────────────────────────────────────────────────────

export function readDrafts(local: KeyValueStorage): Record<string, PosDraft> {
  const raw = local.getItem(DRAFTS_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    // Drop anything that is not a usable record rather than trusting the blob.
    const out: Record<string, PosDraft> = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      const d = value as Partial<PosDraft>;
      if (typeof d?.draftId === "string" && typeof d?.localOrderId === "string" && d.localOrderId.trim()) {
        out[id] = {
          draftId: d.draftId,
          localOrderId: d.localOrderId,
          createdAt: Number(d.createdAt ?? 0),
          lastUpdatedAt: Number(d.lastUpdatedAt ?? 0),
          heartbeatAt: Number(d.heartbeatAt ?? 0),
          ...(d.released ? { released: true as const } : {}),
          // Carried through so a restored cart can be matched to its own draft.
          // Omitting these here silently disables recovery matching entirely.
          ...(typeof d.cartFingerprint === "string" ? { cartFingerprint: d.cartFingerprint } : {}),
          ...(typeof d.cartCount === "number" ? { cartCount: d.cartCount } : {}),
        };
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeDrafts(local: KeyValueStorage, drafts: Record<string, PosDraft>): void {
  local.setItem(DRAFTS_KEY, JSON.stringify(drafts));
}

/** A draft nobody is actively holding. */
export function isAdoptable(draft: PosDraft, now: number): boolean {
  return draft.released === true || now - draft.heartbeatAt > STALE_MS;
}

// ── Resolution ───────────────────────────────────────────────────────────────

export interface ResolveDraftInput {
  local: KeyValueStorage;
  session: KeyValueStorage;
  now: number;
  /** Whether a cart was restored from `rf_pos_draft_cart`. */
  hasPersistedCart: boolean;
  /** Fingerprint of the restored cart, used to match it to its own draft. */
  cartFingerprint?: string;
  /**
   * localOrderIds already present in the offline queue. Those transactions are
   * owned by their queue record now, so their draft is vestigial and must not be
   * offered as a recovery candidate.
   */
  queuedLocalOrderIds?: readonly string[];
  mint?: () => string;
}

/**
 * Can this draft plausibly be the one holding the restored cart?
 *
 * Every clause here exists because its absence caused the production regression:
 * an orphan was a candidate purely for being adoptable, so ordinary accumulated
 * drafts from past sessions looked like a genuine ambiguity and blocked the till.
 */
export function isRecoveryCandidate(
  draft: PosDraft,
  input: { now: number; cartFingerprint?: string; queued?: readonly string[] }
): boolean {
  const { now, cartFingerprint: fp, queued } = input;
  // Held by a live tab — never steal it.
  if (!isAdoptable(draft, now)) return false;
  // Too old to be an in-flight transaction.
  if (now - Math.max(draft.lastUpdatedAt, draft.heartbeatAt) > RECOVERY_WINDOW_MS) return false;
  // Its transaction already lives in the offline queue, which owns it now.
  if (queued && queued.includes(draft.localOrderId)) return false;
  // Never held a cart, so it cannot be the owner of this one.
  if (!draft.cartFingerprint || (draft.cartCount ?? 0) === 0) return false;
  // Must actually match the cart we are trying to place.
  if (!fp) return false;
  return draft.cartFingerprint === fp;
}

/**
 * Resolves the draft this tab should use, persisting the result immediately so a
 * crash on the very next tick cannot lose the identity.
 */
export function resolveDraft(input: ResolveDraftInput): DraftResolution {
  const { local, session, now, hasPersistedCart } = input;
  const mint = input.mint ?? mintTxnId;

  const drafts = readDrafts(local);
  const ownedId = session.getItem(OWNED_DRAFT_KEY);

  // 1. Same tab, already owns a live draft (the reload path).
  if (ownedId && drafts[ownedId]) {
    const draft: PosDraft = { ...drafts[ownedId], heartbeatAt: now, released: undefined };
    delete (draft as Partial<PosDraft>).released;
    drafts[ownedId] = draft;
    writeDrafts(local, drafts);
    return { kind: "existing", draft };
  }

  // 2. No cart was restored, so there is no in-flight transaction to recover.
  //    Recovering here would attach an old identity to a genuinely new order.
  if (!hasPersistedCart) {
    return { kind: "created", draft: createDraft(local, session, drafts, now, mint) };
  }

  // 3. A cart came back but this tab owns nothing: look for the draft that was
  //    actually holding THIS cart. Matching on cart identity — rather than merely
  //    counting adoptable orphans — is what stops routine leftovers from reading
  //    as an ambiguity and blocking the terminal.
  const candidates = Object.values(drafts)
    .filter(
      (d) =>
        d.draftId !== ownedId &&
        isRecoveryCandidate(d, {
          now,
          cartFingerprint: input.cartFingerprint,
          queued: input.queuedLocalOrderIds,
        })
    )
    .sort((a, b) => b.lastUpdatedAt - a.lastUpdatedAt);

  if (candidates.length === 1) {
    const adopted: PosDraft = { ...candidates[0], heartbeatAt: now, lastUpdatedAt: now };
    delete (adopted as Partial<PosDraft>).released;
    drafts[adopted.draftId] = adopted;
    writeDrafts(local, drafts);
    session.setItem(OWNED_DRAFT_KEY, adopted.draftId);
    return { kind: "adopted", draft: adopted };
  }

  if (candidates.length > 1) {
    // Several drafts genuinely held an identical cart. Never merge, never guess —
    // the caller preserves the cart and asks a human. This is now rare: it needs
    // two recent drafts with byte-identical carts, not merely two leftovers.
    return { kind: "ambiguous", candidates };
  }

  // No draft matches this cart, so it was never associated with a recoverable
  // transaction: an unrelated orphan must NOT be adopted for it. Mint once and
  // persist immediately.
  return { kind: "created", draft: createDraft(local, session, drafts, now, mint) };
}

function createDraft(
  local: KeyValueStorage,
  session: KeyValueStorage,
  drafts: Record<string, PosDraft>,
  now: number,
  mint: () => string
): PosDraft {
  const draft: PosDraft = {
    draftId: `draft-${mint()}`,
    localOrderId: mint(),
    createdAt: now,
    lastUpdatedAt: now,
    heartbeatAt: now,
  };
  drafts[draft.draftId] = draft;
  writeDrafts(local, prune(drafts, now));
  session.setItem(OWNED_DRAFT_KEY, draft.draftId);
  return draft;
}

/**
 * Refreshes liveness for the draft this tab holds, and records what cart it is
 * holding so a later restore can be matched to it rather than guessed at.
 */
export function touchDraft(
  local: KeyValueStorage,
  draftId: string,
  now: number,
  cart?: readonly DraftCartItem[]
): void {
  const drafts = readDrafts(local);
  const draft = drafts[draftId];
  if (!draft) return;
  const next: PosDraft = { ...draft, heartbeatAt: now, lastUpdatedAt: now };
  if (cart) {
    next.cartFingerprint = cartFingerprint(cart);
    next.cartCount = cart.length;
  }
  delete (next as Partial<PosDraft>).released;
  drafts[draftId] = next;
  writeDrafts(local, drafts);
}

/**
 * Begins a deliberately new transaction in this tab.
 *
 * Used when the previous transaction has ended and the cashier is starting the
 * next one, and when they explicitly choose to abandon an unmatched cart. Always
 * mints — it never adopts, so it cannot inherit an unrelated identity.
 */
export function startNewDraft(
  local: KeyValueStorage,
  session: KeyValueStorage,
  now: number,
  mint: () => string = mintTxnId
): PosDraft {
  return createDraft(local, session, readDrafts(local), now, mint);
}

/**
 * Marks the draft adoptable without waiting for the staleness window. Called on
 * pagehide, so a cleanly closed browser can recover its identity immediately.
 */
export function releaseDraft(local: KeyValueStorage, draftId: string, now: number): void {
  const drafts = readDrafts(local);
  const draft = drafts[draftId];
  if (!draft) return;
  drafts[draftId] = { ...draft, released: true, heartbeatAt: now };
  writeDrafts(local, drafts);
}

/**
 * Ends a transaction: the order was committed, safely queued, or abandoned.
 * Removes ONLY this draft, so another tab's in-progress transaction is untouched.
 */
export function endDraft(local: KeyValueStorage, session: KeyValueStorage, draftId: string): void {
  const drafts = readDrafts(local);
  delete drafts[draftId];
  writeDrafts(local, drafts);
  if (session.getItem(OWNED_DRAFT_KEY) === draftId) {
    session.removeItem(OWNED_DRAFT_KEY);
  }
}

/** Drops long-abandoned records so the blob cannot grow without bound. */
function prune(drafts: Record<string, PosDraft>, now: number): Record<string, PosDraft> {
  const out: Record<string, PosDraft> = {};
  for (const [id, draft] of Object.entries(drafts)) {
    if (now - Math.max(draft.lastUpdatedAt, draft.heartbeatAt) < PRUNE_AFTER_MS) {
      out[id] = draft;
    }
  }
  return out;
}

// ── Browser bindings ─────────────────────────────────────────────────────────

function safeStorage(kind: "local" | "session"): KeyValueStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null; // locked-down / private modes
  }
}

/** In-memory fallback so a storage-less browser still gets one id per page life. */
const memoryStore = new Map<string, string>();
const memoryStorage: KeyValueStorage = {
  getItem: (k) => (memoryStore.has(k) ? memoryStore.get(k)! : null),
  setItem: (k, v) => void memoryStore.set(k, v),
  removeItem: (k) => void memoryStore.delete(k),
};

export function posDraftStorages(): { local: KeyValueStorage; session: KeyValueStorage } {
  return {
    local: safeStorage("local") ?? memoryStorage,
    session: safeStorage("session") ?? memoryStorage,
  };
}
