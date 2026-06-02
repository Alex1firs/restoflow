"use client";

import { useEffect, useState } from "react";

type OrderStatus = "pending" | "scheduled" | "preparing" | "ready" | "completed" | "rejected";

type OrderItem = { id: string; name: string; price: number; quantity: number };

type SafeOrder = {
  restaurantId: string;
  items: OrderItem[];
  total: number;
  status: OrderStatus;
  paymentMethod: "online" | "cash";
  paymentStatus: "paid" | "pending";
  deliveryType?: "delivery" | "pickup";
  note?: string;
};

const STEPS: { status: OrderStatus; label: string; icon: string }[] = [
  { status: "pending",   label: "Order Received",    icon: "🍽️" },
  { status: "preparing", label: "Being Prepared",    icon: "👨‍🍳" },
  { status: "ready",     label: "Ready",             icon: "📦" },
  { status: "completed", label: "Completed",         icon: "🎉" },
];

const STATUS_MESSAGE: Record<OrderStatus, string> = {
  pending:    "Your order has been received and is waiting to be confirmed.",
  scheduled:  "Your order is scheduled and will be prepared at the requested time.",
  preparing:  "The restaurant is preparing your food. Sit tight!",
  ready:      "Your order is ready!",
  completed:  "Your order has been delivered. Enjoy your meal!",
  rejected:   "Unfortunately your order could not be fulfilled.",
};

function stepIndex(status: OrderStatus): number {
  const idx = STEPS.findIndex((s) => s.status === status);
  return idx === -1 ? 0 : idx;
}

