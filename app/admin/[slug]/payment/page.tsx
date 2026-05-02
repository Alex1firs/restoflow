import { redirect, notFound } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";
import AdminNav from "../components/AdminNav";
import SubscriptionBanner from "../components/SubscriptionBanner";
import { getSubscriptionInfo } from "@/lib/subscription";
import PaymentSettingsClient from "./PaymentSettingsClient";

type Props = { params: Promise<{ slug: string }> };

export const revalidate = 0;

export default async function PaymentSettingsPage({ params }: Props) {
  const { slug } = await params;
  const user = await getAuthenticatedUser();

  if (user.restaurantSlug !== slug) {
    redirect(`/admin/${user.restaurantSlug}/payment`);
  }

  const snap = await getAdminDb().collection("restaurants").doc(slug).get();
  if (!snap.exists) return notFound();

  const data = snap.data()!;
  const subscription = await getSubscriptionInfo(data as Record<string, unknown>);

  const current = {
    bankName: (data.paymentBankName as string) ?? "",
    bankCode: (data.paymentBankCode as string) ?? "",
    accountNumber: (data.paymentAccountNumber as string) ?? "",
    accountName: (data.paymentAccountName as string) ?? "",
    subaccountCode: (data.paystackSubaccountCode as string) ?? "",
  };

  return (
    <div className="bg-gray-100 min-h-screen">
      <AdminNav slug={slug} />
      <SubscriptionBanner subscription={subscription} />
      <PaymentSettingsClient current={current} />
    </div>
  );
}
