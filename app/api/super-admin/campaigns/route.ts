import { NextRequest, NextResponse } from "next/server";
import { getSuperAdminUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { listCampaigns, upsertCampaign, type CampaignInput } from "@/lib/campaigns/store";

export const dynamic = "force-dynamic";

// List all campaigns (super-admin only).
export async function GET() {
  let uid: string;
  try { ({ uid } = await getSuperAdminUser()); } catch { return NextResponse.json({ error: "Forbidden" }, { status: 403 }); }
  void uid;
  const campaigns = await listCampaigns(getAdminDb());
  return NextResponse.json({ campaigns });
}

// Create or edit a campaign document (writes ONLY to `campaigns`).
export async function POST(req: NextRequest) {
  let uid: string;
  try { ({ uid } = await getSuperAdminUser()); } catch { return NextResponse.json({ error: "Forbidden" }, { status: 403 }); }

  const body = await req.json().catch(() => null);
  if (!body || typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: "Campaign name is required" }, { status: 400 });
  }
  const threshold = Number(body.threshold);
  if (!Number.isFinite(threshold) || threshold < 1) {
    return NextResponse.json({ error: "Threshold must be a positive number" }, { status: 400 });
  }

  const input: CampaignInput = {
    id: typeof body.id === "string" && body.id ? body.id : undefined,
    name: body.name,
    description: typeof body.description === "string" ? body.description : "",
    status: ["draft", "active", "ended"].includes(body.status) ? body.status : "draft",
    startAtMs: typeof body.startAtMs === "number" ? body.startAtMs : null,
    endAtMs: typeof body.endAtMs === "number" ? body.endAtMs : null,
    threshold,
    prize: typeof body.prize === "string" ? body.prize : "",
    entryPoints: Array.isArray(body.entryPoints) ? body.entryPoints : [],
    bannerImageUrl: typeof body.bannerImageUrl === "string" ? body.bannerImageUrl : null,
    bannerMobileImageUrl: typeof body.bannerMobileImageUrl === "string" ? body.bannerMobileImageUrl : null,
    bannerAlt: typeof body.bannerAlt === "string" ? body.bannerAlt : "",
    bannerCtaLabel: typeof body.bannerCtaLabel === "string" ? body.bannerCtaLabel : "",
    bannerCtaHref: typeof body.bannerCtaHref === "string" ? body.bannerCtaHref : null,
    bannerEnabled: body.bannerEnabled === true,
    createdBy: uid,
  };

  const id = await upsertCampaign(getAdminDb(), input, () => FieldValue.serverTimestamp());
  return NextResponse.json({ success: true, id }, { status: input.id ? 200 : 201 });
}
