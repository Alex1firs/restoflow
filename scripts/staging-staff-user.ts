/**
 * Create the synthetic staging restaurant staff account.
 *
 * Staging had no `users` document at all, which meant nobody could sign into
 * the POS for the staging restaurant — and therefore that restaurant
 * ACCEPTANCE, the transition that now requests a courier, could never be
 * exercised end to end. A restaurant needs a login; this is environment setup,
 * not test data.
 *
 * Idempotent: re-running returns the existing uid rather than erroring.
 *
 *   npx tsx scripts/staging-staff-user.ts
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.staging" });

const ALLOWED = ["restoflow-staging", "demo-rest"];
const DENIED = ["restaurant-saas-64235", "pack-delivery-live", "pack-delivery"];

const STAFF = {
  email: "staging.owner@example.invalid",
  password: "StagingOwner!2026",
  name: "Staging Kitchen Owner",
  restaurantSlug: "stg-trishas-kitchen",
  role: "owner",
};

async function main() {
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID ?? "";
  if (DENIED.includes(projectId)) throw new Error(`REFUSING: "${projectId}" is a production project.`);
  if (!ALLOWED.includes(projectId)) throw new Error(`REFUSING: "${projectId}" is not a known staging project.`);

  const { initializeApp, cert } = await import("firebase-admin/app");
  const { getAuth } = await import("firebase-admin/auth");
  const { getFirestore } = await import("firebase-admin/firestore");

  const app = initializeApp({
    credential: cert({
      projectId,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
  const auth = getAuth(app);
  const db = getFirestore(app);

  let uid: string;
  try {
    uid = (await auth.getUserByEmail(STAFF.email)).uid;
    console.log(`  = ${STAFF.email} already exists`);
  } catch {
    uid = (await auth.createUser({
      email: STAFF.email, password: STAFF.password,
      displayName: STAFF.name, emailVerified: true,
    })).uid;
    console.log(`  + ${STAFF.email} created`);
  }

  await db.collection("users").doc(uid).set({
    email: STAFF.email,
    name: STAFF.name,
    restaurantSlug: STAFF.restaurantSlug,
    role: STAFF.role,
    disabled: false,
  }, { merge: true });

  console.log(`  + users/${uid} → ${STAFF.restaurantSlug} (${STAFF.role})`);
  console.log(`\n  uid: ${uid}`);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
