import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.staging" });
(async () => {
  const { initializeApp, cert } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const db = getFirestore(initializeApp({ credential: cert({
    projectId: process.env.FIREBASE_ADMIN_PROJECT_ID!,
    clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL!,
    privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY!.replace(/\\n/g, "\n"),
  })}));
  const s = await db.collection("connect_deliveries").orderBy("createdAtMs", "desc").limit(8).get();
  for (const doc of s.docs) {
    const d = doc.data() as any;
    const led = await db.collection("connect_ledger_entries").where("deliveryId", "==", doc.id).get();
    const bal = led.docs.reduce((a, x) => a + (x.data() as any).amountMinor, 0);
    console.log(`${doc.id}`);
    console.log(`   state=${d.state} payer=${d.payer ?? "-"} paidAt=${d.payment?.paidAtMs ?? "-"}`);
    console.log(`   amount=${d.payment?.amountMinor ?? "-"} cost=${d.payment?.dispatcherCostMinor ?? "-"} margin=${d.payment?.marginMinor ?? "-"}`);
    console.log(`   jobId=${d.delivery?.deliveryJobId ?? "NONE"} ledger=${led.size} entries balance=${bal}`);
    console.log("");
  }
  process.exit(0);
})();
