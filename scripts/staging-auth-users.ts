/**
 * Create the two synthetic staging customers in Firebase Auth.
 *
 * Two, not one. Customer isolation is the property this whole environment
 * exists to prove, and a single account cannot demonstrate it: the assertion
 * that matters is signing in as one and FAILING to read the other's orders.
 *
 * Idempotent — re-running returns the existing uids rather than erroring, so
 * this is safe to run after a partial failure.
 *
 *   npx tsx scripts/staging-auth-users.ts
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.staging" });

const ALLOWED = ["restoflow-staging", "demo-rest"];
const DENIED = ["restaurant-saas-64235", "pack-delivery-live", "pack-delivery"];

// `.invalid` is reserved by RFC 2606 and can never resolve, so these addresses
// cannot receive mail even if something tried to send to them.
const USERS = [
  { email: "staging.customer@example.invalid", password: "StagingCustomer!2026", name: "Staging Customer" },
  { email: "staging.other@example.invalid",    password: "StagingOther!2026",    name: "Staging Other Customer" },
];

async function main() {
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID ?? "";
  if (DENIED.includes(projectId)) throw new Error(`REFUSING: "${projectId}" is a production project.`);
  if (!ALLOWED.includes(projectId)) throw new Error(`REFUSING: "${projectId}" is not a known staging project.`);

  const { initializeApp, cert } = await import("firebase-admin/app");
  const { getAuth } = await import("firebase-admin/auth");

  const app = initializeApp({
    credential: cert({
      projectId,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
  const auth = getAuth(app);

  const uids: string[] = [];
  for (const u of USERS) {
    let uid: string;
    try {
      const existing = await auth.getUserByEmail(u.email);
      uid = existing.uid;
      console.log(`  = ${u.email} already exists`);
    } catch {
      const created = await auth.createUser({
        email: u.email, password: u.password, displayName: u.name, emailVerified: true,
      });
      uid = created.uid;
      console.log(`  + ${u.email} created`);
    }
    uids.push(uid);
  }

  console.log("");
  console.log(`STAGING_CUSTOMER_UID=${uids[0]}`);
  console.log(`STAGING_OTHER_CUSTOMER_UID=${uids[1]}`);
}

main().catch((err) => { console.error(err.message ?? err); process.exit(1); });
