// GET /api/discovery/collections — ranked dishes for one taxonomy tag / collection key.
// Query: tag (or key), lat, lng, limit, cursor, explain=1. No tag → valid empty response.
import { NextResponse } from "next/server";
import { buildDiscoveryDeps } from "@/lib/discovery/api-route-helpers";
import { collectionsHandler, parseListParams } from "@/lib/discovery/api-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const res = await collectionsHandler(buildDiscoveryDeps(), parseListParams(sp));
  return NextResponse.json(res);
}
