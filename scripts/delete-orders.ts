import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Initialize Firebase Admin SDK
const app = initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
    clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  }),
});

const db = getFirestore();

async function run() {
  const slug = process.argv[2];
  if (!slug) {
    console.error("Please provide a restaurant slug (e.g., tricias-kitchen).");
    process.exit(1);
  }

  console.log(`Searching for orders belonging to restaurant: "${slug}"...`);
  const snapshot = await db.collection("orders")
    .where("restaurantId", "==", slug)
    .get();

  if (snapshot.empty) {
    console.log(`No orders found for restaurant: "${slug}".`);
    process.exit(0);
  }

  console.log(`Found ${snapshot.size} orders. Deleting...`);
  
  // Use a batch write to delete all found documents atomically
  const batch = db.batch();
  snapshot.docs.forEach(doc => {
    batch.delete(doc.ref);
  });

  await batch.commit();
  console.log(`Successfully deleted all ${snapshot.size} orders for "${slug}"!`);
  process.exit(0);
}

run().catch(err => {
  console.error("Error executing script:", err);
  process.exit(1);
});
