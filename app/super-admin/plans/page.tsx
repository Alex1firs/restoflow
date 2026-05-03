import { PLANS } from "@/lib/plans";
import PlansClient from "./PlansClient";

export const revalidate = 0;

export default function SuperAdminPlansPage() {
  return <PlansClient plans={PLANS} />;
}
