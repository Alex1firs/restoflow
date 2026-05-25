import "server-only";
import { getAdminDb } from "./firebase-admin";

/**
 * Fixed-window Firestore-backed rate limiter — stateless-safe on Vercel serverless.
 *
 * Enable TTL on the `rate_limits` collection in Firebase Console (field: `expiresAt`)
 * so stale documents are automatically deleted. See DEPLOYMENT.md.
 *
 * @param identifier  Unique key — use IP for public routes, UID for authenticated routes.
 * @param limit       Max allowed requests per window.
 * @param windowMs    Window duration in milliseconds.
 * @returns `allowed: false` when the caller has exceeded the limit.
 */
export async function checkRateLimit(
  identifier: string,
  limit: number,
  windowMs: number
): Promise<{ allowed: boolean }> {
  const db = getAdminDb();
  const windowStart = Math.floor(Date.now() / windowMs) * windowMs;
  const docId = `${identifier}:${windowStart}`;
  const ref = db.collection("rate_limits").doc(docId);

  let allowed = false;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const count = snap.exists ? (snap.data()!.count as number) : 0;
    if (count < limit) {
      allowed = true;
      tx.set(
        ref,
        { count: count + 1, expiresAt: new Date(windowStart + windowMs * 2) },
        { merge: true }
      );
    }
  });

  return { allowed };
}

/** Extract the best available IP from a Next.js Request. */
export function getClientIp(req: { headers: { get(name: string): string | null } }): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}
