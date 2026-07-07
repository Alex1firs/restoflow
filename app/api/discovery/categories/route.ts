// GET /api/discovery/categories — taxonomy facets + counts from visible dishes.
import { NextResponse } from "next/server";
import { buildDiscoveryDeps } from "@/lib/discovery/api-route-helpers";
import { categoriesHandler } from "@/lib/discovery/api-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const res = await categoriesHandler(buildDiscoveryDeps());
  return NextResponse.json(res);
}
