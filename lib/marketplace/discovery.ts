import "server-only";
import type { Firestore } from "firebase-admin/firestore";
import { checkIsOpen, nextOpenTime, type OpeningHours } from "@/lib/restaurant-utils";
import { haversineKm } from "./geo";
import { readMarketplaceSettings, pricingConfigFor, isOrderable, type MarketplaceSettings } from "./config";
import { priceLine, type LineInput, type PricingConfig } from "./pricing";

/**
 * Marketplace discovery.
 *
 * ── Reads `menu_items`, never `prepared_items` ───────────────────────────────
 * The POS catalog is not involved, so the customer price is a layer computed on
 * top of the restaurant's own `menu_items.price` and the till is untouched by
 * construction.
 *
 * ── Only listed restaurants ──────────────────────────────────────────────────
 * Every query starts from `marketplace.marketplaceEnabled`. A restaurant that
 * has not opted in cannot appear, cannot be fetched by slug, and cannot be
 * ordered from — three separate gates, because one of them will eventually be
 * forgotten in a new code path.
 */

export type PublicRestaurant = {
  slug: string;
  name: string;
  cuisines: string[];
  logoUrl: string | null;
  coverUrl: string | null;
  rating: number | null;
  distanceKm: number | null;
  etaMins: number | null;
  deliveryFeeMinor: number | null;
  feeDynamic: boolean;
  isOpen: boolean;
  opensAt: string | null;
  promoLabel: string | null;
  minOrderMinor: number | null;
};

export type PublicMenuItem = {
  id: string;
  name: string;
  description: string;
  imageUrl: string | null;
  /** The MARKETPLACE price. The restaurant's own price is never in this DTO. */
  priceMinor: number;
  available: boolean;
  optionGroups: Array<{
    id: string; name: string; minSelect: number; maxSelect: number;
    choices: Array<{ id: string; name: string; priceMinor: number }>;
  }>;
};

export type PublicRestaurantDetail = PublicRestaurant & {
  description: string;
  address: string;
  location: { lat: number; lng: number };
  prepTimeMins: { min: number; max: number };
  categories: Array<{ key: string; label: string; items: PublicMenuItem[] }>;
};

/** Rough travel speed for an ETA before Dispatcher has quoted. Pessimistic. */
const CITY_SPEED_KMH = 18;

export async function listMarketplaceRestaurants(
  db: Firestore,
  args: { at: { lat: number; lng: number } | null; nowMs: number; limit?: number }
): Promise<PublicRestaurant[]> {
  const snap = await db
    .collection("restaurants")
    .where("marketplace.marketplaceEnabled", "==", true)
    .limit(args.limit ?? 60)
    .get();

  return snap.docs
    .map((doc) => toPublicRestaurant(doc.id, doc.data() ?? {}, args))
    .filter((r): r is PublicRestaurant => r !== null);
}

export async function getMarketplaceRestaurant(
  db: Firestore,
  args: { slug: string; at: { lat: number; lng: number } | null; nowMs: number }
): Promise<PublicRestaurantDetail | null> {
  const snap = await db.collection("restaurants").doc(args.slug).get();
  if (!snap.exists) return null;

  const data = snap.data() ?? {};
  const settings = readMarketplaceSettings(data);
  // A restaurant that has not opted in is NOT FOUND, not "closed". It has no
  // public existence in the marketplace at all.
  if (!settings.marketplaceEnabled) return null;

  const base = toPublicRestaurant(args.slug, data, args);
  if (!base) return null;

  const config = pricingConfigFor({ settings });
  const items = await db.collection("menu_items").where("restaurantId", "==", args.slug).get();

  const byCategory = new Map<string, PublicMenuItem[]>();
  for (const doc of items.docs) {
    const item = toPublicMenuItem(doc.id, doc.data() ?? {}, config);
    if (!item) continue;
    const key = String((doc.data() ?? {}).category ?? "Other").trim() || "Other";
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key)!.push(item);
  }

  return {
    ...base,
    description: String(data.description ?? ""),
    address: String(data.address ?? ""),
    location: { lat: Number(data.latitude ?? 0), lng: Number(data.longitude ?? 0) },
    prepTimeMins: settings.prepTimeMins,
    categories: [...byCategory.entries()].map(([label, list]) => ({
      key: label.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      label,
      items: list,
    })),
  };
}

