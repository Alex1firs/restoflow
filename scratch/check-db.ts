import dotenv from "dotenv";
import path from "path";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

async function run() {
  try {
    const app = initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      }),
    });
    
    const db = getFirestore(app);
    console.log("Fetching all restaurants from Firestore...");
    const snap = await db.collection("restaurants").get();
    
    console.log(`Found ${snap.size} restaurants:`);
    snap.docs.forEach(doc => {
      const data = doc.data();
      console.log(`- Slug: ${doc.id}`);
      console.log(`  Name: ${data.name}`);
      console.log(`  hidePrices: ${data.hidePrices} (${typeof data.hidePrices})`);
      console.log(`  customDomain: ${data.customDomain}`);
      console.log(`  loyalty: ${JSON.stringify(data.loyalty)}`);
    });
  } catch (error) {
    console.error("Error querying Firestore:", error);
  }
}

run();
