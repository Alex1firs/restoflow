import { redirect, notFound } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";
import { computeSetupChecklist } from "@/lib/setup-checklist";
import AdminNav from "../components/AdminNav";
import SetupWizard from "./SetupWizard";

export const revalidate = 0;

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ step?: string }>;
};

export default async function SetupPage({ params, searchParams }: Props) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);

  const user = await getAuthenticatedUser();
  if (user.restaurantSlug !== slug) {
    redirect(`/admin/${user.restaurantSlug}/setup`);
  }

  const db = getAdminDb();
  const [restaurantSnap, menuSnap] = await Promise.all([
    db.collection("restaurants").doc(slug).get(),
    db.collection("menu_items").where("restaurantId", "==", slug).count().get(),
  ]);

  if (!restaurantSnap.exists) return notFound();

  const data = restaurantSnap.data()!;
  const menuItemCount = menuSnap.data().count;
  const setupChecklist = computeSetupChecklist(
    data as Record<string, unknown>,
    menuItemCount
  );

  const rawStep = parseInt(sp.step ?? "1", 10);
  const initialStep = Number.isFinite(rawStep) ? Math.min(Math.max(rawStep, 1), 7) : 1;

  return (
    <div className="flex min-h-screen bg-gray-50">
      <AdminNav slug={slug} role={user.role as "owner" | "manager" | "staff"} />
      <div className="flex-1 min-w-0 pt-14 pb-16 lg:pt-0 lg:pb-0">
        <SetupWizard
          slug={slug}
          status={(data.status as string) || "draft"}
          setupChecklist={setupChecklist}
          menuItemCount={menuItemCount}
          initialStep={initialStep}
        />
      </div>
    </div>
  );
}
