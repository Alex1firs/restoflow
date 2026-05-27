/**
 * Seeds the three subscription plans into Firestore.
 * Safe to run multiple times — uses set() which overwrites.
 *
 * Usage:
 *   npx tsx scripts/seed-plans.ts
 */

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

const plans = [
  {
    id: "pro",
    name: "Restaflow Pro",
    monthlyPrice: 19999,
    setupFee: 0,
    features: [
      "QR ordering & digital menu",
      "Unlimited orders",
      "Live kitchen dashboard",
      "POS & counter orders",
      "Table service & open dine-in tabs",
      "Direct Paystack payments",
      "Telegram order notifications",
      "Reports & analytics",
      "Custom restaurant branding",
      "Priority support",
    ],
    isActive: true,
  },
];

async function run() {
  const batch = db.batch();

  for (const { id, ...data } of plans) {
    const ref = db.collection("plans").doc(id);
    batch.set(ref, data);
    console.log(`  Queued: plans/${id} — ₦${data.monthlyPrice.toLocaleString()}/mo`);
  }

  await batch.commit();
  console.log("\n✓ Plans seeded successfully");
  process.exit(0);
}

run().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
