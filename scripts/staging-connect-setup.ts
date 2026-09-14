/**
 * Stand up the Connect QA rig on staging.
 *
 * Creates a synthetic admin for `stg-internal-only` — the restaurant that is
 * deliberately NOT on the marketplace — and activates Connect on it with a
 * clearly labelled 10% TEST margin. That pairing is the point: it proves a
 * Connect partner needs no marketplace listing, and gives a second tenant so
 * isolation can be tested between two real accounts rather than asserted.
 *
 * Refuses to run against anything but restoflow-staging.
 *
 *   npx tsx scripts/staging-connect-setup.ts
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: process.env.ENV_FILE ?? ".env.staging" });
import { randomBytes } from "node:crypto";

const ALLOWED = ["restoflow-staging"];
const CONNECT_SLUG = "stg-internal-only";
const CONNECT_EMAIL = "staging.connect@example.invalid";
/** 10%, and flagged as a test value so production activation refuses it. */
const TEST_MARGIN_BPS = 1000;

async function main() {
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID ?? "";
  if (!ALLOWED.includes(projectId)) throw new Error(`REFUSING: "${projectId}" is not restoflow-staging.`);

  const { initializeApp, cert } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const { getAuth } = await import("firebase-admin/auth");
  const app = initializeApp({
    credential: cert({
      projectId,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL!,
      privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY!.replace(/\\n/g, "\n"),
    }),
  });
  const db = getFirestore(app);
  const auth = getAuth(app);

  const rSnap = await db.collection("restaurants").doc(CONNECT_SLUG).get();
  if (!rSnap.exists) throw new Error(`${CONNECT_SLUG} not found`);
  if (rSnap.data()?.marketplace?.marketplaceEnabled === true) {
    throw new Error(`${CONNECT_SLUG} is marketplace-enabled; pick a non-marketplace tenant`);
  }

  // The synthetic admin.
  let uid: string;
  const password = process.env.STAGING_CONNECT_PASSWORD ?? randomBytes(12).toString("base64url");
  try {
    uid = (await auth.getUserByEmail(CONNECT_EMAIL)).uid;
    await auth.updateUser(uid, { password });
    console.log("  reused the existing synthetic Connect admin");
  } catch {
    uid = (await auth.createUser({ email: CONNECT_EMAIL, password, emailVerified: true })).uid;
    console.log("  created the synthetic Connect admin");
  }
  await db.collection("users").doc(uid).set(
    { email: CONNECT_EMAIL, restaurantSlug: CONNECT_SLUG, role: "owner", disabled: false, synthetic: true },
    { merge: true }
  );

  await db.collection("restaurants").doc(CONNECT_SLUG).update({
    "connect.state": "active",
    "connect.marginBps": TEST_MARGIN_BPS,
    "connect.billingMode": "prepaid",
    "connect.marginIsTest": true,
    "connect.approvedAt": Date.now(),
    "connect.approvedBy": "staging-setup-script",
  });

  console.log(`  ${CONNECT_SLUG}: Connect ACTIVE, margin ${TEST_MARGIN_BPS} bps (10%), flagged as a TEST value`);
  console.log(`  admin uid: ${uid}`);
  if (!process.env.STAGING_CONNECT_PASSWORD) {
    // Printed once so it can be put in the ignored staging env, never committed.
    console.log(`  STAGING_CONNECT_PASSWORD=${password}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });
