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
  const s = await db.collection("menu_items").get();
  for (const d of s.docs) {
    const x = d.data() as any;
    console.log(`${String(x.restaurantId).padEnd(22)} ${String(x.name).padEnd(26)} channel=${x?.marketplace?.channel ?? "(unset)"} available=${x.available} desc="${String(x.description ?? "").slice(0,40)}"`);
  }
  console.log("\n--- what the index holds ---");
  const dd = await db.collection("discovery_dishes").get();
  for (const d of dd.docs) {
    const x = d.data() as any;
    console.log(`${String(x.restaurantSlug).padEnd(22)} ${String(x.name).padEnd(26)} marketplaceVisible=${x.marketplaceVisible}`);
  }
  process.exit(0);
})();
