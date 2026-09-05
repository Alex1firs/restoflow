import { config } from "dotenv"; import { writeFileSync } from "fs";
config({ path: ".env.staging" });
const who = process.argv[3] === "staff"
  ? { email: "staging.owner@example.invalid", password: "StagingOwner!2026" }
  : { email: "staging.customer@example.invalid", password: "StagingCustomer!2026" };
(async () => {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${process.env.NEXT_PUBLIC_FIREBASE_API_KEY}`,
    { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...who, returnSecureToken: true }) });
  const j = await r.json() as { idToken?: string; error?: { message: string } };
  if (!j.idToken) { console.error("AUTH FAILED", j.error?.message); process.exit(1); }
  writeFileSync(process.argv[2], j.idToken, { mode: 0o600 });
})().catch(e => { console.error(e.message); process.exit(1); });
