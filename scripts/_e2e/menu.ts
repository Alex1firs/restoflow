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
  const snap = await db.collection("restaurants").doc("stg-trishas-kitchen").collection("menu_items").get();
  for (const d of snap.docs) {
    const m = d.data();
    if (d.id !== "stg-jollof") continue;
    console.log(`${d.id}: base price = ${m.price ?? m.priceMinor}`);
    console.log("options raw:", JSON.stringify(m.options, null, 1).slice(0, 600));
  }
  const r = (await db.collection("restaurants").doc("stg-trishas-kitchen").get()).data()!;
  console.log("marketplace pricing config:", JSON.stringify(r.marketplace?.pricing ?? r.marketplace ?? {}).slice(0, 400));
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
