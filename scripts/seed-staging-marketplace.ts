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
 * Two of the restaurants carry names that echo real ones. The NAME is the only
 * thing they share: the addresses, coordinates, menus, prices, phone numbers
 * and opening hours below were all made up for this file, and nothing was read
 * from a production database to write it. The "(STAGING COPY — SYNTHETIC)"
 * suffix is mandatory and load-bearing; it is what stops a screenshot of a
 * staging order being mistaken for a real one.
 *
 *   npx tsx scripts/seed-staging-marketplace.ts --confirm
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.staging" });

// The real ids, confirmed against `firebase projects:list` on 2026-09-03.
//
// The previous denylist guessed at names ("restoflow", "restoflow-prod") that
// do not exist. RestoFlow production is `restaurant-saas-64235` — a name that
// looks nothing like the product — and the guessed list would not have caught
// it. The allowlist would still have refused, but a guard that fails to fire
// is not a guard, so both lists are now derived from the account's actual
// projects rather than from what the projects ought to be called.
const ALLOWED_STAGING_PROJECTS = ["restoflow-staging", "demo-rest", "restoflow-preview"];
const KNOWN_PRODUCTION_PROJECTS = [
  "restaurant-saas-64235",  // RestoFlow production
  "pack-delivery-live",     // Dispatcher production
  "pack-delivery",          // Dispatcher dev — shared, real, and not ours to seed
];

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

  // ── The restaurants ───────────────────────────────────────────────────────
  //
  // Three shapes, chosen so the app has something real to exercise:
  //   1. open, marketplace ACTIVE, full menu with options  → the happy path
  //   2. open, marketplace ACTIVE, high minimum + far away → refusals
  //   3. live and trading, but never opted in              → invisibility
  //
  // A staging environment with only working data proves only that the happy
  // path works.

  const RESTAURANTS = [
    {
      slug: "stg-trishas-kitchen",
      name: "Trisha's Kitchen (STAGING COPY — SYNTHETIC)",
      publicName: "Trisha's Kitchen",
      cuisines: ["African", "Rice", "Grills"],
      address: "14 Synthetic Close, Lekki Phase 1, Lagos",
      city: "Lekki", lat: 6.4474, lng: 3.4736,
      coverUrl: "https://images.unsplash.com/photo-1604329760661-e71dc83f8f26?w=1200&q=70",
      logoUrl: "https://images.unsplash.com/photo-1552566626-52f8b828add9?w=200&q=70",
      marketplace: {
        state: "active", marketplaceEnabled: true,
        prepTimeMins: { min: 20, max: 35 },
        deliveryRadiusKm: 15, minOrderMinor: 200_000,
        pricing: { markup: { type: "percent", bps: 2000 }, roundToMinor: 5_000 },
      },
    },
    {
      slug: "stg-the-steam-menu",
      name: "The Steam Menu (STAGING COPY — SYNTHETIC)",
      publicName: "The Steam Menu",
      cuisines: ["Asian", "Bowls", "Small chops"],
      address: "8 Invented Avenue, Ikeja GRA, Lagos",
      city: "Ikeja", lat: 6.6018, lng: 3.3515,
      coverUrl: "https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?w=1200&q=70",
      logoUrl: "https://images.unsplash.com/photo-1590846406792-0adc7f938f1d?w=200&q=70",
      marketplace: {
        state: "active", marketplaceEnabled: true,
        prepTimeMins: { min: 30, max: 50 },
        // A deliberately high minimum and a tight radius, so BELOW_MINIMUM and
        // OUT_OF_RANGE are reachable in staging without editing data.
        deliveryRadiusKm: 5, minOrderMinor: 1_500_000,
        pricing: { markup: { type: "percent", bps: 2500 }, roundToMinor: 10_000 },
      },
    },
    {
      slug: "stg-internal-only",
      name: "Staging Internal Only (SYNTHETIC)",
      publicName: null,
      address: "3 Nowhere Street, Yaba, Lagos",
      city: "Yaba", lat: 6.5158, lng: 3.3696,
      // No `marketplace` map at all. This restaurant is live, subscribed and
      // taking POS orders, and must never appear in the customer app. It is
      // the control: if it shows up in the feed, the opt-in default is broken.
      marketplace: null,
    },
  ];

  for (const r of RESTAURANTS) {
    await db.collection("restaurants").doc(r.slug).set({
      name: r.name,
      status: "live",
      subscriptionStatus: "active",
      subscriptionEndDate: new Date(Date.now() + 365 * 86_400_000),
      address: r.address,
      state: "Lagos", city: r.city,
      phone: "+2348000000000", notificationPhone: "+2348000000000",
      latitude: r.lat, longitude: r.lng, geoStatus: "confirmed",
      deliveryEnabled: true, pickupEnabled: true,
      orderCounter: 0,
      isStagingSynthetic: true,
      coverImage: r.coverUrl ?? null,
      logo: r.logoUrl ?? null,
      ...(r.marketplace
        ? {
            marketplace: {
              ...r.marketplace,
              publicName: r.publicName,
              cuisines: r.cuisines ?? [],
              approvedAt: Date.now(),
              approvedBy: "seed-script",
              // Open every day, all day — a staging environment that is closed
              // at 3am is a staging environment nobody can test at 3am.
              hours: null,
            },
          }
        : {}),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  // ── Menu items ────────────────────────────────────────────────────────────
  //
  // Written to `menu_items` — the CUSTOMER catalogue. `prepared_items` is the
  // POS catalogue and is not touched by this script at all: the two are
  // unlinked, which is exactly what makes marketplace pricing safe.

  // Real photography so the app can be reviewed as it will actually look.
  const DISH_IMAGES: Record<string, string> = {"stg-jollof": "https://images.unsplash.com/photo-1604329760661-e71dc83f8f26?w=600&q=70", "stg-suya": "https://images.unsplash.com/photo-1529193591184-b1d58069ecdd?w=600&q=70", "stg-pepper": "https://images.unsplash.com/photo-1547592180-85f173990554?w=600&q=70", "stg-soldout": "https://images.unsplash.com/photo-1535140728325-a4d3707eee61?w=600&q=70", "stg-steam-rice": "https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?w=600&q=70", "stg-steam-dumpling": "https://images.unsplash.com/photo-1496116218417-1a781b1c416c?w=600&q=70"};

  const MENU: Array<{
    id: string; restaurantId: string; name: string; price: number; category: string;
    description: string; channel?: string; available?: boolean;
    options?: Array<{ id: string; name: string; minSelect: number; maxSelect: number;
                      choices: Array<{ id: string; name: string; price: number }> }>;
  }> = [
    {
      id: "stg-jollof", restaurantId: "stg-trishas-kitchen",
      name: "Jollof Rice & Chicken", price: 3_500, category: "Rice",
      description: "Synthetic staging item. Smoky party jollof with grilled chicken.",
      options: [
        { id: "protein", name: "Protein", minSelect: 1, maxSelect: 1, choices: [
          { id: "chicken", name: "Chicken", price: 0 },
          { id: "beef", name: "Beef", price: 500 },
          { id: "fish", name: "Fish", price: 1_000 },
        ]},
        { id: "extras", name: "Add extras", minSelect: 0, maxSelect: 3, choices: [
          { id: "plantain", name: "Fried plantain", price: 700 },
          { id: "moimoi", name: "Moi moi", price: 800 },
          { id: "salad", name: "Coleslaw", price: 600 },
        ]},
      ],
    },
    { id: "stg-suya", restaurantId: "stg-trishas-kitchen", name: "Beef Suya", price: 2_500,
      category: "Grills", description: "Synthetic staging item." },
    { id: "stg-pepper", restaurantId: "stg-trishas-kitchen", name: "Goat Pepper Soup", price: 4_000,
      category: "Soups", description: "Synthetic staging item." },
    // Unavailable on purpose: the app must render a sold-out item, and a quote
    // containing it must be refused with ITEM_UNAVAILABLE.
    { id: "stg-soldout", restaurantId: "stg-trishas-kitchen", name: "Catfish Point & Kill",
      price: 9_000, category: "Grills", description: "Synthetic staging item.", available: false },
    // POS-only: exists on the menu, must NEVER reach the customer app.
    { id: "stg-staff-meal", restaurantId: "stg-trishas-kitchen", name: "Staff Meal",
      price: 500, category: "Internal", description: "Synthetic staging item.", channel: "pos_only" },

    { id: "stg-steam-rice", restaurantId: "stg-the-steam-menu", name: "Steamed Rice Bowl",
      price: 5_500, category: "Bowls", description: "Synthetic staging item." },
    { id: "stg-steam-dumpling", restaurantId: "stg-the-steam-menu", name: "Dumpling Basket",
      price: 6_500, category: "Small chops", description: "Synthetic staging item." },

    // Belongs to the never-opted-in restaurant. Must not be reachable through
    // any customer route.
    { id: "stg-hidden-item", restaurantId: "stg-internal-only", name: "Should Never Appear",
      price: 1_000, category: "Control", description: "Synthetic staging item." },
  ];

  for (const it of MENU) {
    await db.collection("menu_items").doc(it.id).set({
      restaurantId: it.restaurantId,
      name: it.name, price: it.price, category: it.category,
      description: it.description,
      image: DISH_IMAGES[it.id] ?? "",
      available: it.available !== false,
      isStagingSynthetic: true,
      marketplace: {
        channel: it.channel ?? "both",
        available: null,
        priceOverride: null,
        options: it.options ?? [],
      },
    }, { merge: true });
  }

  // ── A synthetic customer, with somewhere to deliver to ─────────────────────
  //
  // The Firebase Auth user is created separately (see docs/MARKETPLACE_STAGING.md)
  // because Auth users cannot be created without hitting the Auth API; this
  // writes only the Firestore profile. The uid below must match the Auth uid.

  const CUSTOMER_UID = process.env.STAGING_CUSTOMER_UID ?? "staging-customer-1";
  await db.collection("customers").doc(CUSTOMER_UID).set({
    name: "Staging Customer",
    email: "staging.customer@example.invalid",   // .invalid can never resolve
    phone: "+2348111111111",
    photoUrl: null,
    notificationPrefs: { orderUpdates: true, promotions: false },
    status: "active",
    isStagingSynthetic: true,
    createdAt: FieldValue.serverTimestamp(),
    createdAtMs: Date.now(),
  }, { merge: true });

  const ADDRESSES = [
    { id: "addr-home", label: "home", line1: "22 Synthetic Road, Lekki Phase 1, Lagos",
      instructions: "Blue gate, ring once.", lat: 6.4413, lng: 3.4712, isDefault: true },
    // Far from both restaurants, so OUT_OF_RANGE is one address-switch away.
    { id: "addr-far", label: "work", line1: "1 Faraway Street, Epe, Lagos",
      instructions: "", lat: 6.5833, lng: 3.9833, isDefault: false },
  ];
  for (const a of ADDRESSES) {
    await db.collection("customers").doc(CUSTOMER_UID).collection("addresses").doc(a.id).set({
      label: a.label, line1: a.line1, instructions: a.instructions,
      location: { lat: a.lat, lng: a.lng },
      isDefault: a.isDefault,
      isStagingSynthetic: true,
    }, { merge: true });
  }

  // A SECOND customer. Isolation is not proven by one account: the staging
  // check that matters is signing in as this one and failing to read the
  // first one's orders and addresses.
  const OTHER_UID = process.env.STAGING_OTHER_CUSTOMER_UID ?? "staging-customer-2";
  await db.collection("customers").doc(OTHER_UID).set({
    name: "Staging Other Customer",
    email: "staging.other@example.invalid",
    phone: "+2348222222222",
    photoUrl: null,
    notificationPrefs: { orderUpdates: true, promotions: false },
    status: "active",
    isStagingSynthetic: true,
    createdAt: FieldValue.serverTimestamp(),
    createdAtMs: Date.now(),
  }, { merge: true });
  await db.collection("customers").doc(OTHER_UID).collection("addresses").doc("addr-home").set({
    label: "home", line1: "9 Other Person Street, Victoria Island, Lagos",
    instructions: "", location: { lat: 6.4281, lng: 3.4219 },
    isDefault: true, isStagingSynthetic: true,
  }, { merge: true });

  const listed = RESTAURANTS.filter((r) => r.marketplace).length;
  console.log(`Seeded synthetic marketplace data into "${projectId}":`);
  console.log(`  restaurants: ${RESTAURANTS.length} (${listed} on the marketplace, ${RESTAURANTS.length - listed} deliberately not)`);
  console.log(`  menu_items:  ${MENU.length} (1 pos_only, 1 unavailable, 1 on a non-marketplace restaurant)`);
  console.log(`  customers:   2 (${CUSTOMER_UID}, ${OTHER_UID}) with ${ADDRESSES.length + 1} addresses`);
  console.log("");
  console.log("  Auth users are NOT created by this script — see docs/MARKETPLACE_STAGING.md.");
  console.log("  If the Auth uids differ from the ids above, set STAGING_CUSTOMER_UID /");
  console.log("  STAGING_OTHER_CUSTOMER_UID and re-run, or the app will create empty profiles.");
  console.log("");
  console.log("No production data was read or written.");
}

main().catch((err) => { console.error(err.message ?? err); process.exit(1); });
