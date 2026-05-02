import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth-server";
import BillingCallbackClient from "./BillingCallbackClient";

type Props = { params: Promise<{ slug: string }> };

export default async function BillingCallbackPage({ params }: Props) {
  const { slug } = await params;
  const user = await getAuthenticatedUser();

  if (user.restaurantSlug !== slug) {
    redirect(`/admin/${user.restaurantSlug}/billing/callback`);
  }

  return (
    <Suspense>
      <BillingCallbackClient slug={slug} />
    </Suspense>
  );
}
