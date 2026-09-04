import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { withCustomer, badRequest } from "@/lib/marketplace/mobile-api";
import { addressesRef, toPublicAddress, isValidLatLng, type CustomerAddress } from "@/lib/marketplace/customer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LABELS = ["home", "work", "other"] as const;

/**
 * Addresses live under `customers/{uid}/addresses`.
 *
 * Ownership is the PATH, so a query for another customer's addresses cannot be
 * constructed — there is no field to compare and no id to substitute.
 */
export const GET = withCustomer(async ({ customer }) => {
  const snap = await addressesRef(getAdminDb(), customer.id).get();
  return snap.docs.map((d) => toPublicAddress(d.id, d.data() ?? {}));
});

export const POST = withCustomer(async ({ customer, req }) => {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return badRequest("Invalid request body");

  const { label, line1, instructions, location, isDefault } = body as Record<string, unknown>;

  if (!(LABELS as readonly string[]).includes(String(label))) return badRequest("Choose Home, Work or Other.");
  const address = String(line1 ?? "").trim();
  if (address.length < 6) return badRequest("Enter a bit more of the address so a courier can find it.");
  if (!isValidLatLng(location)) return badRequest("Pick the location so we can work out delivery.");

  const db = getAdminDb();
  const ref = addressesRef(db, customer.id);

  // A customer can have many addresses but only one default, so setting a new
  // one has to clear the old — in a batch, or a failure leaves two.
  if (isDefault === true) {
    const existing = await ref.where("isDefault", "==", true).get();
    const batch = db.batch();
    existing.docs.forEach((d) => batch.update(d.ref, { isDefault: false }));
    await batch.commit();
  }

  const count = (await ref.count().get()).data().count;
  const doc = ref.doc();
  const created: CustomerAddress = {
    id: doc.id,
    label: label as CustomerAddress["label"],
    line1: address,
    instructions: String(instructions ?? "").trim().slice(0, 200),
    location: location as { lat: number; lng: number },
    // The first address a customer saves is their default, so they never have
    // to think about it.
    isDefault: isDefault === true || count === 0,
  };
  await doc.set(created);

  return NextResponse.json(created, { status: 201 });
});
