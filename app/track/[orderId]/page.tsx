"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useParams } from "next/navigation";

type OrderStatus = "pending" | "preparing" | "ready" | "completed" | "rejected";

type OrderItem = { name: string; quantity: number; price: number };

type Order = {
  restaurantId: string;
  customerName: string;
  items: OrderItem[];
  total: number;
  status: OrderStatus;
  paymentMethod: "online" | "cash";
  paymentStatus: "paid" | "pending";
  deliveryType?: "delivery" | "pickup";
};

const STEPS: { status: OrderStatus; label: string; icon: string }[] = [
  { status: "pending",   label: "Order Received",    icon: "🍽️" },
  { status: "preparing", label: "Being Prepared",    icon: "👨‍🍳" },
  { status: "ready",     label: "Ready",             icon: "📦" },
  { status: "completed", label: "Completed",         icon: "🎉" },
];

const STATUS_MESSAGE: Record<OrderStatus, string> = {
  pending:   "Your order has been received and is waiting to be confirmed.",
  preparing: "The restaurant is preparing your food. Sit tight!",
  ready:     "Your order is ready!",
  completed: "Your order has been delivered. Enjoy your meal!",
  rejected:  "Unfortunately your order could not be fulfilled.",
};

function stepIndex(status: OrderStatus): number {
  const idx = STEPS.findIndex((s) => s.status === status);
  return idx === -1 ? 0 : idx;
}

export default function TrackOrderPage() {
  const params = useParams();
  const orderId = params.orderId as string;
  const [order, setOrder] = useState<Order | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!orderId) return;
    const ref = doc(db, "orders", orderId);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) { setNotFound(true); return; }
        setOrder(snap.data() as Order);
      },
      () => setNotFound(true)
    );
    return () => unsub();
  }, [orderId]);

  if (notFound) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="text-center">
          <p className="text-4xl mb-3">🔍</p>
          <p className="font-bold text-gray-700">Order not found</p>
          <p className="text-sm text-gray-400 mt-1">Check your link and try again.</p>
        </div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" />
      </div>
    );
  }

  const isCancelled = order.status === "rejected";
  const currentStep = stepIndex(order.status);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-md mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <p className="text-xs font-black uppercase tracking-widest text-orange-500 mb-1">RestoFlow</p>
          <h1 className="text-2xl font-black text-gray-900">Order Tracker</h1>
          <p className="text-xs text-gray-400 mt-1 font-mono">#{orderId.slice(0, 8).toUpperCase()}</p>
        </div>

        {/* Status card */}
        <div className={`rounded-3xl p-6 mb-6 text-center ${isCancelled ? "bg-red-50 border border-red-100" : "bg-white border border-gray-100 shadow-sm"}`}>
          <p className="text-4xl mb-2">{isCancelled ? "❌" : STEPS[currentStep]?.icon}</p>
          <p className="text-xl font-black text-gray-900 mb-1">
            {isCancelled ? "Order Cancelled" : STEPS[currentStep]?.label}
          </p>
          <p className="text-sm text-gray-500">{STATUS_MESSAGE[order.status]}</p>
        </div>

        {/* Progress steps */}
        {!isCancelled && (
          <div className="bg-white border border-gray-100 shadow-sm rounded-3xl p-6 mb-6">
            <div className="flex items-start justify-between relative">
              {/* Connector line */}
              <div className="absolute top-4 left-4 right-4 h-0.5 bg-gray-100 z-0" />
              <div
                className="absolute top-4 left-4 h-0.5 bg-orange-400 z-0 transition-all duration-500"
                style={{ width: `${(currentStep / (STEPS.length - 1)) * (100 - (8 / STEPS.length) * 100)}%` }}
              />
              {STEPS.map((step, i) => {
                const done = i <= currentStep;
                return (
                  <div key={step.status} className="flex flex-col items-center gap-2 z-10" style={{ width: `${100 / STEPS.length}%` }}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-black transition-all ${done ? "bg-orange-500 text-white" : "bg-gray-100 text-gray-300"}`}>
                      {done ? "✓" : i + 1}
                    </div>
                    <p className={`text-[10px] font-bold text-center leading-tight ${done ? "text-orange-600" : "text-gray-300"}`}>
                      {step.label}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Order details */}
        <div className="bg-white border border-gray-100 shadow-sm rounded-3xl p-6 mb-6">
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-3">Your Order</p>
          <div className="space-y-2 mb-4">
            {order.items.map((item, i) => (
              <div key={i} className="flex justify-between text-sm">
                <span className="text-gray-700">
                  <span className="font-black text-orange-500">{item.quantity}×</span> {item.name}
                </span>
                <span className="text-gray-500">₦{(item.price * item.quantity).toLocaleString("en-NG")}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-gray-100 pt-3 flex justify-between font-black">
            <span className="text-gray-600">Total</span>
            <span className="text-gray-900">₦{order.total.toLocaleString("en-NG")}</span>
          </div>
          <div className="flex justify-between text-xs text-gray-400 mt-2">
            <span>Payment</span>
            <span className="font-bold">
              {order.paymentMethod === "online" ? "Online" : "Cash"} ·{" "}
              {order.paymentStatus === "paid" ? "Paid ✓" : "Pay on delivery"}
            </span>
          </div>
        </div>

        <p className="text-center text-xs text-gray-300">Updates appear in real-time</p>
      </div>
    </div>
  );
}
