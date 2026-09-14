import { NextResponse } from "next/server";
import { getSuperAdminUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Activate, suspend or reconfigure Connect for one restaurant.
 *
 * ── Why activation is a super-admin act ──────────────────────────────────────
 * Connect spends money: every request commissions a courier that RestoFlow pays
 * for and then bills. A restaurant cannot switch that on for itself, exactly as
 * it cannot list itself on the marketplace without approval.
 *
 * ── Why the margin is required here ──────────────────────────────────────────
 * There is no default. A Connect partner with no configured margin is inactive
 * by construction, so the platform cannot end up carrying Dispatcher's cost at
 * par because somebody forgot a field.
 */
export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    await getSuperAdminUser();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { slug } = await ctx.params;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const action = String(body.action ?? "");
  const ref = getAdminDb().collection("restaurants").doc(slug);
  if (!(await ref.get()).exists) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (action === "suspend") {
    await ref.update({ "connect.state": "suspended" });
    return NextResponse.json({ ok: true, state: "suspended" });
  }

  if (action !== "activate") return NextResponse.json({ error: "Unknown action" }, { status: 400 });

  const marginBps = Number(body.marginBps);
  if (!Number.isFinite(marginBps) || marginBps < 0 || marginBps > 10_000) {
    return NextResponse.json(
      { error: "marginBps is required and must be between 0 and 10000 (0-100%)." },
      { status: 400 }
    );
  }

  await ref.update({
    "connect.state": "active",
    "connect.marginBps": Math.round(marginBps),
    "connect.billingMode": "prepaid",
    // Carried so production activation can refuse a value that was only ever
    // meant for verifying the maths on staging.
    "connect.marginIsTest": body.marginIsTest === true,
    "connect.pickupName": typeof body.pickupName === "string" ? body.pickupName : null,
    "connect.approvedAt": Date.now(),
    "connect.approvedBy": "super_admin",
    "connect.updatedAt": FieldValue.serverTimestamp(),
  });

  return NextResponse.json({ ok: true, state: "active", marginBps: Math.round(marginBps) });
}
