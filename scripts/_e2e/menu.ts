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
  const d = await db.collection("menu_items").doc("stg-jollof").get();
  const m = d.data();
  if (!m) { console.log("not found by id; querying"); process.exit(0); }
  console.log("price:", m.price);
  console.log("marketplace =", JSON.stringify(m.marketplace).slice(0, 700));
  for (const k of ["options","optionGroups","modifiers","addons"]) {
    if (m[k] !== undefined) console.log(k, "=", JSON.stringify(m[k]).slice(0, 500));
  }
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
