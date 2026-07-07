// Firestore adapter for the DiscoveryStore port.
//
// Type-only firebase-admin import (no `server-only`, no runtime init) and it
// receives the `db` instance — so BOTH a server route (`createFirestoreStore(getAdminDb())`)
// and the standalone backfill script (which inits admin itself) can use it.

import type { Firestore } from "firebase-admin/firestore";
import type { DiscoveryStore } from "./store";
import type { DiscoveryDish, DiscoveryRestaurant, SourceMenuItem, SourceRestaurant } from "./types";

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

/** Map a raw `restaurants` doc into the normalized SourceRestaurant the projector expects. */
function normalizeRestaurant(slug: string, d: Doc): SourceRestaurant {
  return {
    slug,
    name: d.name as string | undefined,
    description: d.description as string | undefined,
    logo: d.logo as string | undefined,
    coverImage: d.coverImage as string | undefined,
    address: d.address as string | undefined,
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
  };
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
  };
}
