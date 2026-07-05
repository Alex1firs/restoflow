import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { checkRateLimit } from "@/lib/rate-limit";
import { getPurchasingPlan, generatePurchasingPlan } from "@/lib/ai/purchasing";
import { getOperatingProfile, preferredSupplierFor } from "@/lib/ai/profile";
import type { PurchasingPlan } from "@/lib/ai/types";

/** Attach the owner's preferred supplier from the Operating Profile (non-mutating). */
async function withProfile(slug: string, plan: PurchasingPlan | null): Promise<PurchasingPlan | null> {
  if (!plan) return plan;
  const profile = await getOperatingProfile(slug);
  return { ...plan, preferredSupplier: preferredSupplierFor(profile) };
}

/**
 * GET  /api/admin/ai/purchasing  → today's cached purchasing plan (no computation).
 * POST /api/admin/ai/purchasing  → generate/refresh today's plan (owner/manager).
 *
 * Deterministic (no LLM), grounded in the Forecasting + Recommendation Engines.
 * Managerial surface. Writes only ai_purchase_plans + ai_usage.
 */

export async function GET() {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try {
    user = await getAuthenticatedUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (user.role === "staff") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const plan = await withProfile(user.restaurantSlug, await getPurchasingPlan(user.restaurantSlug));
  return NextResponse.json({ plan }, { status: 200 });
}

export async function POST(req: Request) {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try {
    user = await getAuthenticatedUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (user.role === "staff") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { allowed } = await checkRateLimit(`ai-purchasing:${user.uid}`, 10, 60_000);
  if (!allowed) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

  let force = false;
  try {
    const body = (await req.json()) as { force?: unknown };
    force = body?.force === true;
  } catch {
    /* no body → non-forced generate */
  }

  try {
    const plan = await withProfile(user.restaurantSlug, await generatePurchasingPlan(user.restaurantSlug, { force }));
    return NextResponse.json({ plan }, { status: 200 });
  } catch (err) {
    console.error("[ai-purchasing] error:", err);
    return NextResponse.json({ error: "Failed to generate purchasing plan. Please try again." }, { status: 500 });
  }
}
