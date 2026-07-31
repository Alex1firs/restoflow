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
/** Released/stale drafts with no cart behind them are pruned after this. */
export const PRUNE_AFTER_MS = 7 * 24 * 60 * 60 * 1_000;

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
  mint?: () => string;
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

  // 3. A cart came back but this tab owns nothing: look for an orphan to adopt.
  const candidates = Object.values(drafts)
    .filter((d) => d.draftId !== ownedId && isAdoptable(d, now))
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
    // Never merge and never guess — see the module comment.
    return { kind: "ambiguous", candidates };
  }

  // A cart is present but every draft is held by a live tab (or there are none,
  // e.g. a cart persisted by a client that predates this model). Mint once and
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

/** Refreshes liveness (and the change timestamp) for the draft this tab holds. */
export function touchDraft(local: KeyValueStorage, draftId: string, now: number): void {
  const drafts = readDrafts(local);
  const draft = drafts[draftId];
  if (!draft) return;
  drafts[draftId] = { ...draft, heartbeatAt: now, lastUpdatedAt: now };
  delete (drafts[draftId] as Partial<PosDraft>).released;
  writeDrafts(local, drafts);
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
