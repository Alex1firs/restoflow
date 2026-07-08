import { NextResponse } from "next/server";
import { getSuperAdminUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";
import { getCampaign, getCampaignOrders } from "@/lib/campaigns/store";
import { tallyParticipants } from "@/lib/campaigns/logic";

export const dynamic = "force-dynamic";

// Campaign detail + read-only participant tally (super-admin only).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try { await getSuperAdminUser(); } catch { return NextResponse.json({ error: "Forbidden" }, { status: 403 }); }

  const { id } = await params;
  const db = getAdminDb();
  const campaign = await getCampaign(db, id);
  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

  const orders = await getCampaignOrders(db, id);
  const participants = tallyParticipants(orders, campaign);
  const qualifiedCount = participants.filter((p) => p.qualified).length;

  return NextResponse.json({ campaign, participants, qualifiedCount, totalParticipants: participants.length });
}
