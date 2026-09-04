import "server-only";
import type { Firestore } from "firebase-admin/firestore";

/**
 * Display names for orders written before `restaurantName` was stored on them.
 *
 * Orders now freeze the name at checkout, so this only ever fires for historic
 * rows. It exists because the alternative fallback is `restaurantId` — an
 * internal slug like `stg-trishas-kitchen` — appearing in a customer's order
 * history, which is the one thing the name was introduced to stop.
 *
 * Batched, and only for the ids that actually need it: a customer's orders
 * cluster on a handful of restaurants, so this is normally one read or none.
 */
export async function resolveRestaurantNames(
  db: Firestore,
  restaurantIds: readonly string[]
): Promise<Map<string, string>> {
  const unique = [...new Set(restaurantIds.filter(Boolean))];
  const out = new Map<string, string>();
  if (unique.length === 0) return out;

  const refs = unique.map((id) => db.collection("restaurants").doc(id));
  const snaps = await db.getAll(...refs);

  for (const snap of snaps) {
    const data = snap.data();
    if (!data) continue;
    const settings = (data.marketplace ?? {}) as { publicName?: unknown };
    const name = typeof settings.publicName === "string" && settings.publicName.trim()
      ? settings.publicName
      : typeof data.name === "string" && data.name.trim()
        ? data.name
        : null;
    if (name) out.set(snap.id, name);
  }
  return out;
}
