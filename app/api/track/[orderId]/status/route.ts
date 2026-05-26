import { timingSafeEqual } from "crypto";
import { type NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";

// Returns only the fields needed by the public tracking UI — no PII exposed.
// Token is validated server-side; no direct Firestore client read is required.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const { orderId } = await params;
  const token = req.nextUrl.searchParams.get("t");
  if (!token) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const snap = await getAdminDb().collection("orders").doc(orderId).get();
    if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const d = snap.data()!;
    const storedToken = d.trackingToken as string | undefined;

    if (!storedToken || !tokensMatch(token, storedToken)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({
      status: d.status,
      paymentStatus: d.paymentStatus,
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}

function tokensMatch(a: string, b: string): boolean {
  try {
    const aBuf = Buffer.from(a, "hex");
    const bBuf = Buffer.from(b, "hex");
    if (aBuf.length === 0 || aBuf.length !== bBuf.length) return false;
    return timingSafeEqual(aBuf, bBuf);
  } catch {
    return false;
  }
}
