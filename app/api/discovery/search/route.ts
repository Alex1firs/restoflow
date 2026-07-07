// GET /api/discovery/search — food-first ranked dishes.
// Query: q, tags(csv), lat, lng, limit, cursor, explain=1
import { NextResponse } from "next/server";
import { buildDiscoveryDeps } from "@/lib/discovery/api-route-helpers";
import { searchDishesHandler, parseListParams } from "@/lib/discovery/api-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const res = await searchDishesHandler(buildDiscoveryDeps(), parseListParams(sp));
  return NextResponse.json(res);
}
