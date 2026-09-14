import { NextResponse } from "next/server";
import { getSuperAdminUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";
import { refundConnectDelivery } from "@/lib/connect/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Refund a Connect delivery that was paid for and can never be fulfilled.
 *
 * ── Why a super-admin acts, not the partner ──────────────────────────────────
 * The money was the customer's and the obligation is RestoFlow's. A partner
 * refunding its own customers would let it settle a dispute with money the
 * platform is holding, and a customer cannot ask for it here because possession
 * of a tracking link is not authority to move money.
 *
 * The service reconciles with Dispatcher before it refunds anything, so this
 * route cannot pay somebody back for a courier who is already on the way.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await getSuperAdminUser();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await ctx.params;
  let reason = "delivery could not be fulfilled";
  try {
    const body = (await req.json()) as { reason?: unknown };
    if (typeof body.reason === "string" && body.reason.trim()) reason = body.reason.trim();
  } catch {
    // The default reason is fine.
  }

  const result = await refundConnectDelivery({ db: getAdminDb(), deliveryId: id, reason });

  if (!result.ok) {
    // `job_exists_after_all` is a 409, not a failure: reconciliation found a
    // courier and adopted it, which is the right outcome and not an error.
    const status = result.reason === "not_found" ? 404 : result.reason === "job_exists_after_all" ? 409 : 422;
    return NextResponse.json({ error: result.reason, detail: result.detail }, { status });
  }

  return NextResponse.json({ ok: true, alreadyRefunded: result.alreadyRefunded });
}
