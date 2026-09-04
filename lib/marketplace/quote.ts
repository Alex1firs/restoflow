import "server-only";
import { customerDeliveryFee } from "./pricing";
import { randomUUID } from "crypto";
import type { Firestore } from "firebase-admin/firestore";
import { CONTRACT_VERSION } from "@/lib/delivery/contract";
import { readDeliveryConfig } from "@/lib/delivery/config";
import { DispatcherClient } from "@/lib/delivery/dispatcher-client";
import { unserviceableToCustomerDetail } from "@/lib/delivery/status";
import { pricingFor, toPublicMenuItem } from "./discovery";
import type { MarketplaceOrderItem } from "./order";
import { buildSnapshot, checkInvariants, type LineInput, type PriceSnapshot } from "./pricing";
import { isOrderable } from "./config";

/**
 * The authoritative cart quote.
 *
 * ── The client sends ids and quantities. Nothing else. ───────────────────────
 * Prices are looked up server-side from `menu_items`, marked up server-side,
 * and totalled server-side. A price in the request body would make the client
 * authoritative about money, and there is no request field here through which
 * one could arrive.
 *
 * ── Delivery is Dispatcher's answer, not ours ────────────────────────────────
 * Serviceability, fee and ETA all come from Dispatcher's quote. RestoFlow
 * decides what the CUSTOMER is charged for delivery on top of that, which is a
 * separate number and a separate ledger line.
 */

export type QuoteLineRequest = {
  itemId: string;
  quantity: number;
  options: Array<{ groupId: string; choiceId: string }>;
  note?: string;
};

export type QuoteResult =
  | {
      ok: true;
      serviceable: true;
      snapshot: PriceSnapshot;
      /**
       * The cart, with every option resolved against the menu.
       *
       * Returned rather than left for the caller to rebuild: the resolution
       * happened here, against the restaurant's real option groups, and a
       * second pass over the client's payload would be a second source of
       * truth for what was actually ordered.
       */
      items: MarketplaceOrderItem[];
      /**
       * The restaurant's display name, resolved here because this is where the
       * restaurant document is already read. Callers freeze it onto the intent
       * so a customer never sees an internal slug.
       */
      restaurantName: string;
      prepMins: number;
      etaMins: number | null;
      quoteId: string;
      expiresAt: string;
      correlationId: string;
    }
  | { ok: true; serviceable: false; reason: string; code: string }
  | { ok: false; error: string };

