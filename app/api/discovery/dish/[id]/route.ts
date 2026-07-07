// GET /api/discovery/dish/[id] — one dish detail + related ranked dishes.
// Query: lat, lng, limit (related), cursor, explain=1. Missing/hidden dish → 404.
import { NextResponse } from "next/server";
import { buildDiscoveryDeps } from "@/lib/discovery/api-route-helpers";
import { dishDetailHandler, parseListParams } from "@/lib/discovery/api-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sp = new URL(req.url).searchParams;
  const res = await dishDetailHandler(buildDiscoveryDeps(), id, parseListParams(sp));
  if (!res) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(res);
}
