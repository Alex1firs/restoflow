import { config } from "dotenv";
config({ path: ".env.staging" });
import { cert, initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID!;
if (projectId !== "restoflow-staging") { console.error("REFUSING"); process.exit(1); }
if (!getApps().length) initializeApp({ credential: cert({ projectId,
  clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL!,
  privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY!.replace(/\\n/g, "\n") })});
const db = getFirestore();
const ref = process.argv[2];
(async () => {
  const pays = await db.collection("marketplace_payments").where("reference","==",ref).get();
  console.log(`payments        : ${pays.size}`);
  pays.forEach(p => console.log(`   state=${p.data().state} orderId=${p.data().orderId}`));
  const orders = await db.collection("orders").where("payment.reference","==",ref).get();
  console.log(`orders for ref  : ${orders.size}`);
  for (const d of orders.docs) {
    const o = d.data();
    console.log(`  orderId        : ${d.id}`);
    console.log(`  code           : ${o.marketplaceOrderCode}`);
    console.log(`  restaurantName : ${JSON.stringify(o.restaurantName ?? null)}`);
    console.log(`  restaurantState: ${o.fulfillment?.restaurantState}`);
    console.log(`  history        : ${JSON.stringify((o.fulfillment?.history ?? []).map((h:{state:string})=>h.state))}`);
    console.log(`  DELIVERY JOB   : ${o.delivery?.deliveryJobId ?? "NONE"}  state=${o.delivery?.state ?? "-"} seq=${o.delivery?.sequence ?? "-"}`);
    console.log(`  handoffPending : ${o.deliveryHandoffPending ?? "-"}`);
    console.log(`  items          : ${o.items.map((x:{name:string;quantity:number;options?:{name:string}[]})=>`${x.quantity}x ${x.name}${x.options?.length?" ("+x.options.map(o=>o.name).join(", ")+")":""}`).join(", ")}`);
    console.log(`  food/total     : ${o.pricing?.customerSubtotalMinor} / ${o.pricing?.totalChargedMinor}`);
    const led = await db.collection("marketplace_ledger_entries").where("orderId","==",d.id).get();
    let sum = 0; led.forEach(l => sum += Number(l.data().amountMinor ?? 0));
    console.log(`  ledger         : ${led.size} entries, sum ${sum}`);
    const out = await db.collection("marketplace_notification_outbox").where("orderId","==",d.id).get();
    console.log(`  outbox events  : ${out.size} [${out.docs.map(x=>x.data().event).sort().join(", ")}]`);
  }
  const intent = await db.collection("marketplace_payment_intents").doc(ref).get();
  console.log(`intent open     : ${intent.exists}`);
  const all = await db.collection("orders").where("orderSource","==","marketplace").get();
  console.log(`TOTAL orders    : ${all.size}`);
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
