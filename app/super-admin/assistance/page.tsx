import { getAdminDb } from "@/lib/firebase-admin";
import AssistanceClient from "./AssistanceClient";

export const revalidate = 0;

type FirestoreTs = { toDate?: () => Date; seconds?: number } | null | undefined;

function fmtIso(ts: FirestoreTs): string | null {
  if (!ts) return null;
  const d = ts.toDate ? ts.toDate() : new Date((ts.seconds ?? 0) * 1000);
  return d.toISOString();
}

export default async function SuperAdminAssistancePage() {
  const db = getAdminDb();

  const snap = await db
    .collection("restaurants")
    .where("assistanceStatus", "in", ["open", "resolved"])
    .get();

  const requests = snap.docs.map((doc) => {
    const d = doc.data();
    return {
      slug: doc.id,
      name: (d.name as string) ?? doc.id,
      email: (d.email as string) || null,
      phone: (d.phone as string) || null,
      notificationPhone: (d.notificationPhone as string) || null,
      setupScore: typeof d.setupScore === "number" ? d.setupScore : null,
      assistanceStatus: (d.assistanceStatus as string) ?? "open",
      assistanceRequestedAt: fmtIso(d.assistanceRequestedAt as FirestoreTs),
      assistanceResolvedAt: fmtIso(d.assistanceResolvedAt as FirestoreTs),
      restaurantStatus: (d.status as string) ?? "draft",
      notes: (d.notes as string) || null,
    };
  });

  requests.sort((a, b) => {
    if (!a.assistanceRequestedAt) return 1;
    if (!b.assistanceRequestedAt) return -1;
    return b.assistanceRequestedAt.localeCompare(a.assistanceRequestedAt);
  });

  return <AssistanceClient requests={requests} />;
}
