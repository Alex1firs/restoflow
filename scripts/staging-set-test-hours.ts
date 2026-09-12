/**
 * Give the synthetic staging restaurants explicit opening hours.
 *
 * Marketplace discovery now treats absent opening hours as UNKNOWN rather than
 * open, which is correct — but it leaves the synthetic staging restaurants with
 * no opening state at all, and QA cannot exercise open/closed behaviour against
 * a permanent "unknown".
 *
 * These are TEST hours, deliberately wide, so a QA run at any hour of the day
 * finds the restaurant open. They are not a guess at real trading hours for a
 * real business — no such restaurant exists here.
 *
 * Refuses to run against anything but restoflow-staging, and refuses to touch a
 * restaurant that is not one of the named synthetic fixtures.
 *
 *   npx tsx scripts/staging-set-test-hours.ts
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: process.env.ENV_FILE ?? ".env.staging" });

const ALLOWED = ["restoflow-staging"];
const SYNTHETIC = ["stg-trishas-kitchen", "stg-the-steam-menu"];

/** Open all day, every day. A staging fixture, not a trading pattern. */
const TEST_HOURS = Object.fromEntries(
  ["0", "1", "2", "3", "4", "5", "6"].map((d) => [d, { open: true, from: "00:00", to: "23:59" }])
);

async function main() {
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID ?? "";
  if (!ALLOWED.includes(projectId)) {
    throw new Error(`REFUSING: "${projectId}" is not restoflow-staging.`);
  }

  const { initializeApp, cert } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const db = getFirestore(initializeApp({
    credential: cert({
      projectId,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL!,
      privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY!.replace(/\\n/g, "\n"),
    }),
  }));

  for (const slug of SYNTHETIC) {
    const ref = db.collection("restaurants").doc(slug);
    const snap = await ref.get();
    if (!snap.exists) {
      console.log(`skip ${slug}: not found`);
      continue;
    }
    const before = snap.data()?.openingHours ?? null;
    await ref.update({ openingHours: TEST_HOURS });
    console.log(`${slug}: openingHours ${before ? "replaced" : "set"} (staging test hours, 00:00–23:59 daily)`);
  }
  console.log("\nDone. These are staging test hours; production is untouched.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });
