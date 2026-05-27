import * as fs from "fs";
import * as path from "path";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

// Parse .env.local manually
const envPath = path.resolve(process.cwd(), ".env.local");
const envLines = fs.readFileSync(envPath, "utf8").split("\n");
for (const line of envLines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx === -1) continue;
  const key = trimmed.slice(0, eqIdx).trim();
  const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
  if (val) process.env[key] = val;
}

const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID!;
const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL!;
const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY!.replace(/\\n/g, "\n");

if (!getApps().length) {
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
}

const db = getFirestore();

async function main() {
  const ref = db.collection("rate_limits").doc("ttl-setup-seed");
  await ref.set({
    count: 0,
    expiresAt: Timestamp.fromDate(new Date(Date.now() - 1000)), // already expired
  });
  console.log("Created rate_limits/__seed__ with expiresAt in the past.");
  console.log("Now go back to the TTL policy dialog — rate_limits will appear in the dropdown.");
  console.log("After setting the TTL policy, you can delete this doc from Firestore Console.");
}

main().catch(console.error);
