// Firestore adapter for the DiscoveryStore port.
//
// Type-only firebase-admin import (no `server-only`, no runtime init) and it
// receives the `db` instance — so BOTH a server route (`createFirestoreStore(getAdminDb())`)
// and the standalone backfill script (which inits admin itself) can use it.

import type { Firestore } from "firebase-admin/firestore";
import type { DiscoveryStore } from "./store";
import type { DiscoveryDish, DiscoveryRestaurant, SourceMenuItem, SourceRestaurant } from "./types";
import type { PopularityOrder, PopularityUpdate } from "./popularity";
import type { GeoCandidate, GeoUpdate } from "./geocode-job";
import type { GeoStatus } from "./geo";

const DISHES = "discovery_dishes";
const RESTAURANTS = "discovery_restaurants";
const BATCH = 400; // Firestore hard limit is 500; stay under.

type Doc = Record<string, unknown>;

function toMillis(v: unknown): number | null {
  if (!v) return null;
  if (typeof v === "number") return v;
  const o = v as { toMillis?: () => number; seconds?: number; _seconds?: number };
  if (typeof o.toMillis === "function") return o.toMillis();
  if (typeof o.seconds === "number") return o.seconds * 1000;
  if (typeof o._seconds === "number") return o._seconds * 1000;
  return null;
}

function parseCsv(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof v === "string") return v.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
}

/**
 * Resolve an order line item to its discovery dishId for popularity.
 * Prefers the explicit `menuItemId` seam (2.5b) so orders that carry it map to
 * the menu_items-backed discovery dish; falls back to `id` for online orders
 * (where id already IS the menu_items id) and legacy/POS orders (unchanged
 * behavior — a POS `prepared_items` id or a null menuItemId still resolves to
 * the raw id, which won't match discovery, keeping those restaurant-level only).
 */
export function orderLineToDishId(it: unknown): { dishId: string; quantity: number } {
  const line = (it ?? {}) as { id?: unknown; menuItemId?: unknown; quantity?: unknown };
  const menuItemId = typeof line.menuItemId === "string" && line.menuItemId ? line.menuItemId : null;
  const id = typeof line.id === "string" ? line.id : "";
  return {
    dishId: String(menuItemId ?? id),
    quantity: typeof line.quantity === "number" ? line.quantity : 0,
  };
}

/** Map a raw `restaurants` doc into the normalized SourceRestaurant the projector expects. */
function normalizeRestaurant(slug: string, d: Doc): SourceRestaurant {
  return {
    slug,
    name: d.name as string | undefined,
    description: d.description as string | undefined,
    logo: d.logo as string | undefined,
    coverImage: d.coverImage as string | undefined,
    address: d.address as string | undefined,
    state: d.state as string | undefined,
    city: d.city as string | undefined,
    status: d.status as string | undefined,
    subscriptionStatus: d.subscriptionStatus as string | undefined,
    subscriptionEndDateMs: toMillis(d.subscriptionEndDate),
    deliveryEnabled: d.deliveryEnabled !== false,
    pickupEnabled: d.pickupEnabled !== false,
    dineInEnabled: d.dineInEnabled === true,
    deliveryFee: typeof d.deliveryFee === "number" ? d.deliveryFee : 0,
    deliveryZones: Array.isArray(d.deliveryZones) ? (d.deliveryZones as SourceRestaurant["deliveryZones"]) : [],
    payOnDeliveryEnabled: d.payOnDeliveryEnabled !== false,
    onlinePaymentEnabled: !!d.paystackSubaccountCode,
    whatsappCheckoutEnabled: !!d.whatsappCheckoutEnabled,
    hidePrices: d.hidePrices === true,
    openingHours: d.openingHours ?? null,
    serviceAreas: parseCsv(d.serviceAreas),
    promo: (d.promo as SourceRestaurant["promo"]) ?? null,
    latitude: typeof d.latitude === "number" ? d.latitude : null,
    longitude: typeof d.longitude === "number" ? d.longitude : null,
    geohash: (d.geohash as string) ?? null,
    formattedAddress: (d.formattedAddress as string) ?? null,
    geoStatus: normalizeGeoStatus(d.geoStatus),
    geoConfirmedAtMs: toMillis(d.geoConfirmedAt),
    geoConfidence: (d.geoConfidence as SourceRestaurant["geoConfidence"]) ?? null,
    geoQuery: (d.geoQuery as string) ?? null,
  };
}

function normalizeGeoStatus(v: unknown): GeoStatus {
  return v === "geocoded" || v === "confirmed" || v === "failed" ? v : "none";
}

async function commitInChunks<T>(items: T[], run: (chunk: T[]) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += BATCH) {
    await run(items.slice(i, i + BATCH));
  }
}

