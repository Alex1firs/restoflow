import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { listActiveCampaigns } from "@/lib/campaigns/store";
import { toPublicCampaign } from "@/lib/campaigns/logic";
import type { CampaignEntryPoint } from "@/lib/campaigns/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * PUBLIC, read-only: the currently-active campaign for a given entry point
 * ("landing" | "discover"). Returns only the PII-free public projection — no
 * participant/phone/internal data. Used to decide whether to carry ?camp and
 * show promo messaging. Never writes.
 */
export async function GET(req: NextRequest) {
  const entryRaw = req.nextUrl.searchParams.get("entry");
  const entry: CampaignEntryPoint | null = entryRaw === "landing" || entryRaw === "discover" ? entryRaw : null;

  try {
    const active = await listActiveCampaigns(getAdminDb(), Date.now());
    const match = active.find((c) => (entry ? c.entryPoints.includes(entry) : c.entryPoints.length > 0));
    return NextResponse.json({ campaign: match ? toPublicCampaign(match) : null });
  } catch {
    // Non-fatal: callers degrade to "no campaign".
    return NextResponse.json({ campaign: null });
  }
}
