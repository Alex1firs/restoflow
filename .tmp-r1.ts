import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.staging" });
const ID = "cn_17d543d531142d306e";
(async () => {
  const { initializeApp, cert } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const db = getFirestore(initializeApp({ credential: cert({
    projectId: process.env.FIREBASE_ADMIN_PROJECT_ID!,
    clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL!,
    privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY!.replace(/\\n/g, "\n"),
  })}));
  const d = (await db.collection("connect_deliveries").doc(ID).get()).data() as any;
  const led = await db.collection("connect_ledger_entries").where("deliveryId", "==", ID).get();
  const bal = led.docs.reduce((a, x) => a + (x.data() as any).amountMinor, 0);
  console.log(`  state      : ${d.state}`);
  console.log(`  paid       : ${!!d.payment?.paidAtMs}  ref=${d.payment?.reference}`);
  console.log(`  jobId      : ${d.delivery?.deliveryJobId ?? "NONE"}`);
  console.log(`  ledger     : ${led.size} entries, balance ${bal}`);
  console.log(`  refund     : ${d.refund ? JSON.stringify(d.refund) : "none yet"}`);
  process.exit(0);
})();
