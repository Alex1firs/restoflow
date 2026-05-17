"use client";

import { useState, useMemo, useCallback } from "react";

type MenuItem = {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  available: boolean;
  image: string;
};

type CartItem = MenuItem & { quantity: number };

type PaymentMethod = "cash" | "bank_transfer" | "card" | "unpaid";
type PaymentStatus = "paid" | "unpaid" | "part_paid" | "cancelled";

type CompletedOrder = {
  orderId: string;
  items: { id: string; name: string; price: number; quantity: number }[];
  itemsTotal: number;
  total: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  customerName: string;
  note: string;
  createdAt: Date;
};

type Props = {
  restaurant: { slug: string; name: string };
  menuItems: MenuItem[];
  staffName: string;
  staffId: string;
};

const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  bank_transfer: "Bank Transfer",
  card: "Card / POS Machine",
  unpaid: "Unpaid / Pay Later",
};

const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  paid: "Paid",
  unpaid: "Unpaid",
  part_paid: "Part Paid",
  cancelled: "Cancelled",
};

function fmt(n: number) {
  return `₦${n.toLocaleString("en-NG")}`;
}

export default function POSClient({ restaurant, menuItems, staffName }: Props) {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>("paid");
  const [customerName, setCustomerName] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completedOrder, setCompletedOrder] = useState<CompletedOrder | null>(null);

  const categories = useMemo(() => {
    const cats = Array.from(new Set(menuItems.map((i) => i.category).filter(Boolean))).sort();
    return ["All", ...cats];
  }, [menuItems]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return menuItems.filter((item) => {
      if (!item.available) return false;
      if (activeCategory !== "All" && item.category !== activeCategory) return false;
      if (q && !item.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [menuItems, activeCategory, search]);

  const cartTotal = useMemo(
    () => cart.reduce((sum, item) => sum + item.price * item.quantity, 0),
    [cart]
  );
  const cartCount = useMemo(
    () => cart.reduce((sum, item) => sum + item.quantity, 0),
    [cart]
  );

  const addToCart = useCallback((item: MenuItem) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.id === item.id);
      if (existing) {
        return prev.map((c) => (c.id === item.id ? { ...c, quantity: c.quantity + 1 } : c));
      }
      return [...prev, { ...item, quantity: 1 }];
    });
  }, []);

  const updateQuantity = useCallback((id: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((c) => (c.id === id ? { ...c, quantity: c.quantity + delta } : c))
        .filter((c) => c.quantity > 0)
    );
  }, []);

  const removeFromCart = useCallback((id: string) => {
    setCart((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const resetPOS = () => {
    setCart([]);
    setPaymentMethod("cash");
    setPaymentStatus("paid");
    setCustomerName("");
    setNote("");
    setError(null);
    setCompletedOrder(null);
    setSearch("");
    setActiveCategory("All");
  };

  const handleSubmit = async () => {
    if (cart.length === 0 || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/pos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: cart.map((c) => ({ id: c.id, quantity: c.quantity })),
          paymentMethod,
          paymentStatus,
          customerName: customerName.trim() || "Walk-in Customer",
          note: note.trim(),
          staffName,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to create order");
        return;
      }
      setCompletedOrder({
        orderId: data.orderId,
        items: data.items,
        itemsTotal: data.itemsTotal,
        total: data.total,
        paymentMethod,
        paymentStatus,
        customerName: customerName.trim() || "Walk-in Customer",
        note: note.trim(),
        createdAt: new Date(),
      });
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (completedOrder) {
    return (
      <ReceiptView
        order={completedOrder}
        restaurant={restaurant}
        staffName={staffName}
        onNewOrder={resetPOS}
      />
    );
  }

  return (
    <div className="flex flex-col lg:flex-row flex-1 overflow-hidden" style={{ height: "calc(100vh - 56px)" }}>
      {/* ── LEFT: Menu ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-gray-50">
        {/* Top bar */}
        <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 flex-shrink-0">
          <h1 className="font-black text-gray-900 text-base whitespace-nowrap hidden sm:block">
            POS / Counter Sales
          </h1>
          <div className="flex-1">
            <input
              type="text"
              placeholder="Search menu items..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-orange-500 bg-gray-50"
            />
          </div>
        </div>

        {/* Category tabs */}
        <div className="bg-white border-b border-gray-200 px-4 flex-shrink-0 overflow-x-auto">
          <div className="flex gap-1.5 py-2">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors ${
                  activeCategory === cat
                    ? "bg-orange-600 text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-orange-50 hover:text-orange-700"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Items grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {filteredItems.length === 0 ? (
            <div className="py-20 text-center text-gray-400 text-sm">
              {search ? `No items matching "${search}"` : "No available items in this category."}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
              {filteredItems.map((item) => {
                const inCart = cart.find((c) => c.id === item.id);
                return (
                  <button
                    key={item.id}
                    onClick={() => addToCart(item)}
                    className={`relative bg-white rounded-2xl border-2 p-3 text-left transition-all hover:shadow-md active:scale-95 ${
                      inCart
                        ? "border-orange-500 shadow-sm bg-orange-50/30"
                        : "border-gray-100 hover:border-orange-200"
                    }`}
                  >
                    {inCart && (
                      <span className="absolute top-2 right-2 bg-orange-600 text-white text-xs font-black w-5 h-5 rounded-full flex items-center justify-center leading-none">
                        {inCart.quantity}
                      </span>
                    )}
                    {item.image ? (
                      <div className="w-full h-20 rounded-xl mb-2 overflow-hidden bg-gray-100 flex-shrink-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={item.image}
                          alt={item.name}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    ) : (
                      <div className="w-full h-20 rounded-xl mb-2 bg-orange-50 flex items-center justify-center text-orange-200 text-3xl flex-shrink-0">
                        🍽
                      </div>
                    )}
                    <p className="font-bold text-gray-900 text-sm leading-tight line-clamp-2">
                      {item.name}
                    </p>
                    {item.category && (
                      <p className="text-[11px] text-gray-400 mt-0.5 truncate">{item.category}</p>
                    )}
                    <p className="text-sm font-black text-orange-600 mt-1.5">{fmt(item.price)}</p>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── RIGHT: Cart + Payment ── */}
      <div className="w-full lg:w-[360px] xl:w-[400px] bg-white border-t lg:border-t-0 lg:border-l border-gray-200 flex flex-col flex-shrink-0">
        {/* Cart header */}
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
          <h2 className="font-black text-gray-900 text-sm">
            Current Order{" "}
            {cartCount > 0 && (
              <span className="text-orange-600 font-black">({cartCount})</span>
            )}
          </h2>
          {cart.length > 0 && (
            <button
              onClick={() => setCart([])}
              className="text-xs font-bold text-red-400 hover:text-red-600 transition-colors"
            >
              Clear all
            </button>
          )}
        </div>

        {/* Cart items */}
        <div className="flex-1 overflow-y-auto divide-y divide-gray-50 min-h-0">
          {cart.length === 0 ? (
            <div className="py-16 text-center text-gray-400 text-sm px-6">
              <p className="text-2xl mb-2">🛒</p>
              Tap items from the menu to add them here.
            </div>
          ) : (
            cart.map((item) => (
              <div key={item.id} className="flex items-center gap-2 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-gray-900 text-sm truncate">{item.name}</p>
                  <p className="text-xs text-gray-500">{fmt(item.price)} each</p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => updateQuantity(item.id, -1)}
                    className="w-6 h-6 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-black text-sm flex items-center justify-center leading-none transition-colors"
                  >
                    −
                  </button>
                  <span className="w-7 text-center font-black text-sm tabular-nums">
                    {item.quantity}
                  </span>
                  <button
                    onClick={() => updateQuantity(item.id, 1)}
                    className="w-6 h-6 rounded-full bg-orange-100 hover:bg-orange-200 text-orange-700 font-black text-sm flex items-center justify-center leading-none transition-colors"
                  >
                    +
                  </button>
                </div>
                <p className="text-sm font-black text-gray-900 w-16 text-right flex-shrink-0 tabular-nums">
                  {fmt(item.price * item.quantity)}
                </p>
                <button
                  onClick={() => removeFromCart(item.id)}
                  className="text-gray-300 hover:text-red-500 text-lg leading-none flex-shrink-0 w-5 text-center transition-colors"
                  aria-label="Remove item"
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>

        {/* Payment panel */}
        <div className="border-t border-gray-100 p-4 space-y-3 flex-shrink-0">
          {/* Subtotal */}
          <div className="flex justify-between items-center pb-1">
            <span className="text-sm font-bold text-gray-500">Total</span>
            <span className="text-2xl font-black text-gray-900 tabular-nums">{fmt(cartTotal)}</span>
          </div>

          {/* Customer name */}
          <input
            type="text"
            placeholder="Customer name (optional)"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-orange-500 bg-gray-50 transition-colors"
          />

          {/* Payment method */}
          <div>
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">
              Payment Method
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {(["cash", "bank_transfer", "card", "unpaid"] as PaymentMethod[]).map((pm) => (
                <button
                  key={pm}
                  onClick={() => setPaymentMethod(pm)}
                  className={`py-2 px-2 rounded-xl text-xs font-bold transition-colors text-center leading-tight ${
                    paymentMethod === pm
                      ? "bg-gray-900 text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {PAYMENT_METHOD_LABELS[pm]}
                </button>
              ))}
            </div>
          </div>

          {/* Payment status */}
          <div>
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">
              Payment Status
            </p>
            <div className="grid grid-cols-4 gap-1">
              {(["paid", "unpaid", "part_paid", "cancelled"] as PaymentStatus[]).map((ps) => (
                <button
                  key={ps}
                  onClick={() => setPaymentStatus(ps)}
                  className={`py-1.5 rounded-lg text-[10px] font-bold transition-colors text-center ${
                    paymentStatus === ps
                      ? ps === "paid"
                        ? "bg-green-600 text-white"
                        : ps === "cancelled"
                        ? "bg-red-600 text-white"
                        : "bg-yellow-500 text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {PAYMENT_STATUS_LABELS[ps]}
                </button>
              ))}
            </div>
          </div>

          {/* Note */}
          <input
            type="text"
            placeholder="Order note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-orange-500 bg-gray-50 transition-colors"
          />

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 text-sm text-red-700 font-medium">
              {error}
            </div>
          )}

          {/* Confirm */}
          <button
            onClick={handleSubmit}
            disabled={cart.length === 0 || submitting}
            className="w-full bg-orange-600 hover:bg-orange-500 active:bg-orange-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-black py-3.5 rounded-xl transition-colors text-sm"
          >
            {submitting
              ? "Creating Order…"
              : cart.length === 0
              ? "Add items to confirm"
              : `Confirm Order · ${fmt(cartTotal)}`}
          </button>

          <p className="text-center text-[11px] text-gray-400">
            Cashier: <span className="font-bold text-gray-600">{staffName}</span>
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Receipt ──────────────────────────────────────────────────────────────────

function ReceiptView({
  order,
  restaurant,
  staffName,
  onNewOrder,
}: {
  order: CompletedOrder;
  restaurant: { name: string; slug: string };
  staffName: string;
  onNewOrder: () => void;
}) {
  return (
    <>
      <style>{`
        @media print {
          .pos-no-print { display: none !important; }
          body { background: white !important; margin: 0; }
          .pos-receipt-wrap { max-width: 100%; box-shadow: none !important; }
        }
      `}</style>

      <div className="max-w-md mx-auto px-4 py-8">
        {/* Action bar */}
        <div className="pos-no-print flex items-center justify-between mb-6">
          <button
            onClick={onNewOrder}
            className="flex items-center gap-1.5 text-sm font-bold text-gray-600 hover:text-gray-900 bg-white border border-gray-200 px-4 py-2.5 rounded-xl transition-colors"
          >
            ← New Order
          </button>
          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 text-sm font-bold bg-orange-600 text-white px-4 py-2.5 rounded-xl hover:bg-orange-500 transition-colors"
          >
            Print Receipt
          </button>
        </div>

        {/* Receipt card */}
        <div className="pos-receipt-wrap bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          {/* Header */}
          <div className="text-center px-6 pt-8 pb-5 border-b border-dashed border-gray-200">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">
              Restaflow POS
            </p>
            <h1 className="text-xl font-black text-gray-900">{restaurant.name}</h1>
            <p className="text-xs text-gray-400 mt-2">
              {order.createdAt.toLocaleDateString("en-NG", {
                weekday: "short",
                year: "numeric",
                month: "short",
                day: "numeric",
              })}
              {" · "}
              {order.createdAt.toLocaleTimeString("en-NG", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          </div>

          {/* Order meta */}
          <div className="px-6 py-4 border-b border-dashed border-gray-200 space-y-2">
            <ReceiptRow label="Order #" value={order.orderId.slice(-8).toUpperCase()} mono />
            <ReceiptRow label="Customer" value={order.customerName} />
            <ReceiptRow label="Cashier" value={staffName} />
            <ReceiptRow label="Source" value="Counter / POS" accent />
          </div>

          {/* Items */}
          <div className="px-6 py-4 border-b border-dashed border-gray-200 space-y-2">
            {order.items.map((item) => (
              <div key={item.id} className="flex items-baseline justify-between gap-2">
                <div className="flex items-baseline gap-1.5 min-w-0">
                  <span className="text-gray-400 font-bold text-sm flex-shrink-0">{item.quantity}×</span>
                  <span className="font-bold text-gray-900 text-sm truncate">{item.name}</span>
                </div>
                <span className="font-bold text-gray-900 text-sm flex-shrink-0 tabular-nums">
                  {fmt(item.price * item.quantity)}
                </span>
              </div>
            ))}
          </div>

          {/* Totals */}
          <div className="px-6 py-4 border-b border-dashed border-gray-200 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Subtotal</span>
              <span className="font-bold text-gray-900 tabular-nums">{fmt(order.itemsTotal)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="font-black text-gray-900 text-base">Total</span>
              <span className="font-black text-gray-900 text-xl tabular-nums">{fmt(order.total)}</span>
            </div>
          </div>

          {/* Payment */}
          <div className="px-6 py-4 border-b border-dashed border-gray-200 space-y-2">
            <ReceiptRow label="Payment Method" value={PAYMENT_METHOD_LABELS[order.paymentMethod]} />
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-500 font-bold">Payment Status</span>
              <span
                className={`text-[10px] font-black uppercase px-2 py-1 rounded-full ${
                  order.paymentStatus === "paid"
                    ? "bg-green-100 text-green-700"
                    : order.paymentStatus === "cancelled"
                    ? "bg-red-100 text-red-700"
                    : order.paymentStatus === "part_paid"
                    ? "bg-yellow-100 text-yellow-700"
                    : "bg-gray-100 text-gray-600"
                }`}
              >
                {PAYMENT_STATUS_LABELS[order.paymentStatus]}
              </span>
            </div>
            {order.note && <ReceiptRow label="Note" value={order.note} />}
          </div>

          {/* Footer */}
          <div className="px-6 py-6 text-center">
            <p className="text-xs font-bold text-gray-500">Thank you for your order!</p>
            <p className="text-[10px] text-gray-300 mt-1">Powered by Restaflow</p>
          </div>
        </div>

        {/* Bottom buttons */}
        <div className="pos-no-print mt-6 flex gap-3">
          <button
            onClick={onNewOrder}
            className="flex-1 bg-gray-900 hover:bg-gray-700 text-white font-black py-3.5 rounded-xl transition-colors text-sm"
          >
            New Order
          </button>
          <button
            onClick={() => window.print()}
            className="flex-1 border-2 border-orange-600 text-orange-600 hover:bg-orange-50 font-black py-3.5 rounded-xl transition-colors text-sm"
          >
            Print Receipt
          </button>
        </div>
      </div>
    </>
  );
}

function ReceiptRow({
  label,
  value,
  mono,
  accent,
}: {
  label: string;
  value: string;
  mono?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="flex justify-between items-center text-sm gap-2">
      <span className="text-gray-500 font-bold flex-shrink-0">{label}</span>
      <span
        className={`font-bold text-right truncate ${
          mono ? "font-mono text-xs text-gray-900" : accent ? "text-orange-600" : "text-gray-900"
        }`}
      >
        {value}
      </span>
    </div>
  );
}
