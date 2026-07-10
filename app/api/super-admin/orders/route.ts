import { NextRequest, NextResponse } from "next/server";
import { getSuperAdminUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import { toOrderRow, orderMatchesFilters, type OrderFilters, type SuperAdminOrderRow } from "@/lib/orders/admin-view";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_PAGE = 50;
const MAX_PAGE = 100;

// Read-only, super-admin-only platform-wide order list. Admin SDK (bypasses
// Firestore rules) so it can see every restaurant's orders. Returns the FULL
// customer phone — this endpoint is the only place that shape is exposed.
//
// Query is ordered by createdAt desc (auto-indexed single field) and paginated
// via a `cursor` (createdAt ms). Filters are applied server-side in-memory over
// the fetched page to avoid requiring composite indexes; `scanned`/`returned`
// are reported so any per-page reduction is explicit. NEVER writes.
export async function GET(req: NextRequest) {
  try {
    await getSuperAdminUser();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const num = (v: string | null): number | null => {
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const pageSize = Math.min(MAX_PAGE, Math.max(1, num(sp.get("limit")) ?? DEFAULT_PAGE));
  const cursorMs = num(sp.get("cursor"));
  const filters: OrderFilters = {
    restaurantId: sp.get("restaurantId")?.trim() || undefined,
    status: sp.get("status")?.trim() || undefined,
    paymentStatus: sp.get("paymentStatus")?.trim() || undefined,
    paymentMethod: sp.get("paymentMethod")?.trim() || undefined,
    fromMs: num(sp.get("from")),
    toMs: num(sp.get("to")),
    phone: sp.get("phone")?.trim() || undefined,
  };

  const db = getAdminDb();

  let q = db.collection("orders").orderBy("createdAt", "desc");
  if (cursorMs != null) q = q.startAfter(Timestamp.fromMillis(cursorMs));
  const snap = await q.limit(pageSize).get();

  const rawDocs = snap.docs;

  // Join restaurant names for this page's distinct restaurantIds (read-only).
  const ids = [...new Set(rawDocs.map((d) => String((d.data() as Record<string, unknown>).restaurantId ?? "")).filter(Boolean))];
  const nameMap = new Map<string, string | null>();
  if (ids.length) {
    const refs = ids.map((id) => db.collection("restaurants").doc(id));
    const rSnaps = await db.getAll(...refs);
    for (const rs of rSnaps) {
      nameMap.set(rs.id, rs.exists ? ((rs.data() as Record<string, unknown>).name as string | undefined) ?? null : null);
    }
  }

  const rows: SuperAdminOrderRow[] = rawDocs
    .map((d) => {
      const data = d.data() as Record<string, unknown>;
      return toOrderRow(d.id, data, nameMap.get(String(data.restaurantId ?? "")) ?? null);
    })
    .filter((row) => orderMatchesFilters(row, filters));

  // Advance the cursor by the raw page (so pagination walks the whole collection
  // regardless of how many rows a filter removed on this page).
  const lastRaw = rawDocs[rawDocs.length - 1];
  const nextCursor =
    rawDocs.length === pageSize && lastRaw
      ? toOrderRowCreatedMs(lastRaw.data() as Record<string, unknown>)
      : null;

  return NextResponse.json({
    orders: rows,
    nextCursor,
    scanned: rawDocs.length,
    returned: rows.length,
    pageSize,
  });
}

function toOrderRowCreatedMs(data: Record<string, unknown>): number | null {
  const c = data.createdAt as { toMillis?: () => number } | undefined;
  return typeof c?.toMillis === "function" ? c.toMillis() : null;
}
