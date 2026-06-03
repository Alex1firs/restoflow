import { redirect, notFound } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";
import AdminNav from "../components/AdminNav";
import SubscriptionBanner from "../components/SubscriptionBanner";
import { getSubscriptionInfo } from "@/lib/subscription";
import PaymentSettingsClient from "./PaymentSettingsClient";
import BillingSection from "../components/BillingSection";

type Props = { params: Promise<{ slug: string }> };

export const revalidate = 0;

export default async function PaymentSettingsPage({ params }: Props) {
  const { slug } = await params;
  const user = await getAuthenticatedUser();

  if (user.restaurantSlug !== slug) {
    redirect(`/admin/${user.restaurantSlug}/payment`);
  }
  if (user.role !== "owner") redirect(`/admin/${slug}/dashboard`);

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
    <div className="flex min-h-screen bg-gray-100">
      <AdminNav slug={slug} role="owner" />
      <div className="flex-1 min-w-0 pt-14 pb-16 lg:pt-0 lg:pb-0">
        <SubscriptionBanner subscription={subscription} />
        <div className="max-w-5xl mx-auto px-4 py-8 grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-1">
            <BillingSection
              restaurantSlug={slug}
              planId={subscription.planId}
              planName={subscription.planName}
              monthlyPrice={subscription.monthlyPrice}
              subscriptionStatus={subscription.status}
            />
          </div>
          <div className="lg:col-span-2">
            <PaymentSettingsClient current={current} />
          </div>
        </div>
      </div>
    </div>
  );
}
