// Browser-side storefront analytics emitter.
//
// A tiny, dependency-free singleton that batches top-of-funnel client events and
// ships them to the Phase 2 ingestion endpoint via navigator.sendBeacon (with a
// keepalive-fetch fallback). Everything is guarded and swallowed — analytics must
// NEVER block or break storefront browsing, cart, checkout, payment, or tracking.
//
// It only ever sends the restaurant slug + a whitelisted event list. No PII, no
// session id, no IP is transmitted. The optional session id used for visit
// de-duplication lives only in sessionStorage and is never sent.

import type { ClientEventType, FulfillmentType, PaymentMethodType } from "./events";

type Meta = { itemId?: string; fulfillment?: FulfillmentType; method?: PaymentMethodType };
type QueuedEvent = { type: ClientEventType } & Meta;

const ENDPOINT = "/api/storefront/events";
const FLUSH_DELAY_MS = 3000;
const MAX_QUEUE = 40;

let slug = "";
let enabled = false;
let configured = false;
let listenersBound = false;
let queue: QueuedEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const viewedItems = new Set<string>();

function canRun(): boolean {
  return enabled && !!slug && typeof window !== "undefined";
}

/**
 * Configure the emitter for a storefront. Safe to call on every mount; only the
 * first call per page binds flush listeners. Passing enabled=false makes every
 * subsequent track() call an immediate no-op (used for preview / flag-off).
 */
export function configureAnalytics(nextSlug: string, isEnabled: boolean): void {
  slug = nextSlug || "";
  enabled = isEnabled && !!slug;
  configured = true;
  if (!enabled || listenersBound || typeof window === "undefined") return;
  try {
    // Flush on tab-hide / navigation — the reliable moment for beacons.
    window.addEventListener(
      "visibilitychange",
      () => { if (document.visibilityState === "hidden") flush(); },
      { passive: true }
    );
    window.addEventListener("pagehide", () => flush(), { passive: true });
    listenersBound = true;
  } catch {
    /* ignore — listeners are an optimization, the timer still flushes */
  }
}

function scheduleFlush(): void {
  if (flushTimer) return;
  try {
    flushTimer = setTimeout(() => { flushTimer = null; flush(); }, FLUSH_DELAY_MS);
  } catch {
    /* ignore */
  }
}

function flush(): void {
  if (!canRun() || queue.length === 0) return;
  const events = queue;
  queue = [];
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  const payload = JSON.stringify({ slug, events });
  try {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const ok = navigator.sendBeacon(ENDPOINT, new Blob([payload], { type: "application/json" }));
      if (ok) return;
    }
    // Fallback: keepalive fetch so it survives page unload. Errors swallowed.
    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* last resort — drop silently; analytics never surfaces an error */
  }
}

/** Queue a top-of-funnel client event. No-op when disabled/unconfigured. */
export function track(type: ClientEventType, meta?: Meta): void {
  if (!canRun()) return;
  try {
    queue.push({ type, ...meta });
    if (queue.length >= MAX_QUEUE) flush();
    else scheduleFlush();
  } catch {
    /* ignore */
  }
}

/** storefront_visit — once per browser session per slug (survives reloads). */
export function trackVisitOnce(): void {
  if (!canRun()) return;
  try {
    const key = `sf_visit:${slug}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
  } catch {
    /* sessionStorage unavailable — fall through and still emit once per load */
  }
  track("storefront_visit");
}

/** menu_item_view — once per item per page load (in-memory de-dupe). */
export function trackItemViewOnce(itemId: string): void {
  if (!canRun() || !itemId || viewedItems.has(itemId)) return;
  viewedItems.add(itemId);
  track("menu_item_view", { itemId });
}

// Exported for tests only — resets module state.
export function __resetForTest(): void {
  slug = ""; enabled = false; configured = false; listenersBound = false;
  queue = []; if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  viewedItems.clear();
}
void configured;
