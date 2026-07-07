// Discovery index backfill / rebuild.
//
//   npx tsx scripts/discovery-backfill.ts               # rebuild all restaurants
//   npx tsx scripts/discovery-backfill.ts --slug=food-kapitol
//   npx tsx scripts/discovery-backfill.ts --dry-run     # read + project, write nothing
//
// Idempotent (upsert + reconcile) and resilient (one bad restaurant is recorded,
// not fatal). Uses the Admin SDK (bypasses the deny-all discovery rules).

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createFirestoreStore } from "../lib/discovery/firestore-store";
import { backfillAll } from "../lib/discovery/indexer";
import type { DiscoveryStore } from "../lib/discovery/store";

const app = getApps()[0] ?? initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
    clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  }),
});
const db = getFirestore(app);

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const slug = args.find((a) => a.startsWith("--slug="))?.split("=")[1];

// In dry-run, wrap the real store so reads work but every write is a logged no-op.
function readOnly(base: DiscoveryStore): DiscoveryStore {
  const noop = async (label: string) => { console.log(`  · [dry-run] skipped ${label}`); };
  return {
    listRestaurantSlugs: base.listRestaurantSlugs,
    getRestaurant: base.getRestaurant,
    getMenuItems: base.getMenuItems,
    upsertRestaurant: async (d) => noop(`upsert restaurant ${d.slug}`),
    upsertDishes: async (docs) => noop(`upsert ${docs.length} dishes`),
    deleteDishesNotIn: async (s) => noop(`reconcile dishes for ${s}`),
    deleteRestaurant: async (s) => noop(`delete restaurant ${s}`),
    deleteAllDishesForRestaurant: async (s) => noop(`delete all dishes for ${s}`),
  };
}

(async () => {
  const base = createFirestoreStore(db);
  const store = dryRun ? readOnly(base) : base;
  const now = Date.now();

  console.log(`Discovery backfill${dryRun ? " (DRY RUN)" : ""}${slug ? ` — slug=${slug}` : " — all restaurants"}`);
  const summary = await backfillAll(store, now, slug ? { slugs: [slug] } : undefined);

  for (const r of summary.results) {
    const flag = r.ok ? (r.purged ? "purged" : r.visible ? "visible" : "hidden") : "FAILED";
    console.log(`  ${r.ok ? "✓" : "✗"} ${r.slug} — ${flag}, ${r.dishCount} dish(es)${r.error ? ` — ${r.error}` : ""}`);
  }
  console.log(
    `\n${summary.ok}/${summary.total} ok · ${summary.visible} visible · ${summary.dishes} dishes${summary.failed ? ` · ${summary.failed} FAILED` : ""}`,
  );
  process.exit(summary.failed ? 1 : 0);
})().catch((e) => {
  console.error("backfill error:", e);
  process.exit(2);
});
