// Discovery geocode reconciliation (Sprint 2.4).
//
//   npx tsx scripts/discovery-geocode.ts --dry-run   # geocode reads run, ZERO Firestore writes
//   npx tsx scripts/discovery-geocode.ts             # write additive geo fields to `restaurants`
//   npx tsx scripts/discovery-geocode.ts --dry-run --limit=5
//
// Reads `restaurants` (read-only), geocodes those that need it via the Google
// adapter, and writes ONLY additive geo fields back to `restaurants`. Discovery
// docs are refreshed separately by the normal reindex/backfill (which projects
// the new geo state). Owner-confirmed pins are never overwritten unless their
// address changed. Uses the Admin SDK. NO real backfill is triggered here.

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createFirestoreStore } from "../lib/discovery/firestore-store";
import { createGoogleGeocoder } from "../lib/discovery/geocode-provider";
import { geocodeRestaurants } from "../lib/discovery/geocode-job";
import type { DiscoveryStore } from "../lib/discovery/store";

const app = getApps()[0] ?? initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
    clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  }),
});
const db = getFirestore(app);

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const limitArg = argv.find((a) => a.startsWith("--limit="))?.split("=")[1];
const limit = limitArg ? Number(limitArg) : undefined;

// Dry-run: reads work, the geo write becomes a logged no-op.
function readOnly(base: DiscoveryStore): DiscoveryStore {
  return {
    ...base,
    applyRestaurantGeo: async (u) => { console.log(`  · [dry-run] skipped ${u.length} restaurant geo writes`); },
  };
}

(async () => {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY ?? process.env.GOOGLE_GEOCODING_API_KEY ?? "";
  if (!dryRun && !apiKey) throw new Error("GOOGLE_MAPS_API_KEY not set");
  if (!apiKey) console.log("  (no GOOGLE_MAPS_API_KEY — geocoder calls will error; run reports needing-count only)");

  const base = createFirestoreStore(db);
  const store = dryRun ? readOnly(base) : base;
  const provider = createGoogleGeocoder(apiKey);

  console.log(`Discovery geocode${dryRun ? " (DRY RUN)" : ""}${typeof limit === "number" ? ` — limit=${limit}` : ""}`);
  const s = await geocodeRestaurants(store, provider, Date.now(), { limit });

  console.log(
    `  scanned: ${s.scanned} · needing geocode: ${s.needing} · resolved(ROOFTOP): ${s.geocoded} · failed: ${s.failed} · skipped: ${s.skipped}`,
  );
  for (const r of s.report.slice(0, 25)) {
    const u = s.updates.find((x) => x.slug === r.slug);
    const where =
      r.status === "geocoded" && u ? `${u.latitude},${u.longitude} (${r.confidence})` : `${r.confidence} · ${r.reason}`;
    console.log(`    → ${r.slug}: ${r.status} — ${where}`);
  }
  if (s.report.length > 25) console.log(`    … and ${s.report.length - 25} more`);
  console.log(dryRun ? "\nDRY RUN — no writes performed." : "\nDone.");
  process.exit(0);
})().catch((e) => {
  console.error("geocode error:", e);
  process.exit(2);
});
