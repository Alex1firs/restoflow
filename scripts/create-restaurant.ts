/**
 * Creates or updates a restaurant with the full subscription model.
 * Safe to run on existing restaurants — merges only the fields it sets.
 *
 * Usage:
 *   npx tsx scripts/create-restaurant.ts <name> <slug> <ownerEmail> <planId> <trialDays>
 *
 * Example:
 *   npx tsx scripts/create-restaurant.ts "Grills Capitol" grills-capitol corrosivedon@gmail.com starter 30
 *
 * planId must be one of: starter | growth | premium
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";

const [name, slug, ownerEmail, planId, trialDaysStr] = process.argv.slice(2);

if (!name || !slug || !ownerEmail || !planId || !trialDaysStr) {
  console.error(
    "Usage: npx tsx scripts/create-restaurant.ts <name> <slug> <ownerEmail> <planId> <trialDays>"
  );
  process.exit(1);
}

const trialDays = parseInt(trialDaysStr, 10);
if (isNaN(trialDays) || trialDays < 1) {
  console.error("trialDays must be a positive integer");
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
  // 1. Verify plan exists
  const planDoc = await db.collection("plans").doc(planId).get();
  if (!planDoc.exists) {
    console.error(`Plan "${planId}" not found. Run seed-plans.ts first.`);
    process.exit(1);
  }
  const planName = planDoc.data()!.name as string;

  // 2. Look up owner by email
  let ownerUid: string;
  try {
    const user = await auth.getUserByEmail(ownerEmail);
    ownerUid = user.uid;
    console.log(`✓ Found owner: ${ownerEmail} (${ownerUid})`);
  } catch {
    console.error(`No Firebase Auth user found for email: ${ownerEmail}`);
    console.error("Create the user first with: npx tsx scripts/create-admin.ts");
    process.exit(1);
  }

  // 3. Calculate subscription dates
  const now = new Date();
  const endDate = new Date(now.getTime() + trialDays * 86_400_000);

  // 4. Upsert restaurant document
  const restaurantRef = db.collection("restaurants").doc(slug);
  const existing = await restaurantRef.get();

  const restaurantData = {
    name,
    slug,
    ownerUid,
    planId,
    subscriptionStatus: "trialing" as const,
    subscriptionStartDate: Timestamp.fromDate(now),
    subscriptionEndDate: Timestamp.fromDate(endDate),
    // Only set createdAt on first creation
    ...(existing.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
  };

  await restaurantRef.set(restaurantData, { merge: true });
  console.log(`✓ Restaurant "${name}" (${slug}) saved`);

  // 5. Ensure users/{uid} document is linked
  await db.collection("users").doc(ownerUid).set({ restaurantSlug: slug }, { merge: true });
  console.log(`✓ users/${ownerUid} linked to ${slug}`);

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Restaurant : ${name}
  Slug       : ${slug}
  Plan       : ${planName}
  Status     : trialing
  Trial ends : ${endDate.toDateString()} (${trialDays} days)
  Owner      : ${ownerEmail}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
  process.exit(0);
}

run().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
