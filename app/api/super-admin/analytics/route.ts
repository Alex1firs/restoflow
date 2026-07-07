import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSuperAdminUser } from "@/lib/auth-server";
import { analyticsEnabled } from "@/lib/analytics/rollup";
import { getPlatformAnalytics } from "@/lib/analytics/platform-query";

// Platform-wide analytics. SUPER-ADMIN ONLY. Cross-tenant reads are gated here —
// no restaurant session can reach this data.
//   - No session cookie        → 401
//   - Session but not superadmin → 403

export async function GET(req: NextRequest) {
  const session = (await cookies()).get("__session")?.value;
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    await getSuperAdminUser();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const range = searchParams.get("range") ?? "today";
  const from = searchParams.get("from") ?? undefined;
  const to = searchParams.get("to") ?? undefined;

  if (!analyticsEnabled()) {
    return NextResponse.json({ enabled: false, hasData: false });
  }

  try {
    const data = await getPlatformAnalytics(range, from, to);
    return NextResponse.json({ enabled: true, ...data });
  } catch {
    return NextResponse.json({ error: "Could not load analytics" }, { status: 400 });
  }
}
