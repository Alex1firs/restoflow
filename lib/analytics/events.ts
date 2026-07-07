// Storefront funnel analytics — shared event schema, validator, and pure
// aggregation. Framework-agnostic (no server-only / firebase imports) so it is
// safe to import from client and server, and unit-testable in isolation.
//
// PII-free by construction: the validator only copies whitelisted fields, so
// customer name / phone / address / email can never reach storage even if a
// client includes them in a payload.

// Events emitted by the browser (top of funnel). A client may ONLY send these.
export const CLIENT_EVENT_TYPES = [
  "storefront_visit",
  "menu_item_view",
  "add_to_cart",
  "remove_from_cart",
  "cart_opened",
  "checkout_started",
  "fulfillment_selected",
  "payment_method_selected",
  "order_tracking_opened",
] as const;

// Money-truth events emitted server-side only (from order/payment routes).
// Clients are rejected if they try to send these.
export const SERVER_EVENT_TYPES = [
  "order_submitted",
  "payment_initialized",
  "payment_successful",
  "payment_failed",
] as const;

export type ClientEventType = (typeof CLIENT_EVENT_TYPES)[number];
export type ServerEventType = (typeof SERVER_EVENT_TYPES)[number];
export type StorefrontEventType = ClientEventType | ServerEventType;

export const FULFILLMENT_TYPES = ["delivery", "pickup", "dine_in"] as const;
export type FulfillmentType = (typeof FULFILLMENT_TYPES)[number];

export const PAYMENT_METHODS = ["online", "cash", "whatsapp"] as const;
export type PaymentMethodType = (typeof PAYMENT_METHODS)[number];

// A validated, PII-free event ready for aggregation.
export type CleanEvent = {
  type: StorefrontEventType;
  itemId?: string;
  fulfillment?: FulfillmentType;
  method?: PaymentMethodType;
};

// ── Limits ────────────────────────────────────────────────────────────────────
const MAX_EVENTS_PER_BATCH = 50;
const MAX_ID_LEN = 200;
// Firestore doc-id-safe slug (letters, digits, hyphen).
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,127}$/i;

const CLIENT_TYPE_SET: ReadonlySet<string> = new Set(CLIENT_EVENT_TYPES);
const FULFILLMENT_SET: ReadonlySet<string> = new Set(FULFILLMENT_TYPES);
const METHOD_SET: ReadonlySet<string> = new Set(PAYMENT_METHODS);

export type IngestPayload = { slug: string; events: CleanEvent[] };
export type ValidationResult =
  | { ok: true; data: IngestPayload }
  | { ok: false; error: string };

function cleanClientEvent(raw: unknown): CleanEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  // Clients may only send client event types — server-only (payment) types are
  // rejected so a browser can't forge/inflate money-truth counters.
  if (typeof r.type !== "string" || !CLIENT_TYPE_SET.has(r.type)) return null;

  const ev: CleanEvent = { type: r.type as ClientEventType };
  if (typeof r.itemId === "string" && r.itemId.length > 0 && r.itemId.length <= MAX_ID_LEN) {
    ev.itemId = r.itemId;
  }
  if (typeof r.fulfillment === "string" && FULFILLMENT_SET.has(r.fulfillment)) {
    ev.fulfillment = r.fulfillment as FulfillmentType;
  }
  if (typeof r.method === "string" && METHOD_SET.has(r.method)) {
    ev.method = r.method as PaymentMethodType;
  }
  // Any other field (name, phone, address, email, sessionId, …) is intentionally
  // NOT copied — PII can never reach storage.
  return ev;
}

/** Validate + sanitize a client ingestion payload. Never trusts client input. */
export function validateIngestPayload(body: unknown): ValidationResult {
  if (!body || typeof body !== "object") return { ok: false, error: "Invalid body" };
  const b = body as Record<string, unknown>;
  if (typeof b.slug !== "string" || !SLUG_RE.test(b.slug)) {
    return { ok: false, error: "Invalid slug" };
  }
  if (!Array.isArray(b.events) || b.events.length === 0) {
    return { ok: false, error: "No events" };
  }
  const events = b.events
    .slice(0, MAX_EVENTS_PER_BATCH)
    .map(cleanClientEvent)
    .filter((e): e is CleanEvent => e !== null);
  if (events.length === 0) return { ok: false, error: "No valid events" };
  return { ok: true, data: { slug: b.slug, events } };
}

// ── Aggregation (pure) ─────────────────────────────────────────────────────────

// Map an event type to its daily-rollup counter field.
export const EVENT_COUNTER: Record<StorefrontEventType, string> = {
  storefront_visit: "visits",
  menu_item_view: "menu_item_views",
  add_to_cart: "add_to_cart",
  remove_from_cart: "remove_from_cart",
  cart_opened: "cart_opened",
  checkout_started: "checkout_started",
  fulfillment_selected: "fulfillment_selected",
  payment_method_selected: "payment_method_selected",
  order_tracking_opened: "order_tracking_opened",
  order_submitted: "order_submitted",
  payment_initialized: "payment_initialized",
  payment_successful: "payment_successful",
  payment_failed: "payment_failed",
};

// The distinct daily-rollup counter field names (used by the dashboard aggregator).
export const COUNTER_FIELDS: string[] = Array.from(new Set(Object.values(EVENT_COUNTER)));

export type StatsDelta = {
  counters: Record<string, number>;
  itemViews: Record<string, number>;
  itemAdds: Record<string, number>;
  fulfillmentCounts: Record<string, number>;
  methodCounts: Record<string, number>;
};

const bump = (m: Record<string, number>, k: string, n = 1) => { m[k] = (m[k] ?? 0) + n; };

/** Fold a batch of events into an increment delta. Pure, no I/O. */
export function aggregateEvents(events: CleanEvent[]): StatsDelta {
  const d: StatsDelta = { counters: {}, itemViews: {}, itemAdds: {}, fulfillmentCounts: {}, methodCounts: {} };
  for (const ev of events) {
    const field = EVENT_COUNTER[ev.type];
    if (field) bump(d.counters, field);
    if (ev.type === "menu_item_view" && ev.itemId) bump(d.itemViews, ev.itemId);
    if (ev.type === "add_to_cart" && ev.itemId) bump(d.itemAdds, ev.itemId);
    if (ev.type === "fulfillment_selected" && ev.fulfillment) bump(d.fulfillmentCounts, ev.fulfillment);
    if ((ev.type === "payment_method_selected" || ev.type === "order_submitted") && ev.method) {
      bump(d.methodCounts, ev.method);
    }
  }
  return d;
}

/** Africa/Lagos calendar day key (YYYY-MM-DD) — matches the AI rollup convention. */
export function lagosDateKey(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}
