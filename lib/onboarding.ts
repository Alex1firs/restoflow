import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb, getAdminAuth } from "./firebase-admin";
import { getPlan } from "./plans";
import { sendOnboardingEmail } from "./email";

export type OnboardingRecord = {
  restaurantName: string;
  slug: string;
  email: string;
  phone: string;
  address: string;
  planId: string;
  status: "pending" | "complete";
  paystackReference?: string;
  ownerUid?: string;
  resetLink?: string;
  createdAt: FirebaseFirestore.FieldValue;
};

export type OnboardingResult = {
  success: boolean;
  alreadyProcessed: boolean;
  slug: string;
  email: string;
};

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 40);
}

export async function generateUniqueSlug(restaurantName: string): Promise<string> {
  const base = toSlug(restaurantName);
  const db = getAdminDb();

  const first = await db.collection("restaurants").doc(base).get();
  if (!first.exists) return base;

  for (let i = 2; i <= 20; i++) {
    const candidate = `${base}-${i}`;
    const doc = await db.collection("restaurants").doc(candidate).get();
    if (!doc.exists) return candidate;
  }

  return `${base}-${Date.now()}`;
}

export async function processOnboarding(
  onboardingId: string,
  paystackReference: string
): Promise<OnboardingResult> {
  const db = getAdminDb();
  const auth = getAdminAuth();

  const onboardingRef = db.collection("onboardings").doc(onboardingId);
  const snap = await onboardingRef.get();

  if (!snap.exists) {
    throw new Error(`Onboarding record ${onboardingId} not found`);
  }

  const record = snap.data() as OnboardingRecord;

  // Idempotency — already fully processed
  if (record.status === "complete") {
    return {
      success: true,
      alreadyProcessed: true,
      slug: record.slug,
      email: record.email,
    };
  }

  const { restaurantName, slug, email, phone, address, planId } = record;

  // Validate the plan exists before doing any writes. Throws with a clear message
  // for unknown plan IDs rather than silently continuing with undefined plan data.
  getPlan(planId);

  const now = new Date();
  const trialEnd = new Date(now);
  trialEnd.setDate(trialEnd.getDate() + 7);

  // Create Firebase Auth user
  let uid: string;
  try {
    const existing = await auth.getUserByEmail(email);
    uid = existing.uid;
  } catch {
    const newUser = await auth.createUser({ email, displayName: restaurantName });
    uid = newUser.uid;
  }

  // Generate a password reset link so the owner can set their password.
  // Stored in the onboarding doc (Admin-SDK-only read) for retrieval by support.
  // Never returned in API responses — reset links are single-use credentials.
  const resetLink = await auth.generatePasswordResetLink(email);

  const batch = db.batch();

  // Create restaurant document
  batch.set(db.collection("restaurants").doc(slug), {
    name: restaurantName,
    slug,
    phone,
    address,
    planId,
    ownerUid: uid,
    subscriptionStatus: "trialing",
    subscriptionStartDate: now,
    subscriptionEndDate: trialEnd,   // used by getSubscriptionInfo
    trialStartedAt: now,
    trialEndsAt: trialEnd,
    coverImage: "",
    description: "",
    createdAt: FieldValue.serverTimestamp(),
  });

  // Create owner user document
  batch.set(db.collection("users").doc(uid), {
    role: "owner",
    restaurantSlug: slug,
    email,
    createdAt: FieldValue.serverTimestamp(),
  });

  // Update onboarding record
  batch.update(onboardingRef, {
    status: "complete",
    paystackReference,
    ownerUid: uid,
    resetLink,
    completedAt: FieldValue.serverTimestamp(),
  });

  await batch.commit();

  // Non-fatal — if email delivery fails the reset link is still in onboardings/{id}.resetLink
  sendOnboardingEmail(email, restaurantName, resetLink).catch(() => {
    console.error("[onboarding] email delivery failed");
  });

  return {
    success: true,
    alreadyProcessed: false,
    slug,
    email,
  };
}
