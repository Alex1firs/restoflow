// GET /api/discovery/near — distance-ranked restaurants (usable geo only).
// Query: lat, lng (required for results), radiusKm, tags(csv), limit, cursor, explain=1
// Reports excludedNoUsableLocation. With no lat/lng returns a valid empty response.
import { NextResponse } from "next/server";
import { buildDiscoveryDeps } from "@/lib/discovery/api-route-helpers";
import { nearRestaurantsHandler, parseListParams } from "@/lib/discovery/api-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const res = await nearRestaurantsHandler(buildDiscoveryDeps(), parseListParams(sp));
  return NextResponse.json(res);
}
