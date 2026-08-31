/**
 * In-memory DeliveryStore for the integration tests.
 *
 * Models the two things correctness actually depends on:
 *   1. `claimEvent` is atomic — a second claim for the same id fails, exactly
 *      as a Firestore `create` onto an existing document does.
 *   2. `writeProjection` is a compare-and-set on `sequence` — a write whose
 *      expected sequence no longer matches is refused, so two concurrent
 *      events cannot interleave into a corrupt projection.
 *
 * `writeGate` lets a test hold a write open and interleave a second one, which
 * is what makes the concurrency tests real races rather than sequential calls
 * dressed up as concurrent ones.
 */

import type { DeliveryStore, DeliveryOrderView, TimelineEntry } from "../store";
import type { DeliveryProjection } from "../projection";

export class FakeDeliveryStore implements DeliveryStore {
  readonly orders = new Map<string, DeliveryOrderView>();
  readonly claims = new Set<string>();
  readonly timeline: Array<{ orderId: string } & TimelineEntry> = [];
  /** Number of refused compare-and-set writes, for assertions. */
  casRejections = 0;
  /** Await-ed before every projection write, so a test can interleave. */
  writeGate: (() => Promise<void>) | null = null;

  seedOrder(view: DeliveryOrderView): this {
    this.orders.set(view.orderId, structuredClone(view));
    return this;
  }

  async getOrder(orderId: string): Promise<DeliveryOrderView | null> {
    const v = this.orders.get(orderId);
    return v ? structuredClone(v) : null;
  }

  async claimEvent(eventId: string): Promise<boolean> {
    if (this.claims.has(eventId)) return false;
    this.claims.add(eventId);
    return true;
  }

  async writeProjection(orderId: string, expectedSequence: number, next: DeliveryProjection): Promise<boolean> {
    if (this.writeGate) await this.writeGate();
    const current = this.orders.get(orderId);
    if (!current) return false;
    const storedSeq = current.delivery?.sequence ?? 0;
    if (storedSeq !== expectedSequence) {
      this.casRejections++;
      return false;
    }
    current.delivery = structuredClone(next);
    return true;
  }

  async appendTimeline(orderId: string, entry: TimelineEntry): Promise<void> {
    this.timeline.push({ orderId, ...entry });
  }

  async findStaleDeliveries(olderThanMs: number, limit: number): Promise<DeliveryOrderView[]> {
    return [...this.orders.values()]
      .filter((o) => o.delivery && o.delivery.lastEventAt < olderThanMs)
      .slice(0, limit)
      .map((o) => structuredClone(o));
  }

  async findDueForConfirm(): Promise<Array<DeliveryOrderView & { confirmAt: number }>> {
    return [];
  }
}
