import "server-only";
import { isValidLatLng } from "./geo";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
import { FieldValue, type Firestore } from "firebase-admin/firestore";

/**
 * Customer identity for the mobile API.
 *
 * ── Completely separate from restaurant and cashier identity ─────────────────
 * `getAuthenticatedUser()` reads the `__session` cookie, loads `users/{uid}`,
 * and returns a restaurantSlug and a role. NOTHING here touches that path. A
 * customer presents a Firebase ID token, is resolved against `customers/{uid}`,
 * and receives no role and no restaurant — because there is no field on a
 * customer record that could carry one.
 *
 * A customer token can therefore never authorise an admin route, and an admin
 * session can never authorise a customer route: they are different credentials,
 * resolved by different functions, against different collections.
 */

export const CUSTOMERS = "customers";

export type Customer = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  photoUrl: string | null;
  notificationPrefs: { orderUpdates: boolean; promotions: boolean };
  status: "active" | "blocked";
  createdAt: number;
  updatedAt: number;
};

export type AuthOutcome =
  | { ok: true; customer: Customer }
  | { ok: false; status: 401 | 403; error: string };

/**
 * Resolve the caller from their bearer token.
 *
 * The uid comes from a VERIFIED token and nowhere else. There is deliberately
 * no parameter, header or body field by which a caller could name a different
 * customer — the whole class of "customer A fetches customer B" is removed by
 * not having an input that could express it.
 */
export async function authenticateCustomer(req: Request): Promise<AuthOutcome> {
  const header = req.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) {
    return { ok: false, status: 401, error: "Sign in to continue." };
  }

  const token = header.slice(7).trim();
  if (!token) return { ok: false, status: 401, error: "Sign in to continue." };

  let uid: string;
  let email: string | null;
  try {
    // checkRevoked: a signed-out or disabled account must stop working
    // immediately, not when its hour-long token happens to expire.
    const decoded = await getAdminAuth().verifyIdToken(token, true);
    uid = decoded.uid;
    email = decoded.email ?? null;
  } catch {
    return { ok: false, status: 401, error: "Your session has expired. Please sign in again." };
  }

  const db = getAdminDb();
  const customer = await upsertCustomer(db, { uid, email });

  if (customer.status === "blocked") {
    return { ok: false, status: 403, error: "This account cannot place orders. Please contact support." };
  }

  return { ok: true, customer };
}

/**
 * First sight of a customer creates their record.
 *
 * Firebase Auth owns the credential; this owns the profile. Creating it lazily
 * means there is no separate "register" step to get out of step with Auth, and
 * no window in which a signed-in customer has no profile.
 */
async function upsertCustomer(db: Firestore, args: { uid: string; email: string | null }): Promise<Customer> {
  const ref = db.collection(CUSTOMERS).doc(args.uid);
  const snap = await ref.get();
  const now = Date.now();

  if (!snap.exists) {
    const created: Customer = {
      id: args.uid,
      name: args.email?.split("@")[0] ?? "Customer",
      email: args.email,
      phone: null,
      photoUrl: null,
      notificationPrefs: { orderUpdates: true, promotions: false },
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
    await ref.set({ ...created, createdAt: FieldValue.serverTimestamp(), createdAtMs: now });
    return created;
  }

  const d = snap.data() ?? {};
  return {
    id: args.uid,
    name: typeof d.name === "string" && d.name ? d.name : "Customer",
    email: typeof d.email === "string" ? d.email : args.email,
    phone: typeof d.phone === "string" ? d.phone : null,
    photoUrl: typeof d.photoUrl === "string" ? d.photoUrl : null,
    notificationPrefs: {
      orderUpdates: (d.notificationPrefs as { orderUpdates?: boolean } | undefined)?.orderUpdates !== false,
      promotions: (d.notificationPrefs as { promotions?: boolean } | undefined)?.promotions === true,
    },
    status: d.status === "blocked" ? "blocked" : "active",
    createdAt: typeof d.createdAtMs === "number" ? d.createdAtMs : now,
    updatedAt: typeof d.updatedAt === "number" ? d.updatedAt : now,
  };
}

/**
 * Addresses live in a SUBCOLLECTION of the customer.
 *
 * `customers/{uid}/addresses/{id}` — so ownership is a path, not a field
 * comparison somebody has to remember to write. A query for another customer's
 * addresses is not a query that can be constructed.
 */
export function addressesRef(db: Firestore, customerId: string) {
  return db.collection(CUSTOMERS).doc(customerId).collection("addresses");
}

export type CustomerAddress = {
  id: string;
  label: "home" | "work" | "other";
  line1: string;
  instructions: string;
  location: { lat: number; lng: number };
  isDefault: boolean;
};

/**
 * An address, field by field.
 *
 * A cast is not a filter — `{ ...doc.data() } as CustomerAddress` types the
 * value without removing anything from it, so any field ever written
 * alongside an address (a geocoding confidence, an ops annotation) would ship
 * with it. This builds the response instead.
 */
export function toPublicAddress(id: string, d: Record<string, unknown>): CustomerAddress {
  const loc = (d.location ?? {}) as { lat?: unknown; lng?: unknown };
  return {
    id,
    label: d.label === "home" || d.label === "work" ? d.label : "other",
    line1: typeof d.line1 === "string" ? d.line1 : "",
    instructions: typeof d.instructions === "string" ? d.instructions : "",
    location: { lat: Number(loc.lat ?? 0), lng: Number(loc.lng ?? 0) },
    isDefault: d.isDefault === true,
  };
}

export function toPublicCustomer(c: Customer) {
  return {
    id: c.id, name: c.name, email: c.email, phone: c.phone, photoUrl: c.photoUrl,
    notificationPrefs: c.notificationPrefs,
    createdAt: new Date(c.createdAt).toISOString(),
    updatedAt: new Date(c.updatedAt).toISOString(),
  };
}

// Re-exported so route handlers have one import for everything about a
// customer, including the shape of the coordinates they submit.
export { isValidLatLng };