export function createFirestoreStore(db: Firestore): DiscoveryStore {
  return {
    async listRestaurantSlugs() {
      const snap = await db.collection("restaurants").get();
      return snap.docs.map((d) => d.id);
    },

    async getRestaurant(slug) {
      const doc = await db.collection("restaurants").doc(slug).get();
      if (!doc.exists) return null;
      return normalizeRestaurant(slug, doc.data() as Doc);
    },

    async getMenuItems(slug) {
      const snap = await db.collection("menu_items").where("restaurantId", "==", slug).get();
      return snap.docs.map((d) => {
        const x = d.data() as Doc;
        const item: SourceMenuItem = {
          id: d.id,
          restaurantId: slug,
          name: x.name as string | undefined,
          description: x.description as string | undefined,
          price: typeof x.price === "number" ? x.price : undefined,
          category: x.category as string | undefined,
          available: x.available !== false,
          image: x.image as string | undefined,
        };
        return item;
      });
    },

    async upsertRestaurant(docData: DiscoveryRestaurant) {
      await db.collection(RESTAURANTS).doc(docData.slug).set(docData as Doc);
    },

    async upsertDishes(docs: DiscoveryDish[]) {
      await commitInChunks(docs, async (chunk) => {
        const batch = db.batch();
        for (const d of chunk) batch.set(db.collection(DISHES).doc(d.dishId), d as Doc);
        await batch.commit();
      });
    },

    async deleteDishesNotIn(slug, keepIds) {
      const keep = new Set(keepIds);
      const snap = await db.collection(DISHES).where("restaurantSlug", "==", slug).get();
      const stale = snap.docs.filter((d) => !keep.has(d.id));
      await commitInChunks(stale, async (chunk) => {
        const batch = db.batch();
        for (const d of chunk) batch.delete(d.ref);
        await batch.commit();
      });
    },

    async deleteRestaurant(slug) {
      await db.collection(RESTAURANTS).doc(slug).delete();
    },

    async deleteAllDishesForRestaurant(slug) {
      const snap = await db.collection(DISHES).where("restaurantSlug", "==", slug).get();
      await commitInChunks(snap.docs, async (chunk) => {
        const batch = db.batch();
        for (const d of chunk) batch.delete(d.ref);
        await batch.commit();
      });
    },

    // ── Popularity (2.3) ──
    async getRecentOrders(sinceMs) {
      // READ-ONLY. Paid + non-rejected filtered in-memory (avoids a composite index);
      // the createdAt range keeps the scan bounded to the popularity window.
      const snap = await db.collection("orders").where("createdAt", ">=", new Date(sinceMs)).get();
      const out: PopularityOrder[] = [];
      for (const d of snap.docs) {
        const x = d.data() as Doc;
        if (x.paymentStatus !== "paid" || x.status === "rejected") continue;
        const lines = (Array.isArray(x.items) ? x.items : []).map(orderLineToDishId);
        out.push({
          restaurantSlug: String(x.restaurantId ?? ""),
          createdAtMs: toMillis(x.createdAt) ?? 0,
          paymentStatus: x.paymentStatus as string | undefined,
          status: x.status as string | undefined,
          lines,
        });
      }
      return out;
    },

    async listDiscoveryDishIds() {
      const snap = await db.collection(DISHES).select().get(); // ids only
      return snap.docs.map((d) => d.id);
    },

    async listDiscoveryRestaurantSlugs() {
      const snap = await db.collection(RESTAURANTS).select().get();
      return snap.docs.map((d) => d.id);
    },

    async applyDishPopularity(updates: PopularityUpdate[]) {
      await applyPopularity(db, DISHES, updates);
    },

    async applyRestaurantPopularity(updates: PopularityUpdate[]) {
      await applyPopularity(db, RESTAURANTS, updates);
    },

    // ── Geo (2.4) ──
    async getRestaurantsForGeocode() {
      // READ-ONLY. Only the geo-relevant fields the job reasons about.
      const snap = await db.collection("restaurants").get();
      return snap.docs.map((doc) => {
        const d = doc.data() as Doc;
        const c: GeoCandidate = {
          slug: doc.id,
          address: (d.address as string) ?? null,
          geoStatus: normalizeGeoStatus(d.geoStatus),
          geoQuery: (d.geoQuery as string) ?? null,
        };
        return c;
      });
    },

    async applyRestaurantGeo(updates: GeoUpdate[]) {
      // Merge-write ONLY additive geo fields onto `restaurants`. geoConfirmedAt is
      // intentionally NOT touched here — confirmation is a super-admin action (2.4c).
      await commitInChunks(updates, async (chunk) => {
        const batch = db.batch();
        for (const u of chunk) {
          batch.set(
            db.collection("restaurants").doc(u.slug),
            {
              latitude: u.latitude,
              longitude: u.longitude,
              geohash: u.geohash,
              formattedAddress: u.formattedAddress,
              geoStatus: u.geoStatus,
              geoConfidence: u.geoConfidence,
              geoQuery: u.geoQuery,
              geocodedAt: new Date(u.geocodedAtMs),
            },
            { merge: true },
          );
        }
        await batch.commit();
      });
    },

    async getVisibleDiscoveryRestaurants() {
      const snap = await db.collection(RESTAURANTS).where("visible", "==", true).get();
      return snap.docs.map((d) => d.data() as DiscoveryRestaurant);
    },

    async getVisibleDiscoveryDishes() {
      const snap = await db.collection(DISHES).where("visible", "==", true).get();
      return snap.docs.map((d) => d.data() as DiscoveryDish);
    },

    async getDiscoveryDishById(dishId: string) {
      const doc = await db.collection(DISHES).doc(dishId).get();
      if (!doc.exists) return null;
      return doc.data() as DiscoveryDish;
    },
  };
}

// Merge-write ONLY the popularity fields onto existing discovery docs.
async function applyPopularity(db: Firestore, collection: string, updates: PopularityUpdate[]): Promise<void> {
  await commitInChunks(updates, async (chunk) => {
    const batch = db.batch();
    for (const u of chunk) {
      batch.set(
        db.collection(collection).doc(u.id),
        {
          popularityScore: u.popularityScore,
          popularityRaw: u.popularityRaw,
          popularityOrders: u.popularityOrders,
          signalsComputedAt: u.signalsComputedAt,
        },
        { merge: true },
      );
    }
    await batch.commit();
  });
}
