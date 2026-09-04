import { getAdminDb } from "@/lib/firebase-admin";
import { withCustomer, badRequest, unprocessable, coordsFrom } from "@/lib/marketplace/mobile-api";
import {
  addFavourite, isFavouritableRestaurant, isFavourited,
  listFavouriteRestaurants, removeFavourite,
} from "@/lib/marketplace/favourites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The caller's favourite restaurants.
 *
 * Scoped to `customers/{uid}/favourites` by path, where the uid comes from the
 * verified token. There is no request field naming a customer, so the whole
 * class of "read someone else's favourites" has no way to be expressed.
 */
export const GET = withCustomer(async ({ customer, req }) => {
  const at = coordsFrom(new URL(req.url));
  return listFavouriteRestaurants(getAdminDb(), customer.id, { at, nowMs: Date.now() });
});

/**
 * Toggle a favourite.
 *
 * A toggle rather than separate add/remove because that is what a heart button
 * is, and it keeps the two in one round trip. `DELETE /me/favourites/{slug}`
 * exists alongside it for an explicit remove.
 *
 * Idempotent in both directions: the document id is the slug, so adding twice
 * writes one document and removing twice deletes nothing the second time.
 */
export const POST = withCustomer(async ({ customer, req }) => {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return badRequest("Invalid request body");

  const slug = (body as { restaurantSlug?: unknown }).restaurantSlug;
  if (typeof slug !== "string" || !slug.trim()) return badRequest("Choose a restaurant.");
  const clean = slug.trim();

  const db = getAdminDb();
  const already = await isFavourited(db, customer.id, clean);

  if (already) {
    await removeFavourite(db, customer.id, clean);
    return { favourited: false };
  }

  // Only check the restaurant when ADDING. Removing must keep working even for
  // a restaurant that has since left the marketplace, or a customer could be
  // stuck with a favourite they cannot clear.
  if (!(await isFavouritableRestaurant(db, clean))) {
    return unprocessable("That restaurant isn't available.", { code: "RESTAURANT_UNAVAILABLE" });
  }

  await addFavourite(db, customer.id, clean, Date.now());
  return { favourited: true };
});