export async function quoteCart(args: {
  db: Firestore;
  restaurantSlug: string;
  lines: QuoteLineRequest[];
  dropoff: { lat: number; lng: number };
  nowMs: number;
  correlationId?: string;
}): Promise<QuoteResult> {
  const correlationId = args.correlationId ?? `q-${randomUUID().slice(0, 12)}`;

  if (args.lines.length === 0) return { ok: true, serviceable: false, reason: "Your cart is empty.", code: "EMPTY_CART" };

  const pricing = await pricingFor(args.db, args.restaurantSlug);
  if (!pricing) return { ok: false, error: "That restaurant isn't taking orders." };

  const orderable = isOrderable(pricing.settings, args.nowMs);
  if (!orderable.ok) {
    return { ok: true, serviceable: false, reason: "This restaurant isn't accepting orders right now.", code: orderable.reason ?? "CLOSED" };
  }

  // ── Price the basket from the database, never from the request ────────────
  const restaurantSnap = await args.db.collection("restaurants").doc(args.restaurantSlug).get();
  const restaurant = restaurantSnap.data() ?? {};
  const pickup = { lat: Number(restaurant.latitude), lng: Number(restaurant.longitude) };
  if (!Number.isFinite(pickup.lat) || !Number.isFinite(pickup.lng)) {
    return { ok: false, error: "That restaurant isn't set up for delivery yet." };
  }

  const itemDocs = await args.db.collection("menu_items")
    .where("restaurantId", "==", args.restaurantSlug).get();
  const byId = new Map(itemDocs.docs.map((d) => [d.id, d.data() ?? {}]));

  const priced: LineInput[] = [];
  const items: MarketplaceOrderItem[] = [];
  for (const line of args.lines) {
    const raw = byId.get(line.itemId);
    if (!raw) return { ok: true, serviceable: false, reason: "An item in your cart is no longer on the menu.", code: "ITEM_GONE" };

    const item = toPublicMenuItem(line.itemId, raw, pricing.config);
    if (!item) return { ok: true, serviceable: false, reason: "An item in your cart is no longer available.", code: "ITEM_GONE" };
    if (!item.available) return { ok: true, serviceable: false, reason: `"${item.name}" is currently unavailable.`, code: "ITEM_UNAVAILABLE" };
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 50) {
      return { ok: false, error: "Invalid quantity." };
    }

    // Options are resolved against the MENU's option groups, so a client
    // cannot invent a cheap option or a free upgrade.
    let optionsTotalMinor = 0;
    const resolvedOptions: MarketplaceOrderItem["options"] = [];
    for (const chosen of line.options ?? []) {
      const group = item.optionGroups.find((g) => g.id === chosen.groupId);
      const choice = group?.choices.find((c) => c.id === chosen.choiceId);
      if (!choice) return { ok: false, error: "An option in your cart is no longer available." };
      optionsTotalMinor += choice.priceMinor;
      // The NAME is captured too, not just the id: an order printed in the
      // kitchen months later must still read "Extra plantain", even if the
      // restaurant has since renamed or deleted that option.
      resolvedOptions.push({ groupId: group!.id, optionId: choice.id, name: choice.name, priceMinor: choice.priceMinor });
    }
    for (const group of item.optionGroups) {
      const count = (line.options ?? []).filter((o) => o.groupId === group.id).length;
      if (count < group.minSelect || count > group.maxSelect) {
        return { ok: false, error: `Choose your options for ${item.name}.` };
      }
    }

    priced.push({
      dishId: line.itemId,
      name: item.name,
      quantity: line.quantity,
      basePriceMinor: Math.round(Number(raw.price) * 100),
      optionsTotalMinor,
      note: (line.note ?? "").slice(0, 200),
    });

    items.push({
      dishId: line.itemId,
      // On the marketplace the customer catalogue IS the source: `dishId` and
      // `menuItemId` are the same `menu_items` document. They stay separate
      // fields because a POS order fills them differently.
      menuItemId: line.itemId,
      name: item.name,
      quantity: line.quantity,
      options: resolvedOptions,
      note: (line.note ?? "").slice(0, 200),
    });
  }

  // ── Delivery: Dispatcher's answer ─────────────────────────────────────────
  const cfg = readDeliveryConfig();
  if (!cfg.ok || !cfg.config.enabled) {
    // Refuse rather than guess. Taking money for a delivery we cannot price is
    // worse than losing the order (audit decision D6).
    return { ok: false, error: "Delivery isn't available right now. Please try again shortly." };
  }

  const client = new DispatcherClient({
    baseUrl: cfg.config.baseUrl, apiKey: cfg.config.apiKey, signingSecret: cfg.config.signingSecret,
    log: (event, fields) => console.log(JSON.stringify({ scope: "marketplace_quote", event, ...fields })),
  });

  const readyAt = new Date(args.nowMs + pricing.settings.prepTimeMins.max * 60_000).toISOString();
  const delivery = await client.quote({
    contractVersion: CONTRACT_VERSION,
    correlationId,
    externalRef: correlationId,
    serviceType: "FOOD_STANDARD",
    pickup, dropoff: args.dropoff, readyAt,
  });

  if (!delivery.ok) {
    if (delivery.failure.kind === "unserviceable") {
      const reason = extractReason(delivery.failure.message);
      return { ok: true, serviceable: false, reason: unserviceableToCustomerDetail(reason), code: reason };
    }
    return { ok: false, error: "We couldn't work out delivery for this order. Please try again shortly." };
  }

  const q = delivery.value;
  if (!q.serviceable || q.feeMinor == null || !q.quoteId) {
    const reason = (q.reason ?? "PROVIDER_ERROR") as Parameters<typeof unserviceableToCustomerDetail>[0];
    return { ok: true, serviceable: false, reason: unserviceableToCustomerDetail(reason), code: reason };
  }

  // ── The snapshot ──────────────────────────────────────────────────────────
  const snapshot = buildSnapshot({
    lines: priced,
    config: pricing.config,
    deliveryFeeMinor: customerDeliveryFee(q.feeMinor),
    deliveryCostMinor: q.feeMinor,
    // Paystack's Nigerian card fee, estimated here and corrected from the
    // provider at verification.
    processorFeeMinor: Math.min(Math.round(0.015 * estimateTotal(priced, q.feeMinor)) + 10_000, 200_000),
    quoteId: q.quoteId,
    nowMs: args.nowMs,
  });

  const invariants = checkInvariants(snapshot);
  if (!invariants.ok) {
    // Never quote books that do not balance.
    console.error(JSON.stringify({ scope: "marketplace_quote", event: "invariant_violation", correlationId, errors: invariants.errors }));
    return { ok: false, error: "We couldn't price that order. Please try again." };
  }

  const minOrder = pricing.settings.minOrderMinor;
  if (minOrder && snapshot.customerSubtotalMinor < minOrder) {
    return {
      ok: true, serviceable: false, code: "BELOW_MINIMUM",
      reason: `This restaurant has a ₦${(minOrder / 100).toLocaleString("en-NG")} minimum. Please add a little more.`,
    };
  }

  return {
    ok: true, serviceable: true, snapshot, items, correlationId,
    restaurantName: String(
      (pricing.settings as { publicName?: unknown }).publicName ?? restaurant.name ?? args.restaurantSlug
    ),
    prepMins: pricing.settings.prepTimeMins.max,
    etaMins: q.etaToDropoffMins,
    quoteId: q.quoteId,
    expiresAt: q.expiresAt ?? new Date(args.nowMs + 15 * 60_000).toISOString(),
  };
}

function estimateTotal(lines: LineInput[], deliveryMinor: number): number {
  return lines.reduce((s, l) => s + (l.basePriceMinor + (l.optionsTotalMinor ?? 0)) * l.quantity, 0) + deliveryMinor;
}

function extractReason(message: string): Parameters<typeof unserviceableToCustomerDetail>[0] {
  try {
    const parsed = JSON.parse(message) as { reason?: string };
    const r = parsed.reason;
    if (r === "OUT_OF_RANGE" || r === "NO_COVERAGE" || r === "NO_RIDERS" ||
        r === "OUTSIDE_HOURS" || r === "INVALID_ADDRESS") return r;
  } catch { /* fall through */ }
  return "PROVIDER_ERROR";
}

export { customerDeliveryFee };
