import { getAdminDb } from "@/lib/firebase-admin";
import OnboardingClient from "./OnboardingClient";

export const revalidate = 0;

function fmtDate(ts: { toDate?: () => Date; seconds?: number } | null | undefined) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date((ts.seconds ?? 0) * 1000);
  return d.toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
}

export default async function SuperAdminOnboardingPage() {
  const snap = await getAdminDb().collection("onboardings").orderBy("createdAt", "desc").limit(100).get();

  const onboardings = snap.docs.map((doc) => {
    const d = doc.data();
    return {
      id: doc.id,
      restaurantName: (d.restaurantName as string) ?? "—",
      slug: (d.slug as string) ?? "—",
      email: (d.email as string) ?? "—",
      phone: (d.phone as string) ?? "—",
      planId: (d.planId as string) ?? "—",
      status: (d.status as string) ?? "pending",
      paystackReference: (d.paystackReference as string) ?? null,
      ownerUid: (d.ownerUid as string) ?? null,
      resetLink: (d.resetLink as string) ?? null,
      createdAt: fmtDate(d.createdAt as Parameters<typeof fmtDate>[0]),
    };
  });

  return <OnboardingClient onboardings={onboardings} />;
}
