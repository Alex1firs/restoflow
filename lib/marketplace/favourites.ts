/**
 * Deliberately NOT `server-only`: no secret, no env, `Firestore` imported as a
 * type only. See the same note in discovery.ts.
 */
import type { Firestore } from "firebase-admin/firestore";
// The collection name, inlined rather than imported from customer.ts: that
// module legitimately holds Firebase Admin auth and is server-only, and
// pulling it in here just for a string would make this logic untestable.
const CUSTOMERS = "customers";
import { toPublicRestaurant } from "./discovery";

/**
 * Favourite restaurants.
 *
 * Stored as `customers/{uid}/favourites/{slug}` — a SUBCOLLECTION, the same
 * shape addresses use, so ownership is a path rather than a field somebody has
 * to remember to compare. A query for another customer's favourites is not a
 * query that can be constructed, and the document id IS the restaurant slug,
 * which makes add and remove naturally idempotent: writing the same favourite
 * twice is one document, deleting a missing one is not an error.
 */

export const FAVOURITES = "favourites";

export function favouritesRef(db: Firestore, customerId: string) {
  return db.collection(CUSTOMERS).doc(customerId).collection(FAVOURITES);
}

/** A restaurant must actually exist and be on the marketplace to be favourited. */
export async function isFavouritableRestaurant(db: Firestore, slug: string): Promise<boolean> {
  const snap = await db.collection("restaurants").doc(slug).get();
  if (!snap.exists) return false;
  const m = (snap.data()?.marketplace ?? {}) as { marketplaceEnabled?: boolean };
  return m.marketplaceEnabled === true;
}

export async function addFavourite(db: Firestore, customerId: string, slug: string, nowMs: number) {
  // set() with a fixed id, not add(): repeating it updates one document rather
  // than accumulating duplicates.
  await favouritesRef(db, customerId).doc(slug).set(
    { restaurantSlug: slug, favouritedAt: nowMs },
    { merge: true }
  );
}

export async function removeFavourite(db: Firestore, customerId: string, slug: string) {
  // Deleting a document that is not there is a no-op in Firestore, which is
  // exactly the idempotency we want — un-favouriting twice is not an error.
  await favouritesRef(db, customerId).doc(slug).delete();
}

export async function isFavourited(db: Firestore, customerId: string, slug: string): Promise<boolean> {
  return (await favouritesRef(db, customerId).doc(slug).get()).exists;
}

export async function listFavouriteSlugs(db: Firestore, customerId: string): Promise<string[]> {
  const snap = await favouritesRef(db, customerId).orderBy("favouritedAt", "desc").limit(100).get();
  return snap.docs.map((d) => d.id);
}

/**
 * The favourites list, as restaurant cards.
 *
 * A restaurant that has since left the marketplace is skipped rather than
 * returned as a broken row: the favourite stays on file (the customer may want
 * it back if the restaurant returns) but it is not shown as orderable.
 */
export async function listFavouriteRestaurants(
  db: Firestore,
  customerId: string,
  args: { at: { lat: number; lng: number } | null; nowMs: number }
) {
  const slugs = await listFavouriteSlugs(db, customerId);
  if (slugs.length === 0) return [];

  // Firestore limits an `in` query to 30 values, so read the documents directly.
  const docs = await db.getAll(...slugs.map((s) => db.collection("restaurants").doc(s)));
  const out = [];
  for (const doc of docs) {
    if (!doc.exists) continue;
    const card = toPublicRestaurant(doc.id, doc.data() ?? {}, args);
    if (card) out.push({ ...card, favourited: true });
  }
  return out;
}
