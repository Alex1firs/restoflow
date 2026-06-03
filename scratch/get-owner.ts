import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const app = initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
    clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  }),
});

const db = getFirestore(app);

async function run() {
  const restSnap = await db.collection("restaurants").get();
  console.log(`Restaurants count: ${restSnap.docs.length}`);
  for (const doc of restSnap.docs) {
    console.log(`- Restaurant Doc ID (slug): ${doc.id}, Name: ${doc.data().name}`);
  }

  const usersSnap = await db.collection("users").get();
  console.log(`Users count: ${usersSnap.docs.length}`);
  for (const doc of usersSnap.docs) {
    console.log(`- User ID: ${doc.id}, Data:`, doc.data());
  }
  process.exit(0);
}

run();
