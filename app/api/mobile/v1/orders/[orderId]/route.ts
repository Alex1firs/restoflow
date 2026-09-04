import { getAdminDb } from "@/lib/firebase-admin";
import { withCustomer, notFound } from "@/lib/marketplace/mobile-api";
import { ORDER_SOURCE_MARKETPLACE } from "@/lib/marketplace/store";
import { toCustomerOrderDetail } from "@/lib/marketplace/customer-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: Request, ctx: { params: Promise<{ orderId: string }> }) {
  return withCustomer(async ({ customer }) => {
    const { orderId } = await ctx.params;
    const snap = await getAdminDb().collection("orders").doc(orderId).get();

    // Three separate reasons to say "not found", one indistinguishable answer:
    // no such order, not a marketplace order, and not this customer's. Telling
    // them apart would let a caller confirm an order exists.
    if (!snap.exists) return notFound();
    const d = snap.data() ?? {};
    if (d.orderSource !== ORDER_SOURCE_MARKETPLACE) return notFound();
    if (d.customerId !== customer.id) return notFound();

    return toCustomerOrderDetail(orderId, d);
  })(req);
}
