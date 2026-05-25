import "server-only";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Required environment variable "${name}" is not configured. ` +
        `Add it to .env.local (development) or Vercel environment settings (production).`
    );
  }
  return value;
}

// Server-side environment variables with fail-fast validation.
// Each getter throws immediately if the variable is missing or empty,
// rather than letting undefined propagate silently into security-critical logic.
export const serverEnv = {
  get PAYSTACK_SECRET_KEY() { return requireEnv("PAYSTACK_SECRET_KEY"); },
  get FIREBASE_ADMIN_PROJECT_ID() { return requireEnv("FIREBASE_ADMIN_PROJECT_ID"); },
  get FIREBASE_ADMIN_CLIENT_EMAIL() { return requireEnv("FIREBASE_ADMIN_CLIENT_EMAIL"); },
  get FIREBASE_ADMIN_PRIVATE_KEY() { return requireEnv("FIREBASE_ADMIN_PRIVATE_KEY"); },
  get NEXT_PUBLIC_APP_URL() { return requireEnv("NEXT_PUBLIC_APP_URL"); },
  get NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET() { return requireEnv("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET"); },
  get NEXT_PUBLIC_SUPPORT_WHATSAPP() { return requireEnv("NEXT_PUBLIC_SUPPORT_WHATSAPP"); },
};
