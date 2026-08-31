/**
 * Seed a STAGING RestoFlow with synthetic marketplace data.
 *
 * ── Refuses to run against production ────────────────────────────────────────
 * Three independent guards, because "I thought that terminal was staging" is
 * how production data gets overwritten:
 *   1. the project id must be on an allowlist of staging ids
 *   2. it must not match a known production id
 *   3. --confirm must be passed explicitly
 *
 * Nothing here is copied from production. Every restaurant, menu item and
 * customer below is invented, and the names are obviously fake so a screenshot
 * of staging can never be mistaken for live data.
 *
 *   npx tsx scripts/seed-staging-marketplace.ts --confirm
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.staging" });

const ALLOWED_STAGING_PROJECTS = ["restoflow-staging", "demo-rest", "restoflow-preview"];
const KNOWN_PRODUCTION_PROJECTS = ["restoflow", "restoflow-prod", "restaflow"];

async function main() {
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID ?? "";

  if (KNOWN_PRODUCTION_PROJECTS.includes(projectId)) {
    throw new Error(`REFUSING TO RUN: "${projectId}" is a production project.`);
  }
  if (!ALLOWED_STAGING_PROJECTS.includes(projectId)) {
    throw new Error(
      `REFUSING TO RUN: "${projectId}" is not a known staging project.\n` +
      `Add it to ALLOWED_STAGING_PROJECTS only if you are certain it is not production.`
    );
  }
  if (!process.argv.includes("--confirm")) {
    console.log(`Would seed synthetic marketplace data into "${projectId}".`);
    console.log("Re-run with --confirm to write.");
    return;
  }

  const { initializeApp, cert } = await import("firebase-admin/app");
  const { getFirestore, FieldValue } = await import("firebase-admin/firestore");

  const app = initializeApp({
    credential: cert({
      projectId,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
  const db = getFirestore(app);

  // ── A synthetic restaurant, opted in to the marketplace ──
  const slug = "staging-test-kitchen";
  await db.collection("restaurants").doc(slug).set({
    name: "Staging Test Kitchen (SYNTHETIC)",
    status: "live",
    subscriptionStatus: "active",
    subscriptionEndDate: new Date(Date.now() + 365 * 86_400_000),
    address: "1 Test Street, Ikeja, Lagos",
    state: "Lagos", city: "Ikeja",
    phone: "+2348000000000", notificationPhone: "+2348000000000",
    latitude: 6.6018, longitude: 3.3515, geoStatus: "confirmed",
    deliveryEnabled: true, pickupEnabled: true,
    orderCounter: 0,
    marketplace: {
      state: "active",
      marketplaceEnabled: true,
      publicName: "Staging Test Kitchen",
      prepTimeMins: { min: 20, max: 30 },
      deliveryRadiusKm: 12,
      pricing: { markup: { type: "percent", bps: 2000 }, roundToMinor: 5000 },
      approvedAt: Date.now(),
      approvedBy: "seed-script",
    },
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  // ── A second restaurant that is deliberately NOT opted in ──
  // Proves the default: present, live, trading, and invisible to the marketplace.
  await db.collection("restaurants").doc("staging-internal-only").set({
    name: "Staging Internal Only (SYNTHETIC)",
    status: "live", subscriptionStatus: "active",
    latitude: 6.5900, longitude: 3.3600,
    orderCounter: 0,
    // no `marketplace` map, on purpose
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  // ── Menu items (the CUSTOMER catalog — prepared_items is POS and untouched) ──
  const items = [
    { id: "stg-jollof", name: "Jollof Rice & Chicken", price: 10_000, category: "Rice" },
    { id: "stg-suya", name: "Beef Suya", price: 5_000, category: "Grills" },
    { id: "stg-pepper", name: "Pepper Soup", price: 7_500, category: "Soups" },
  ];
  for (const it of items) {
    await db.collection("menu_items").doc(it.id).set({
      restaurantId: slug, name: it.name, price: it.price, category: it.category,
      description: "Synthetic staging item.", image: "", available: true,
      marketplace: { channel: "both", available: null, priceOverride: null },
    }, { merge: true });
  }

  // ── A synthetic customer ──
  await db.collection("customers").doc("staging-customer-1").set({
    uid: "staging-customer-1",
    phone: "+2348111111111",
    name: "Staging Customer",
    status: "active",
    createdAt: Date.now(),
  }, { merge: true });

  console.log(`Seeded synthetic marketplace data into "${projectId}":`);
  console.log(`  restaurants: ${slug} (marketplace ACTIVE), staging-internal-only (NOT listed)`);
  console.log(`  menu_items:  ${items.length}`);
  console.log(`  customers:   1`);
  console.log("\nNo production data was read or written.");
}

main().catch((err) => { console.error(err.message ?? err); process.exit(1); });
