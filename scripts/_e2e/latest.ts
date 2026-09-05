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
(async () => {
  const snap = await db.collection("marketplace_payment_intents").orderBy("createdAt", "desc").limit(1).get();
  snap.forEach(d => {
    const i = d.data();
    console.log("reference     :", d.id);
    console.log("restaurantName:", JSON.stringify(i.restaurantName));
    console.log("total (kobo)  :", i.pricing?.totalChargedMinor);
    console.log("food  (kobo)  :", i.pricing?.customerSubtotalMinor);
    console.log("items         :", i.items.map((x:{name:string;quantity:number;options?:{name:string}[]}) =>
      `${x.quantity}x ${x.name}${x.options?.length ? " ("+x.options.map(o=>o.name).join(", ")+")" : ""}`).join(", "));
    console.log("created       :", new Date(i.createdAt).toISOString());
  });
  const orders = await db.collection("orders").where("orderSource","==","marketplace").get();
  console.log("orders before payment:", orders.size);
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
