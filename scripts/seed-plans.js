// Plain JS — run with: node scripts/seed-plans.js
require("dotenv").config({ path: ".env.local" });

const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const app = initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
    clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  }),
});

const db = getFirestore(app);

async function run() {
  const ref = db.collection("plans").doc("pro");
  await ref.set({
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
  });
  console.log("Done: plans/pro seeded");
  process.exit(0);
}

run().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