function toPublicRestaurant(
  slug: string,
  data: Record<string, unknown>,
  args: { at: { lat: number; lng: number } | null; nowMs: number }
): PublicRestaurant | null {
  const settings = readMarketplaceSettings(data);
  if (!settings.marketplaceEnabled) return null;

  const lat = Number(data.latitude);
  const lng = Number(data.longitude);
  const hasPin = Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);

  const distanceKm = hasPin && args.at
    ? Math.round(haversineKm(args.at, { lat, lng }) * 10) / 10
    : null;

  const hours = (data.openingHours ?? null) as OpeningHours | null;
  const open = isOrderable(settings, args.nowMs).ok && checkIsOpen(hours);
  const next = nextOpenTime(hours, new Date(args.nowMs));

  return {
    slug,
    name: settings.publicName ?? String(data.name ?? slug),
    cuisines: Array.isArray(data.marketplace)
      ? []
      : (((data.marketplace ?? {}) as { cuisines?: unknown }).cuisines as string[] | undefined) ?? [],
    logoUrl: str(data.logo),
    coverUrl: str(data.coverImage),
    rating: typeof data.rating === "number" ? data.rating : null,
    distanceKm,
    // Travel time plus the kitchen. Replaced by Dispatcher's real ETA at quote.
    etaMins: distanceKm != null
      ? Math.ceil((distanceKm / CITY_SPEED_KMH) * 60 + settings.prepTimeMins.min)
      : settings.prepTimeMins.max,
    deliveryFeeMinor: null,
    // Delivery is priced by Dispatcher at checkout, so the card says so rather
    // than showing a number that will change.
    feeDynamic: true,
    isOpen: open,
    opensAt: open ? null : next.kind === "opens" ? `Opens ${next.label}` : "Closed",
    promoLabel: ((data.marketplace ?? {}) as { promoLabel?: unknown }).promoLabel as string ?? null,
    minOrderMinor: settings.minOrderMinor,
  };
}

/**
 * A menu item, priced for the marketplace.
 *
 * `channel: "pos_only"` and `"hidden"` never reach a customer, so a restaurant
 * can keep a staff meal or a wholesale line on its menu without it appearing in
 * the app.
 */
export function toPublicMenuItem(
  id: string,
  data: Record<string, unknown>,
  config: PricingConfig
): PublicMenuItem | null {
  const m = (data.marketplace ?? {}) as Record<string, unknown>;
  const channel = typeof m.channel === "string" ? m.channel : "both";
  if (channel === "pos_only" || channel === "hidden") return null;

  const basePrice = Number(data.price);
  if (!Number.isFinite(basePrice) || basePrice < 0) return null;

  const line: LineInput = {
    dishId: id,
    name: String(data.name ?? "Item"),
    quantity: 1,
    // `menu_items.price` is stored in NAIRA; everything downstream is minor.
    basePriceMinor: Math.round(basePrice * 100),
    override: readOverride(m.priceOverride),
  };
  const priced = priceLine(line, config);

  return {
    id,
    name: line.name,
    description: String(data.description ?? ""),
    imageUrl: str(data.image),
    priceMinor: priced.customerPriceMinor,
    // An explicit marketplace availability wins; otherwise the item's own flag.
    available: typeof m.available === "boolean" ? m.available : data.available !== false,
    optionGroups: readOptionGroups(m.options, config),
  };
}

function readOverride(raw: unknown) {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (r.type === "percent" && typeof r.value === "number") return { type: "percent" as const, bps: Math.round(r.value) };
  if (r.type === "fixed" && typeof r.value === "number") return { type: "fixed" as const, amountMinor: Math.round(r.value) };
  if (r.type === "absolute" && typeof r.value === "number") return { type: "absolute" as const, amountMinor: Math.round(r.value) };
  return null;
}

/**
 * Option prices are marked up too.
 *
 * An option is part of what the restaurant is paid for, so leaving it at cost
 * would quietly erode the margin on every configured item.
 */
function readOptionGroups(raw: unknown, config: PricingConfig): PublicMenuItem["optionGroups"] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((g) => {
    const group = (g ?? {}) as Record<string, unknown>;
    if (typeof group.id !== "string" || !Array.isArray(group.choices)) return [];
    return [{
      id: group.id,
      name: String(group.name ?? ""),
      minSelect: Number(group.minSelect ?? 0),
      maxSelect: Number(group.maxSelect ?? 1),
      choices: group.choices.flatMap((c) => {
        const choice = (c ?? {}) as Record<string, unknown>;
        if (typeof choice.id !== "string") return [];
        const baseMinor = Math.round(Number(choice.price ?? 0) * 100);
        const priced = priceLine(
          { dishId: choice.id, name: String(choice.name ?? ""), quantity: 1, basePriceMinor: baseMinor },
          { ...config, roundToMinor: 0 } // rounding belongs on the line, not each option
        );
        return [{ id: choice.id, name: String(choice.name ?? ""), priceMinor: baseMinor === 0 ? 0 : priced.customerPriceMinor }];
      }),
    }];
  });
}

/** The pricing config for one restaurant, for the cart quote. */
export async function pricingFor(db: Firestore, slug: string): Promise<{ settings: MarketplaceSettings; config: PricingConfig } | null> {
  const snap = await db.collection("restaurants").doc(slug).get();
  if (!snap.exists) return null;
  const settings = readMarketplaceSettings(snap.data() ?? {});
  if (!settings.marketplaceEnabled) return null;
  return { settings, config: pricingConfigFor({ settings }) };
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
