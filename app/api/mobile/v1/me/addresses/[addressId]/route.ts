import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { withCustomer, badRequest, notFound } from "@/lib/marketplace/mobile-api";
import { addressesRef, toPublicAddress, isValidLatLng } from "@/lib/marketplace/customer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ addressId: string }> };

/**
 * Even with an id in the path, the read is scoped to the caller's own
 * subcollection — so another customer's address id resolves to nothing rather
 * than to their address.
 */
export function PATCH(req: Request, ctx: Ctx) {
  return withCustomer(async ({ customer }) => {
    const { addressId } = await ctx.params;
    const db = getAdminDb();
    const ref = addressesRef(db, customer.id).doc(addressId);

    const snap = await ref.get();
    if (!snap.exists) return notFound();

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return badRequest("Invalid request body");

    const patch: Record<string, unknown> = {};
    const { line1, instructions, location, isDefault, label } = body as Record<string, unknown>;

    if (line1 !== undefined) {
      const address = String(line1).trim();
      if (address.length < 6) return badRequest("Enter a bit more of the address.");
      patch.line1 = address;
    }
    if (instructions !== undefined) patch.instructions = String(instructions).trim().slice(0, 200);
    if (label !== undefined) patch.label = String(label);
    if (location !== undefined) {
      if (!isValidLatLng(location)) return badRequest("That location isn't valid.");
      patch.location = location;
    }
    if (isDefault === true) {
      const existing = await addressesRef(db, customer.id).where("isDefault", "==", true).get();
      const batch = db.batch();
      existing.docs.forEach((d) => batch.update(d.ref, { isDefault: false }));
      await batch.commit();
      patch.isDefault = true;
    }

    await ref.update(patch);
    const updated = await ref.get();
    return NextResponse.json(toPublicAddress(updated.id, updated.data() ?? {}), { status: 200 });
  })(req);
}

export function DELETE(req: Request, ctx: Ctx) {
  return withCustomer(async ({ customer }) => {
    const { addressId } = await ctx.params;
    const ref = addressesRef(getAdminDb(), customer.id).doc(addressId);
    const snap = await ref.get();
    if (!snap.exists) return notFound();
    await ref.delete();
    return NextResponse.json({ deleted: true }, { status: 200 });
  })(req);
}
