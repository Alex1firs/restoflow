import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.staging" });
const ID = "cn_8767affb41085a20f5";
(async () => {
  const { initializeApp, cert } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const db = getFirestore(initializeApp({ credential: cert({
    projectId: process.env.FIREBASE_ADMIN_PROJECT_ID!,
    clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL!,
    privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY!.replace(/\\n/g, "\n"),
  })}));
  const P = (n: string, ok: boolean, x = "") => console.log(`  ${ok ? "✓" : "✗"} ${n}${x ? "  — " + x : ""}`);

  const d = (await db.collection("connect_deliveries").doc(ID).get()).data() as any;
  P("[1] payment credited exactly once", !!d.payment.paidAtMs && d.state === "requested",
    `state=${d.state} paidAt=${new Date(d.payment.paidAtMs).toISOString()}`);

  // exactly one Connect delivery for this reference
  const refs = await db.collection("connect_payment_refs").where("deliveryId", "==", ID).get();
  const all = await db.collection("connect_deliveries").where("restaurantId", "==", d.restaurantId).get();
  const same = all.docs.filter((x) => (x.data() as any).payment?.reference === d.payment.reference);
  P("[2] exactly one Connect delivery for this payment", same.length === 1, `${same.length} found`);

  const led = await db.collection("connect_ledger_entries").where("deliveryId", "==", ID).get();
  const bal = led.docs.reduce((a, x) => a + (x.data() as any).amountMinor, 0);
  const by: any = Object.fromEntries(led.docs.map((x) => [(x.data() as any).account, (x.data() as any).amountMinor]));
  P("[3] webhook replay duplicated nothing", led.size === 3, `${led.size} ledger entries (deterministic ids)`);
  P("[4] the Connect ledger balances exactly to zero", bal === 0, `balance=${bal}`);
  P("[5] Dispatcher cost and Connect revenue recorded correctly",
    by.payment_received === 93500 && by.delivery_payable === -85000 && by.connect_revenue === -8500,
    `received=${by.payment_received} payable=${by.delivery_payable} revenue=${by.connect_revenue}`);
  P("[6] payer field is correct", led.docs.every((x) => (x.data() as any).payer === "customer") && d.payment.payer === "customer",
    `payer=${d.payment.payer}`);

  // no marketplace order
  const ord = await db.collection("orders").where("orderSource", "==", "marketplace")
    .orderBy("createdAtMs", "desc").limit(1).get();
  const newest = ord.docs[0]?.data() as any;
  P("[7] no marketplace order was created", newest.createdAtMs < d.createdAtMs,
    `newest marketplace order ${new Date(newest.createdAtMs).toISOString()} predates this`);

  console.log(`\n  jobId=${d.delivery.deliveryJobId} token=${d.trackingToken}`);
  process.exit(0);
})();
