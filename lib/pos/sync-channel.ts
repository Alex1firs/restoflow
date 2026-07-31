/**
 * Cross-tab notifications for the POS queue.
 *
 * ADVISORY ONLY. Correctness lives in the IndexedDB lease (lib/pos/sync-lease.ts
 * plus dbUpdateAtomic): that is a real atomic claim and works in every context.
 * BroadcastChannel is not uniformly available, so nothing here may be required
 * for safety — it exists so a tab that is NOT synchronising can refresh its own
 * view instead of discovering the change later, and so completion effects
 * (kitchen tickets, receipts, "order created" UI) fire only in the context that
 * actually performed the work.
 *
 * Every function degrades to a no-op when the API is missing.
 */

export const POS_SYNC_CHANNEL = "rf_pos_sync";

export interface QueueChangeMessage {
  type: "queue-synced";
  /** The queued transaction that completed. */
  localOrderId: string;
  /** The canonical server order it resolved to. */
  orderId: string;
  /** Which context did the work, so the sender can ignore its own message. */
  ownerId: string;
}

type Listener = (message: QueueChangeMessage) => void;

function openChannel(): BroadcastChannel | null {
  if (typeof window === "undefined") return null;
  if (typeof BroadcastChannel === "undefined") return null;
  try {
    return new BroadcastChannel(POS_SYNC_CHANNEL);
  } catch {
    return null;
  }
}

/**
 * Announces that a queued order finished syncing.
 *
 * Receivers must treat this as "refresh your counts", never as "print a receipt":
 * the record was completed by another context, and re-running completion effects
 * is what produces a second kitchen ticket for one order.
 */
export function announceQueueSynced(message: Omit<QueueChangeMessage, "type">): void {
  const channel = openChannel();
  if (!channel) return;
  try {
    channel.postMessage({ type: "queue-synced", ...message } satisfies QueueChangeMessage);
  } catch {
    // Nothing to do — the lease already keeps the queue correct.
  } finally {
    try { channel.close(); } catch { /* ignore */ }
  }
}

/**
 * Subscribes to queue changes from other contexts. Returns an unsubscribe
 * function; a no-op when BroadcastChannel is unavailable.
 *
 * Messages from this same context are filtered out, so the tab that did the work
 * does not react to its own announcement.
 */
export function subscribeQueueChanges(selfOwnerId: string, listener: Listener): () => void {
  const channel = openChannel();
  if (!channel) return () => {};

  const handler = (event: MessageEvent) => {
    const data = event.data as Partial<QueueChangeMessage> | null;
    if (!data || data.type !== "queue-synced") return;
    if (typeof data.localOrderId !== "string" || typeof data.orderId !== "string") return;
    if (data.ownerId === selfOwnerId) return;
    listener({
      type: "queue-synced",
      localOrderId: data.localOrderId,
      orderId: data.orderId,
      ownerId: String(data.ownerId ?? ""),
    });
  };

  channel.addEventListener("message", handler);
  return () => {
    channel.removeEventListener("message", handler);
    try { channel.close(); } catch { /* ignore */ }
  };
}
