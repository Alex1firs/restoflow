import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { withCustomer, badRequest } from "@/lib/marketplace/mobile-api";
import { CUSTOMERS, toPublicCustomer } from "@/lib/marketplace/customer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The caller's own profile. There is no path here that names another customer. */
export const GET = withCustomer(async ({ customer }) => toPublicCustomer(customer));

export const PATCH = withCustomer(async ({ customer, req }) => {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return badRequest("Invalid request body");

  const { name, email, phone, notificationPrefs } = body as Record<string, unknown>;
  const patch: Record<string, unknown> = { updatedAt: Date.now() };

  if (name !== undefined) {
    const trimmed = String(name).trim();
    if (trimmed.length < 1 || trimmed.length > 80) return badRequest("Enter a name.");
    patch.name = trimmed;
  }
  if (email !== undefined) patch.email = String(email).trim() || null;
  if (phone !== undefined) patch.phone = String(phone).trim() || null;
  if (notificationPrefs !== undefined) {
    const p = notificationPrefs as Record<string, unknown>;
    patch.notificationPrefs = {
      orderUpdates: p.orderUpdates !== false,
      promotions: p.promotions === true,
    };
  }

  // `status` is deliberately not patchable: a blocked account must not be able
  // to unblock itself by editing its own profile.
  await getAdminDb().collection(CUSTOMERS).doc(customer.id).update(patch);

  return NextResponse.json(
    toPublicCustomer({ ...customer, ...(patch as Partial<typeof customer>) }),
    { status: 200 }
  );
});
