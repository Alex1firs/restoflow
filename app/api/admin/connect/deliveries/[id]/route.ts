import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { authoriseConnect } from "@/lib/connect/http";
import { ConnectStore } from "@/lib/connect/store";
import { merchantView } from "@/lib/connect/merchant-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One delivery, scoped to the caller's own restaurant by the store. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authoriseConnect();
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  const db = getAdminDb();
  const d = await new ConnectStore(db).get(auth.caller.restaurantId, id);
  // A delivery belonging to somebody else is Not Found, never Forbidden.
  if (!d) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ delivery: merchantView(d) });
}
