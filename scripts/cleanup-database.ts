import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const app = initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
    clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  }),
});

const auth = getAuth(app);
const db = getFirestore(app);

const RETAINED_RESTAURANTS = ["tricias-kitchen", "grills-capitol"];

async function run() {
  console.log("=== STARTING DATABASE CLEANUP ===");

  // 1. Clean up restaurants
  const restaurantSnap = await db.collection("restaurants").get();
  for (const doc of restaurantSnap.docs) {
    if (!RETAINED_RESTAURANTS.includes(doc.id)) {
      console.log(`Deleting restaurant: ${doc.id}`);
      await doc.ref.delete();
    }
  }

  // 2. Clean up menu_items
  const menuSnap = await db.collection("menu_items").get();
  for (const doc of menuSnap.docs) {
    const rId = doc.data().restaurantId;
    if (!RETAINED_RESTAURANTS.includes(rId)) {
      console.log(`Deleting menu_item: ${doc.id} (restaurant: ${rId})`);
      await doc.ref.delete();
    }
  }

  // 3. Clean up prepared_items
  const prepSnap = await db.collection("prepared_items").get();
  for (const doc of prepSnap.docs) {
    const rId = doc.data().restaurantId;
    if (!RETAINED_RESTAURANTS.includes(rId)) {
      console.log(`Deleting prepared_item: ${doc.id} (restaurant: ${rId})`);
      await doc.ref.delete();
    }
  }

  // 4. Clean up waiters
  const waiterSnap = await db.collection("waiters").get();
  for (const doc of waiterSnap.docs) {
    const rId = doc.data().restaurantId;
    if (!RETAINED_RESTAURANTS.includes(rId)) {
      console.log(`Deleting waiter: ${doc.id} (restaurant: ${rId})`);
      await doc.ref.delete();
    }
  }

  // 5. Clean up orders
  const orderSnap = await db.collection("orders").get();
  for (const doc of orderSnap.docs) {
    const rId = doc.data().restaurantId;
    if (!RETAINED_RESTAURANTS.includes(rId)) {
      console.log(`Deleting order: ${doc.id} (restaurant: ${rId})`);
      await doc.ref.delete();
    }
  }

  // 6. Clean up payments
  const paymentSnap = await db.collection("payments").get();
  for (const doc of paymentSnap.docs) {
    const rId = doc.data().restaurantId;
    if (!RETAINED_RESTAURANTS.includes(rId)) {
      console.log(`Deleting payment: ${doc.id} (restaurant: ${rId})`);
      await doc.ref.delete();
    }
  }

  // 7. Clean up onboardings
  const onboardingSnap = await db.collection("onboardings").get();
  for (const doc of onboardingSnap.docs) {
    const slug = doc.data().slug;
    if (!RETAINED_RESTAURANTS.includes(slug)) {
      console.log(`Deleting onboarding: ${doc.id} (restaurant: ${slug})`);
      await doc.ref.delete();
    }
  }

  // 8. Clean up users & Firebase Auth
  const userSnap = await db.collection("users").get();
  for (const doc of userSnap.docs) {
    const d = doc.data();
    const isSuperAdmin = d.role === "super_admin";
    const rSlug = d.restaurantSlug;

    if (!isSuperAdmin && !RETAINED_RESTAURANTS.includes(rSlug)) {
      const uid = doc.id;
      console.log(`Deleting user from Firestore & Auth: ${uid} (email: ${d.email}, restaurant: ${rSlug})`);
      
      // Delete from Firebase Auth
      try {
        await auth.deleteUser(uid);
        console.log(`  ✓ Auth user deleted: ${uid}`);
      } catch (err: any) {
        console.error(`  ✗ Failed to delete Auth user ${uid}:`, err.message);
      }

      // Delete Firestore document
      await doc.ref.delete();
      console.log(`  ✓ Firestore document deleted: ${uid}`);
    }
  }

  console.log("=== CLEANUP COMPLETE ===");
  process.exit(0);
}

run().catch((err) => {
  console.error("Cleanup failed:", err);
  process.exit(1);
});
