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
    id: "starter",
    name: "Starter",
    monthlyPrice: 15000,
    setupFee: 50000,
    features: [
      "Up to 30 menu items",
      "Real-time order dashboard",
      "QR code menu",
      "Basic order management",
      "Email support",
    ],
    isActive: true,
  },
  {
    id: "growth",
    name: "Growth",
    monthlyPrice: 25000,
    setupFee: 75000,
    features: [
      "Unlimited menu items",
      "Real-time order dashboard",
      "QR code menu",
      "Advanced order management",
      "Multiple categories",
      "Priority support",
    ],
    isActive: true,
  },
  {
    id: "premium",
    name: "Premium",
    monthlyPrice: 40000,
    setupFee: 100000,
    features: [
      "Unlimited menu items",
      "Real-time order dashboard",
      "QR code menu",
      "Advanced order management",
      "Multiple categories",
      "Analytics dashboard",
      "Dedicated account manager",
      "24/7 priority support",
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
