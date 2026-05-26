import { timingSafeEqual } from "crypto";
import { notFound } from "next/navigation";
import { getAdminDb } from "@/lib/firebase-admin";
import TrackOrderClient from "./TrackOrderClient";

type Props = {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ t?: string }>;
};

export const revalidate = 0;

export default async function TrackPage({ params, searchParams }: Props) {
  const { orderId } = await params;
  const { t: token } = await searchParams;

  // Token is required. Without it the page is indistinguishable from "not found"
  // to prevent order-ID enumeration.
  if (!token) return notFound();

  let snap;
  try {
    snap = await getAdminDb().collection("orders").doc(orderId).get();
  } catch {
    return notFound();
  }

  if (!snap.exists) return notFound();

  const d = snap.data()!;
  const storedToken = d.trackingToken as string | undefined;

  // Constant-time comparison prevents timing attacks on the token value.
  if (!storedToken || !tokensMatch(token, storedToken)) return notFound();

  return (
    <TrackOrderClient
      orderId={orderId}
      token={token}
      initial={{
        restaurantId: d.restaurantId as string,
        items: (d.items as { name: string; quantity: number; price: number }[]) ?? [],
        total: (d.total as number) ?? 0,
        status: d.status as "pending" | "preparing" | "ready" | "completed" | "rejected",
        paymentMethod: (d.paymentMethod as "online" | "cash") ?? "cash",
        paymentStatus: (d.paymentStatus as "paid" | "pending") ?? "pending",
        deliveryType: (d.deliveryType as "delivery" | "pickup") ?? "delivery",
      }}
    />
  );
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