export default function TrackOrderClient({
  orderId,
  token,
  initial,
}: {
  orderId: string;
  token: string;
  initial: SafeOrder;
}) {
  const [order, setOrder] = useState<SafeOrder>(initial);

  // Editing state
  const [editOpen, setEditOpen] = useState(false);
  const [menuItems, setMenuItems] = useState<{ id: string; name: string; price: number; category: string; description: string }[]>([]);
  const [loadingMenu, setLoadingMenu] = useState(false);
  const [editItems, setEditItems] = useState<OrderItem[]>([]);
  const [editNote, setEditNote] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Poll the server-validated status endpoint every 5 s.
  // Direct Firestore reads are blocked on orders to prevent PII exposure.
  useEffect(() => {
    let active = true;

    const poll = async () => {
      if (!active) return;
      try {
        const res = await fetch(`/api/track/${orderId}/status?t=${token}`);
        if (res.ok) {
          const data = (await res.json()) as { status?: OrderStatus; paymentStatus?: "paid" | "pending" };
          setOrder((prev) => ({
            ...prev,
            status: data.status ?? prev.status,
            paymentStatus: data.paymentStatus ?? prev.paymentStatus,
          }));
        }
      } catch {
        // silent — next poll will retry
      }
    };

    const id = setInterval(poll, 5000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [orderId, token]);

  const isCancelled = order.status === "rejected";
  const currentStep = stepIndex(order.status);

  // Customers can edit if the order is still pending or scheduled
  const canEdit = order.status === "pending" || order.status === "scheduled";

  const originalItemsTotal = order.items.reduce((acc, item) => acc + item.price * item.quantity, 0);
  const calculatedDeliveryFee = Math.max(0, order.total - originalItemsTotal);

  const editItemsTotal = editItems.reduce((acc, item) => acc + item.price * item.quantity, 0);
  const editGrandTotal = editItemsTotal + calculatedDeliveryFee;

  const openEditor = async () => {
    setEditItems([...order.items]);
    setEditNote(order.note ?? "");
    setEditOpen(true);
    setEditError(null);

    if (menuItems.length === 0) {
      setLoadingMenu(true);
      try {
        const res = await fetch(`/api/customer/menu?restaurantId=${order.restaurantId}`);
        if (res.ok) {
          const data = await res.json();
          setMenuItems(data.items || []);
        }
      } catch (err) {
        console.error("Menu loading failed", err);
      } finally {
        setLoadingMenu(false);
      }
    }
  };

  const updateQuantity = (id: string, delta: number) => {
    setEditItems((prev) =>
      prev
        .map((item) => {
          if (item.id === id) {
            const nextQty = item.quantity + delta;
            return { ...item, quantity: nextQty };
          }
          return item;
        })
        .filter((item) => item.quantity > 0)
    );
  };

  const addItemToCart = (menuItem: typeof menuItems[0]) => {
    setEditItems((prev) => {
      const existing = prev.find((i) => i.id === menuItem.id);
      if (existing) {
        return prev.map((i) => (i.id === menuItem.id ? { ...i, quantity: i.quantity + 1 } : i));
      }
      return [...prev, { id: menuItem.id, name: menuItem.name, price: menuItem.price, quantity: 1 }];
    });
  };

  const submitEdit = async () => {
    if (editItems.length === 0) {
      setEditError("Your order must contain at least one item.");
      return;
    }

    setSavingEdit(true);
    setEditError(null);

    try {
      const res = await fetch(`/api/orders/${orderId}/edit?t=${token}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: editItems.map((i) => ({ id: i.id, quantity: i.quantity })),
          note: editNote.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setEditError(data.error || "Failed to save adjustments.");
      } else {
        setOrder((prev) => ({
          ...prev,
          items: editItems,
          total: data.total ?? editGrandTotal,
          note: editNote.trim(),
        }));
        setEditOpen(false);
      }
    } catch {
      setEditError("Network error. Please try again.");
    } finally {
      setSavingEdit(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-20 relative">
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
          <div className="flex justify-between items-center mb-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Your Order</p>
            {canEdit && (
              <button
                onClick={openEditor}
                className="text-xs font-bold text-orange-600 hover:text-orange-700 bg-orange-50 hover:bg-orange-100/70 transition-all px-3 py-1.5 rounded-full flex items-center gap-1.5"
              >
                ✏️ Edit Items
              </button>
            )}
          </div>
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

          {order.note && (
            <div className="mb-4 p-3 bg-amber-50/50 border border-amber-100/50 rounded-2xl text-xs text-amber-900 leading-relaxed">
              <span className="font-bold text-[9px] uppercase tracking-wider block text-amber-600 mb-0.5">Kitchen Note</span>
              "{order.note}"
            </div>
          )}

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

        <p className="text-center text-xs text-gray-300 mt-4">Updates appear automatically</p>
      </div>

      {/* Gourmet Customer Cart Customizer Modal */}
      {editOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto">
          <div className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col max-h-[85vh] sm:max-h-[90vh]">
            {/* Modal Header */}
            <div className="px-6 py-4 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="font-black text-gray-900 text-sm uppercase tracking-wider">Modify Your Order</h3>
                <p className="text-[10px] text-gray-400 font-medium">Add/remove dishes before kitchen acceptance</p>
              </div>
              <button
                onClick={() => setEditOpen(false)}
                className="text-gray-400 hover:text-gray-600 font-bold p-1 transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Modal Scroll Area */}
            <div className="p-6 overflow-y-auto flex-1 space-y-6">
              {editError && (
                <div className="p-3 bg-red-50 border border-red-100 text-red-600 rounded-2xl text-xs font-bold leading-relaxed">
                  ⚠️ {editError}
                </div>
              )}

              {/* Cart Section */}
              <div className="space-y-3">
                <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Adjust Quantities</h4>
                {editItems.length === 0 ? (
                  <div className="text-center py-6 text-gray-400 text-xs italic">
                    Your cart is empty. Choose items from the menu below.
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {editItems.map((item) => (
                      <div key={item.id} className="flex justify-between items-center bg-gray-50 border border-gray-100 rounded-2xl p-3">
                        <div className="flex-1 min-w-0 pr-2">
                          <p className="font-bold text-gray-900 text-sm truncate">{item.name}</p>
                          <p className="text-[10px] text-gray-400">₦{item.price.toLocaleString("en-NG")} each</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => updateQuantity(item.id, -1)}
                            className="w-8 h-8 rounded-full border border-gray-200 bg-white hover:bg-gray-100 font-bold text-sm text-gray-600 flex items-center justify-center transition-colors active:scale-90"
                          >
                            –
                          </button>
                          <span className="font-black text-gray-900 text-sm w-6 text-center">{item.quantity}</span>
                          <button
                            onClick={() => updateQuantity(item.id, 1)}
                            className="w-8 h-8 rounded-full border border-gray-200 bg-white hover:bg-gray-100 font-bold text-sm text-gray-600 flex items-center justify-center transition-colors active:scale-90"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Menu items list to add new dishes */}
              <div className="space-y-3 pt-3 border-t border-gray-100">
                <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Add Dishes from Menu</h4>
                {loadingMenu ? (
                  <div className="flex items-center justify-center py-6 gap-2">
                    <span className="w-4 h-4 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
                    <span className="text-xs text-gray-400 font-bold">Loading dishes…</span>
                  </div>
                ) : menuItems.length === 0 ? (
                  <p className="text-center text-xs text-gray-400 py-4 italic">No additional menu items available.</p>
                ) : (
                  <div className="space-y-2.5 max-h-[220px] overflow-y-auto pr-1">
                    {menuItems.map((dish) => {
                      const qty = editItems.find((i) => i.id === dish.id)?.quantity ?? 0;
                      return (
                        <div key={dish.id} className="flex justify-between items-center border border-gray-100 rounded-2xl p-2.5 hover:bg-gray-50 transition-colors">
                          <div className="flex-1 min-w-0 pr-2">
                            <span className="font-bold text-gray-900 text-xs block truncate">{dish.name}</span>
                            <span className="text-[10px] text-gray-400 block font-semibold">₦{dish.price.toLocaleString("en-NG")}</span>
                          </div>
                          <button
                            onClick={() => addItemToCart(dish)}
                            className="px-3.5 py-1.5 bg-orange-600 hover:bg-orange-500 text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition-all active:scale-95 flex items-center gap-1.5"
                          >
                            Add {qty > 0 && <span className="px-1 py-0.2 bg-white/20 rounded font-black text-[9px]">{qty}</span>}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Notes Field */}
              <div className="space-y-1.5 pt-3 border-t border-gray-100">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block">Cooking Notes / Instructions</label>
                <textarea
                  value={editNote}
                  onChange={(e) => setEditNote(e.target.value)}
                  placeholder="E.g. Extra spicy, no onions, delivery instructions..."
                  className="w-full border border-gray-200 rounded-2xl p-3 text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-orange-300 text-gray-800"
                  rows={2}
                />
              </div>
            </div>

            {/* Modal footer summary & buttons */}
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex flex-col gap-3 rounded-b-3xl">
              <div className="flex justify-between items-center px-1 text-xs">
                <span className="font-bold text-gray-500">Revised Total:</span>
                <span className="font-black text-sm text-gray-900">₦{editGrandTotal.toLocaleString("en-NG")}</span>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setEditOpen(false)}
                  disabled={savingEdit}
                  className="flex-1 py-2.5 border border-gray-250 bg-white text-gray-600 hover:bg-gray-100 transition-colors text-xs font-bold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  onClick={submitEdit}
                  disabled={savingEdit}
                  className="flex-1 py-2.5 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white transition-all text-xs font-bold rounded-xl shadow-sm flex items-center justify-center gap-2"
                >
                  {savingEdit ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Saving…
                    </>
                  ) : (
                    "Save Adjustments"
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
