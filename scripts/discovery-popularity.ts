// Discovery popularity recompute (Sprint 2.3).
//
//   npx tsx scripts/discovery-popularity.ts            # recompute + write popularity
//   npx tsx scripts/discovery-popularity.ts --dry-run  # read + compute, write nothing
//
// Reads recent orders (read-only) and updates ONLY the popularity fields on
// discovery docs. Intended to be invoked by the nightly scheduler. Uses the
// Admin SDK (bypasses the deny-all discovery rules).

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createFirestoreStore } from "../lib/discovery/firestore-store";
import { recomputePopularity } from "../lib/discovery/popularity-job";
import type { DiscoveryStore } from "../lib/discovery/store";

const app = getApps()[0] ?? initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
    clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  }),
});
const db = getFirestore(app);
const dryRun = process.argv.slice(2).includes("--dry-run");

// Dry-run: reads work, popularity writes become logged no-ops.
function readOnly(base: DiscoveryStore): DiscoveryStore {
  return {
    ...base,
    applyDishPopularity: async (u) => { console.log(`  · [dry-run] skipped ${u.length} dish popularity writes`); },
    applyRestaurantPopularity: async (u) => { console.log(`  · [dry-run] skipped ${u.length} restaurant popularity writes`); },
  };
}

(async () => {
  const base = createFirestoreStore(db);
  const store = dryRun ? readOnly(base) : base;
  console.log(`Discovery popularity recompute${dryRun ? " (DRY RUN)" : ""}`);

  const s = await recomputePopularity(store, Date.now());
  console.log(
    `  orders scanned: ${s.orders} · scored dishes: ${s.scoredDishes}/${s.dishDocs} · scored restaurants: ${s.scoredRestaurants}/${s.restaurantDocs}`,
  );
  console.log(dryRun ? "\nDRY RUN — no writes performed." : "\nDone.");
  process.exit(0);
})().catch((e) => {
  console.error("popularity recompute error:", e);
  process.exit(2);
});
