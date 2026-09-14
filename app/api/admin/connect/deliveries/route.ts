import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { authoriseConnect } from "@/lib/connect/http";
import { quoteConnectDelivery } from "@/lib/connect/service";
import { ConnectStore } from "@/lib/connect/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** This partner's Connect deliveries. Scoped in the store, not by a caller-supplied filter. */
export async function GET() {
  const auth = await authoriseConnect();
  if (!auth.ok) return auth.response;
  const rows = await new ConnectStore(getAdminDb()).list(auth.caller.restaurantId);
  return NextResponse.json({ deliveries: rows.map(redact) });
}

/** Price a delivery. Creates a `quoted` record; requests nothing. */
export async function POST(req: Request) {
  const auth = await authoriseConnect();
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const d = (body.dropoff ?? {}) as Record<string, unknown>;
  const loc = (d.location ?? {}) as Record<string, unknown>;
  const lat = Number(loc.lat);
  const lng = Number(loc.lng);

  // The pin is authoritative, so it must actually be a pin. A typed address
  // with no confirmed coordinates is not a destination.
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) {
    return NextResponse.json({ error: "Confirm the drop-off location on the map." }, { status: 400 });
  }
  const name = String(d.name ?? "").trim();
  const phone = String(d.contactPhone ?? "").trim();
  const address = String(d.address ?? "").trim();
  if (!name || phone.length < 10 || address.length < 6) {
    return NextResponse.json({ error: "Customer name, phone and address are required." }, { status: 400 });
  }

  const packageDescription = String(body.packageDescription ?? "").trim();
  if (!packageDescription) {
    return NextResponse.json({ error: "Describe the package for the rider." }, { status: 400 });
  }

  const readyInMins = Number(body.readyInMins ?? 0);
  const readyAt = new Date(Date.now() + Math.max(0, readyInMins) * 60_000).toISOString();

  const result = await quoteConnectDelivery({
    db: getAdminDb(),
    restaurantId: auth.caller.restaurantId,
    createdByUid: auth.caller.uid,
    dropoff: {
      name, address, contactPhone: phone,
      location: { lat, lng },
      instructions: String(d.instructions ?? "").trim() || null,
    },
    packageDescription,
    readyAt,
  });

  if (!result.ok) return NextResponse.json({ error: result.reason, detail: result.detail }, { status: 422 });
  return NextResponse.json({ delivery: redact(result.delivery) });
}

/**
 * What the partner is allowed to see.
 *
 * The Dispatcher cost and RestoFlow's margin are accounting facts, not quote
 * copy — a partner shown "your price is our cost plus our cut" is being invited
 * to negotiate with the wrong party. One number goes out: the amount payable.
 */
function redact(d: import("@/lib/connect/types").ConnectDelivery) {
  return {
    id: d.id,
    state: d.state,
    dropoff: d.dropoff,
    packageDescription: d.packageDescription,
    readyAt: d.readyAt,
    quote: d.quote
      ? {
          priceMinor: d.quote.partnerPriceMinor,
          distanceKm: d.quote.distanceKm,
          etaToPickupMins: d.quote.etaToPickupMins,
          etaToDropoffMins: d.quote.etaToDropoffMins,
          expiresAtMs: d.quote.expiresAtMs,
        }
      : null,
    delivery: d.delivery
      ? { state: d.delivery.state, pickupCode: d.delivery.pickupCode, driver: d.delivery.driver }
      : null,
    createdAtMs: d.createdAtMs,
  };
}
