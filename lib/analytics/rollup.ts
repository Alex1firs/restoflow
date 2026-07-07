import "server-only";
import { getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import {
  aggregateEvents,
  lagosDateKey,
  type CleanEvent,
  type StatsDelta,
  type StorefrontEventType,
  type FulfillmentType,
  type PaymentMethodType,
} from "./events";

// Server-only I/O for storefront funnel analytics. Every write targets a single
// per-restaurant, per-day rollup doc via FieldValue.increment. All functions are
// gated by the STOREFRONT_ANALYTICS_ENABLED flag and swallow their own errors —
// analytics must NEVER block or break the customer journey.

const COLLECTION = "storefront_stats_daily";

/** Feature flag. Analytics is fully inert unless explicitly enabled. */
export function analyticsEnabled(): boolean {
  return process.env.STOREFRONT_ANALYTICS_ENABLED === "true";
}

function deltaToUpdate(slug: string, dateKey: string, delta: StatsDelta): Record<string, unknown> {
  const update: Record<string, unknown> = {
    slug,
    date: dateKey,
    updatedAt: FieldValue.serverTimestamp(),
  };
  for (const [k, v] of Object.entries(delta.counters)) update[k] = FieldValue.increment(v);
  // Dotted paths increment nested map fields without overwriting siblings.
  for (const [k, v] of Object.entries(delta.itemViews)) update[`itemViews.${k}`] = FieldValue.increment(v);
  for (const [k, v] of Object.entries(delta.itemAdds)) update[`itemAdds.${k}`] = FieldValue.increment(v);
  for (const [k, v] of Object.entries(delta.fulfillmentCounts)) update[`fulfillmentCounts.${k}`] = FieldValue.increment(v);
  for (const [k, v] of Object.entries(delta.methodCounts)) update[`methodCounts.${k}`] = FieldValue.increment(v);
  return update;
}

async function writeDelta(slug: string, delta: StatsDelta): Promise<void> {
  const dateKey = lagosDateKey();
  const docId = `${slug}__${dateKey}`;
  await getAdminDb().collection(COLLECTION).doc(docId).set(deltaToUpdate(slug, dateKey, delta), { merge: true });
}

/** Ingest a batch of validated client events into the daily rollup. Never throws. */
export async function recordClientEvents(slug: string, events: CleanEvent[]): Promise<void> {
  if (!analyticsEnabled() || !slug || events.length === 0) return;
  try {
    await writeDelta(slug, aggregateEvents(events));
  } catch (err) {
    console.error("[analytics] recordClientEvents failed (non-fatal)", err);
  }
}

/**
 * Record a single server-side money-truth funnel event (order_submitted,
 * payment_initialized/successful/failed). Never throws — callers can `await`
 * it safely without a try/catch and it will never affect their response.
 */
export async function recordServerEvent(
  slug: string,
  type: StorefrontEventType,
  meta?: { fulfillment?: FulfillmentType; method?: PaymentMethodType }
): Promise<void> {
  if (!analyticsEnabled() || !slug) return;
  try {
    const ev: CleanEvent = {
      type,
      ...(meta?.fulfillment ? { fulfillment: meta.fulfillment } : {}),
      ...(meta?.method ? { method: meta.method } : {}),
    };
    await writeDelta(slug, aggregateEvents([ev]));
  } catch (err) {
    console.error("[analytics] recordServerEvent failed (non-fatal)", err);
  }
}
