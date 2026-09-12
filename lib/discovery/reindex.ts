import type { Firestore } from "firebase-admin/firestore";

/**
 * Refresh one restaurant's discovery documents after its data changed.
 *
 * ── Why a nudge rather than a nightly job ────────────────────────────────────
 * An index that only rebuilds overnight means a restaurant that adds a dish, or
 * takes one off, is lying to customers until tomorrow. The scheduled job stays
 * as the reconciler — it repairs drift and recomputes popularity — but the
 * common case has to be immediate.
 *
 * Swallows its own failures on purpose. Reindexing is derived work: it must
 * never fail the write that triggered it, and the scheduled pass will catch
 * whatever a nudge missed.
 */
export async function reindexNow(db: Firestore, slug: string): Promise<void> {
  try {
    const { createFirestoreStore } = await import("./firestore-store");
    const { reindexRestaurant } = await import("./indexer");
    const result = await reindexRestaurant(createFirestoreStore(db), slug, Date.now());
    console.log(JSON.stringify({ scope: "discovery", event: "reindexed", ...result }));
  } catch (err) {
    console.error(JSON.stringify({
      scope: "discovery", event: "reindex_failed", slug,
      error: err instanceof Error ? err.message : String(err),
    }));
  }
}
