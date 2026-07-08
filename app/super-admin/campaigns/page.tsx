import { getSuperAdminUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";
import { listCampaigns } from "@/lib/campaigns/store";
import CampaignsClient from "./CampaignsClient";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  await getSuperAdminUser(); // gate (layout also gates; explicit for safety)
  const campaigns = await listCampaigns(getAdminDb());
  return <CampaignsClient initialCampaigns={campaigns} />;
}
