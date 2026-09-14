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
  const key = process.env.PAYSTACK_TEST_SECRET_KEY || process.env.PAYSTACK_SECRET_KEY || "";
  console.log("  key prefix:", key.slice(0, 8) || "(none locally)");
  for (const id of ["cn_8c7343116711040c5d", "cn_8767affb41085a20f5"]) {
    const d = (await db.collection("connect_deliveries").doc(id).get()).data() as any;
    const ref = d.payment?.reference;
    if (!key) { console.log(`  ${id}: ref=${ref} (no local key to query Paystack)`); continue; }
    const r = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(ref)}`, {
      headers: { Authorization: `Bearer ${key}` } });
    const j: any = await r.json();
    console.log(`  ${id}`);
    console.log(`     ref=${ref}`);
    console.log(`     paystack: http=${r.status} status=${j?.data?.status ?? j?.message} amount=${j?.data?.amount ?? "-"}`);
  }
  process.exit(0);
})();
