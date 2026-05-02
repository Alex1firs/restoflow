/**
 * Creates a restaurant owner account in Firebase Auth and links it to a
 * restaurant in Firestore.
 *
 * Usage:
 *   npx tsx scripts/create-admin.ts <email> <password> <restaurant-slug>
 *
 * Example:
 *   npx tsx scripts/create-admin.ts owner@grillscapitol.com MyPassword123 grills-capitol
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const [email, password, slug] = process.argv.slice(2);

if (!email || !password || !slug) {
  console.error("Usage: npx tsx scripts/create-admin.ts <email> <password> <restaurant-slug>");
  process.exit(1);
}

const app = initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
    clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  }),
});

const auth = getAuth(app);
const db = getFirestore(app);

async function run() {
  // Check the restaurant exists before creating the user
  const restaurantSnap = await db.collection("restaurants").doc(slug).get();
  if (!restaurantSnap.exists) {
    console.error(`Restaurant "${slug}" not found in Firestore. Check the slug and try again.`);
    process.exit(1);
  }

  // Create the Firebase Auth user
  const user = await auth.createUser({ email, password });
  console.log(`✓ Auth user created: ${user.uid}`);

  // Link the user to their restaurant
  await db.collection("users").doc(user.uid).set({ restaurantSlug: slug });
  console.log(`✓ Linked to restaurant: ${slug}`);

  console.log(`\nDone. ${email} can now log in at /admin/login`);
  process.exit(0);
}

run().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
