import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.staging" });

(async () => {
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID!;
  if (projectId !== "restoflow-staging") throw new Error(`REFUSING: ${projectId}`);
  const { initializeApp, cert } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const app = initializeApp({ credential: cert({
    projectId,
    clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL!,
    privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY!.replace(/\\n/g, "\n"),
  })});
  const db = getFirestore(app);

  const snap = await db.collection("marketplace_notification_outbox")
    .orderBy("createdAt", "desc").limit(300).get();
  const byEvent = new Map<string, { total: number; states: Record<string, number>; aud: Set<string> }>();
  const ids = new Set<string>();
  for (const d of snap.docs) {
    const x = d.data() as any;
    ids.add(d.id);
    const k = x.event ?? "?";
    if (!byEvent.has(k)) byEvent.set(k, { total: 0, states: {}, aud: new Set() });
    const e = byEvent.get(k)!;
    e.total++;
    e.states[x.state ?? "?"] = (e.states[x.state ?? "?"] ?? 0) + 1;
    e.aud.add(x.audience ?? "?");
  }
  console.log(`entries inspected: ${snap.size}   distinct ids: ${ids.size}\n`);
  for (const [ev, e] of [...byEvent.entries()].sort())
    console.log(`  ${ev.padEnd(24)} n=${String(e.total).padEnd(4)} to=${[...e.aud].sort().join("+").padEnd(20)} ${JSON.stringify(e.states)}`);
  console.log(`\nnon-deterministic ids: ${[...ids].filter(i => i.split("__").length !== 3).length}`);
  process.exit(0);
})();
