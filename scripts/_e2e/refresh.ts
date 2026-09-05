import { config } from "dotenv";
config({ path: ".env.staging" });
const key = process.env.NEXT_PUBLIC_FIREBASE_API_KEY!;
(async () => {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${key}`,
    { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "staging.customer@example.invalid", password: "StagingCustomer!2026", returnSecureToken: true }) });
  const j = await r.json() as { refreshToken?: string };
  if (!j.refreshToken) { console.error("no refresh token"); process.exit(1); }
  console.log("got refresh token from sign-in: yes");

  const t = await fetch(`https://securetoken.googleapis.com/v1/token?key=${key}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(j.refreshToken)}`,
  });
  const tj = await t.json() as { id_token?: string; error?: { message?: string } };
  console.log("refresh http:", t.status, "id_token present:", !!tj.id_token, tj.error?.message ?? "");
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
