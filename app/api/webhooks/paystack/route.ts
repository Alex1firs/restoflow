import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import { processSuccessfulPayment, type PaystackPaymentData } from "@/lib/payments";
import { processOnboarding } from "@/lib/onboarding";
import { createOrderFromPaymentReference } from "@/lib/order-payments";
import { sendNewOrderAlert } from "@/lib/notifications";
import { sendCustomerNotification } from "@/lib/customer-notifications";
import { getAdminDb } from "@/lib/firebase-admin";
import { awardLoyaltyTick } from "@/lib/loyalty";
import { serverEnv } from "@/lib/env";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  const signature = req.headers.get("x-paystack-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 401 });
  }

  // serverEnv.PAYSTACK_SECRET_KEY throws immediately if the var is unset,
  // preventing HMAC from being computed against the string "undefined".
  const secret = serverEnv.PAYSTACK_SECRET_KEY;
  const expected = createHmac("sha512", secret).update(rawBody).digest("hex");

  if (signature !== expected) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: { event: string; data: PaystackPaymentData };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (event.event === "charge.success") {
    const { metadata, reference } = event.data as PaystackPaymentData & { reference: string };
    try {
      if (metadata?.paymentType === "onboarding" && metadata?.onboardingId) {
        await processOnboarding(metadata.onboardingId, reference);
      } else if (metadata?.paymentType === "order") {
        const newOrderId = await createOrderFromPaymentReference(reference);
        if (newOrderId) {
          // Fetch order + restaurant for notifications
          const db = getAdminDb();
          const orderSnap = await db.collection("orders").doc(newOrderId).get();
          if (orderSnap.exists) {
            const d = orderSnap.data()!;
            const restaurantSnap = await db.collection("restaurants").doc(d.restaurantId as string).get();
            const rData = restaurantSnap.data() ?? {};
            const restaurantName = (rData.name as string | undefined) ?? (d.restaurantId as string);
            const itemsSummary = (d.items as { name: string; quantity: number }[])
              .map((i) => `${i.quantity}× ${i.name}`)
              .join(", ");

            sendNewOrderAlert({
              restaurantSlug: d.restaurantId as string,
              total: d.total as number,
              paymentMethod: "online",
              paymentStatus: "paid",
              customerName: (d.customerName as string) ?? "",
            }).catch(() => {});

            sendCustomerNotification("created", {
              orderId: newOrderId,
              customerName: (d.customerName as string) ?? "",
              customerPhone: (d.phone as string) ?? "",
              restaurantName,
              restaurantAddress: rData.address as string | undefined,
              total: d.total as number,
              itemsSummary,
              paymentMethod: "online",
              deliveryType: (d.deliveryType as "delivery" | "pickup") ?? "delivery",
            }).catch(() => {});

            sendCustomerNotification("paid", {
              orderId: newOrderId,
              customerName: (d.customerName as string) ?? "",
              customerPhone: (d.phone as string) ?? "",
              restaurantName,
              total: d.total as number,
              itemsSummary,
              paymentMethod: "online",
            }).catch(() => {});

            // Award loyalty tick
            const orderPhone = (d.phone as string) ?? "";
            if (orderPhone) {
              awardLoyaltyTick({
                orderId: newOrderId,
                restaurantSlug: d.restaurantId as string,
                phone: orderPhone,
                customerName: (d.customerName as string) ?? "",
                orderTotal: (d.total as number) ?? 0,
              }).catch(() => {});
            }
          }
        }
      } else {
        await processSuccessfulPayment(event.data);
      }
    } catch (err) {
      console.error("Webhook processing error:", err);
      return NextResponse.json({ error: "Processing failed" }, { status: 500 });
    }
  }

  // Always return 200 to acknowledge receipt — Paystack retries on non-2xx
  return NextResponse.json({ received: true });
}
