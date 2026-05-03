"use client";

import { useState, useEffect, useRef } from "react";
import { useCart } from "./CartContext";

type DeliveryType = "delivery" | "pickup";

interface MenuItemData {
  id: string;
  name: string;
  price: number;
  category: string;
  available: boolean;
  description: string;
  image?: string;
  restaurantId: string;
}

interface RestaurantClientProps {
  restaurant: {
    name: string;
    description: string;
    coverImage: string;
    logo: string;
    address: string;
    slug: string;
    onlinePaymentEnabled: boolean;
    deliveryFee: number;
    minimumOrder: number;
    isOpen: boolean;
    deliveryEnabled: boolean;
    pickupEnabled: boolean;
    todayHoursLabel: string | null;
  };
  menuItems: MenuItemData[];
}

export default function RestaurantClient({ restaurant, menuItems }: RestaurantClientProps) {
  const { items, addToCart, updateQuantity, clearCart, totalPrice, totalItems } = useCart();

  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [deliveryType, setDeliveryType] = useState<DeliveryType>(
    restaurant.deliveryEnabled ? "delivery" : "pickup"
  );

  const [formData, setFormData] = useState({ customerName: "", phone: "", address: "", note: "" });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [orderSuccess, setOrderSuccess] = useState(false);

  const categoryTabsRef = useRef<HTMLDivElement>(null);

  const categories = [...new Set(menuItems.map((i) => i.category))].filter(Boolean);
  const filteredItems = activeCategory
    ? menuItems.filter((i) => i.category === activeCategory)
    : menuItems;

  const subtotal = totalPrice;
  const effectiveDeliveryFee = deliveryType === "pickup" ? 0 : restaurant.deliveryFee;
  const orderTotal = subtotal + effectiveDeliveryFee;
  const meetsMinimum = restaurant.minimumOrder <= 0 || subtotal >= restaurant.minimumOrder;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setCartOpen(false);
        setCheckoutOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    document.body.style.overflow = cartOpen || checkoutOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [cartOpen, checkoutOpen]);

  const openCheckout = () => {
    setCartOpen(false);
    setOrderError(null);
    setCheckoutOpen(true);
  };

  const validateForm = (): string | null => {
    if (!formData.customerName.trim()) return "Please enter your name.";
    if (!formData.phone.trim()) return "Please enter your phone number.";
    if (deliveryType === "delivery" && !formData.address.trim()) return "Please enter your delivery address.";
    if (!meetsMinimum) return `Minimum order is ₦${restaurant.minimumOrder.toLocaleString("en-NG")}.`;
    return null;
  };

  const buildPayload = () => ({
    restaurantId: restaurant.slug,
    customerName: formData.customerName.trim(),
    phone: formData.phone.trim(),
    address: deliveryType === "delivery" ? formData.address.trim() : (restaurant.address || "Pickup"),
    note: formData.note.trim(),
    deliveryType,
    items: items.map((i) => ({ id: i.id, quantity: i.quantity })),
  });

  const handleCashOrder = async () => {
    const err = validateForm();
    if (err) { setOrderError(err); return; }
    if (isSubmitting) return;
    setIsSubmitting(true);
    setOrderError(null);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
      const data = await res.json();
      if (!res.ok) { setOrderError(data.error ?? "Failed to place order."); return; }
      setOrderId(data.orderId);
      clearCart();
      setFormData({ customerName: "", phone: "", address: "", note: "" });
      setCheckoutOpen(false);
      setOrderSuccess(true);
    } catch {
      setOrderError("Network error. Please check your connection.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOnlinePayment = async () => {
    const err = validateForm();
    if (err) { setOrderError(err); return; }
    if (isSubmitting) return;
    setIsSubmitting(true);
    setOrderError(null);
    try {
      const res = await fetch("/api/orders/initialize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
      const data = await res.json();
      if (!res.ok) { setOrderError(data.error ?? "Could not initialize payment."); setIsSubmitting(false); return; }
      window.location.href = data.authorizationUrl;
    } catch {
      setOrderError("Network error. Please check your connection.");
      setIsSubmitting(false);
    }
  };

  const getItemImage = (item: MenuItemData) => {
    if (item.image && item.image.startsWith("http") && !item.image.includes("placeholder")) return item.image;
    const n = item.name.toLowerCase();
    if (n.includes("chicken")) return "https://images.unsplash.com/photo-1598515214211-89d3c73ae83b?w=600&auto=format";
    if (n.includes("burger")) return "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=600&auto=format";
    if (n.includes("frie") || n.includes("chips")) return "https://images.unsplash.com/photo-1573037153445-5626cc96760e?w=600&auto=format";
    if (n.includes("rice") || n.includes("jollof")) return "https://images.unsplash.com/photo-1534483509719-3feaee7c30da?w=600&auto=format";
    if (n.includes("pasta") || n.includes("spaghetti")) return "https://images.unsplash.com/photo-1516100882582-96c3a05fe590?w=600&auto=format";
    if (n.includes("pizza")) return "https://images.unsplash.com/photo-1513104890138-7c749659a591?w=600&auto=format";
    if (n.includes("drink") || n.includes("juice") || n.includes("soda")) return "https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?w=600&auto=format";
    if (n.includes("cake") || n.includes("dessert") || n.includes("sweet")) return "https://images.unsplash.com/photo-1533134242443-d4fd215305ad?w=600&auto=format";
    if (n.includes("salad")) return "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=600&auto=format";
    if (n.includes("soup") || n.includes("egusi") || n.includes("okra") || n.includes("pepper")) return "https://images.unsplash.com/photo-1547592180-85f173990554?w=600&auto=format";
    if (n.includes("fish") || n.includes("catfish")) return "https://images.unsplash.com/photo-1534482421-64566f976cfa?w=600&auto=format";
    if (n.includes("steak") || n.includes("rib") || n.includes("suya")) return "https://images.unsplash.com/photo-1600891964599-f61ba0e24092?w=600&auto=format";
    return "https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=600&auto=format";
  };

  // ── Success screen ──────────────────────────────────────────────────────────
  if (orderSuccess) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6 text-center">
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mb-6">
          <svg className="w-10 h-10 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="text-3xl font-black text-gray-900 mb-2">Order Received!</h1>
        <p className="text-gray-500 mb-8 max-w-sm leading-relaxed">
          {restaurant.name} has received your order and will start preparing it shortly. You&apos;ll receive a WhatsApp confirmation shortly.
        </p>
        {orderId && (
          <div className="w-full max-w-sm bg-gray-50 border border-gray-100 rounded-2xl p-5 mb-6 text-left">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Order ID</p>
            <p className="font-mono text-sm text-gray-700 mb-4 break-all">{orderId}</p>
            <a
              href={`/track/${orderId}`}
              className="w-full bg-orange-600 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 hover:bg-orange-500 transition-colors"
            >
              Track My Order →
            </a>
          </div>
        )}
        <button
          onClick={() => { setOrderSuccess(false); setOrderId(null); }}
          className="text-sm font-bold text-gray-400 hover:text-gray-700 transition-colors"
        >
          Order Again
        </button>
      </div>
    );
  }

  // ── Main page ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-white text-gray-900">

      {/* HERO */}
      <div className="relative h-64 md:h-80 w-full overflow-hidden">
        <img
          src={
            restaurant.coverImage && restaurant.coverImage.startsWith("http")
              ? restaurant.coverImage
              : "https://images.unsplash.com/photo-1544025162-d76694265947?w=1600&auto=format"
          }
          alt={restaurant.name}
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />

        {/* Open / Closed badge */}
        <div className="absolute top-4 right-4">
          {restaurant.isOpen ? (
            <span className="inline-flex items-center gap-1.5 bg-green-500 text-white text-xs font-bold px-3 py-1.5 rounded-full shadow-lg">
              <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
              Open Now
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 bg-red-500 text-white text-xs font-bold px-3 py-1.5 rounded-full shadow-lg">
              <span className="w-1.5 h-1.5 bg-white rounded-full" />
              Closed
            </span>
          )}
        </div>

        {/* Restaurant info overlay */}
        <div className="absolute bottom-0 left-0 right-0 p-5 flex items-end gap-4">
          {restaurant.logo && (
            <div className="w-16 h-16 md:w-20 md:h-20 rounded-2xl border-2 border-white shadow-xl overflow-hidden flex-shrink-0 bg-white">
              <img src={restaurant.logo} alt="logo" className="w-full h-full object-cover" />
            </div>
          )}
          <div className="text-white pb-1 min-w-0">
            <h1 className="text-2xl md:text-3xl font-black leading-tight truncate">{restaurant.name}</h1>
            {restaurant.address && (
              <p className="text-sm text-white/70 mt-0.5 flex items-center gap-1 truncate">
                <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                {restaurant.address}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* QUICK INFO BAR */}
      <div className="bg-white border-b border-gray-100 px-4 py-4">
        <div className="max-w-4xl mx-auto">
          {restaurant.description && (
            <p className="text-sm text-gray-500 mb-3 leading-relaxed">{restaurant.description}</p>
          )}
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            {restaurant.deliveryEnabled && (
              <span className="flex items-center gap-1.5 text-gray-600">
                <svg className="w-4 h-4 text-orange-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" />
                </svg>
                {restaurant.deliveryFee > 0 ? `₦${restaurant.deliveryFee.toLocaleString("en-NG")} delivery` : "Free delivery"}
              </span>
            )}
            {restaurant.pickupEnabled && (
              <span className="flex items-center gap-1.5 text-gray-600">
                <svg className="w-4 h-4 text-orange-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                </svg>
                Pickup available
              </span>
            )}
            {restaurant.minimumOrder > 0 && (
              <span className="flex items-center gap-1.5 text-gray-600">
                <svg className="w-4 h-4 text-orange-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 11h.01M12 11h.01M15 11h.01M4 19h16a2 2 0 002-2V7a2 2 0 00-2-2H4a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                Min ₦{restaurant.minimumOrder.toLocaleString("en-NG")}
              </span>
            )}
            {restaurant.onlinePaymentEnabled && (
              <span className="flex items-center gap-1.5 text-gray-600">
                <svg className="w-4 h-4 text-orange-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                </svg>
                Online payment
              </span>
            )}
            {restaurant.todayHoursLabel && (
              <span className="flex items-center gap-1.5 text-gray-600">
                <svg className="w-4 h-4 text-orange-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {restaurant.todayHoursLabel}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* CLOSED BANNER */}
      {!restaurant.isOpen && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-3 text-center">
          <p className="text-sm font-medium text-amber-700">We&apos;re currently closed — browse the menu and come back when we open!</p>
        </div>
      )}

      {/* STICKY CATEGORY TABS */}
      <div className="sticky top-0 z-30 bg-white border-b border-gray-100 shadow-sm">
        <div className="max-w-4xl mx-auto">
          <div ref={categoryTabsRef} className="flex gap-1 overflow-x-auto px-4 py-2.5 scrollbar-hide">
            <button
              onClick={() => setActiveCategory(null)}
              className={`flex-shrink-0 px-4 py-2 rounded-full text-sm font-bold transition-all ${
                activeCategory === null
                  ? "bg-orange-600 text-white shadow-sm"
                  : "text-gray-500 hover:text-gray-900 hover:bg-gray-100"
              }`}
            >
              All
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`flex-shrink-0 px-4 py-2 rounded-full text-sm font-bold transition-all ${
                  activeCategory === cat
                    ? "bg-orange-600 text-white shadow-sm"
                    : "text-gray-500 hover:text-gray-900 hover:bg-gray-100"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* MENU GRID */}
      <div className="max-w-4xl mx-auto px-4 py-6 pb-36">
        {filteredItems.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-gray-400 text-lg font-medium">No items here yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredItems.map((item) => {
              const cartItem = items.find((i) => i.id === item.id);
              const qty = cartItem?.quantity ?? 0;
              return (
                <div
                  key={item.id}
                  className={`bg-white rounded-2xl border overflow-hidden flex flex-col transition-all ${
                    item.available
                      ? "border-gray-100 hover:border-orange-200 hover:shadow-md"
                      : "border-gray-100 opacity-60"
                  }`}
                >
                  <div className="relative h-44 overflow-hidden bg-gray-100 flex-shrink-0">
                    <img
                      src={getItemImage(item)}
                      alt={item.name}
                      className="w-full h-full object-cover"
                    />
                    {!item.available && (
                      <div className="absolute inset-0 bg-white/80 flex items-center justify-center">
                        <span className="bg-gray-800 text-white text-xs font-bold px-3 py-1.5 rounded-full">
                          Sold Out
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="p-4 flex flex-col flex-1">
                    <div className="flex justify-between items-start gap-2 mb-1">
                      <h3 className="font-bold text-base text-gray-900 leading-snug">{item.name}</h3>
                      <span className="font-black text-orange-600 text-base flex-shrink-0">
                        ₦{item.price.toLocaleString("en-NG")}
                      </span>
                    </div>
                    {item.description && (
                      <p className="text-xs text-gray-400 mb-3 leading-relaxed line-clamp-2">
                        {item.description}
                      </p>
                    )}
                    <div className="mt-auto">
                      {qty === 0 ? (
                        <button
                          disabled={!item.available || !restaurant.isOpen}
                          onClick={() => addToCart({ id: item.id, name: item.name, price: item.price })}
                          className={`w-full py-2.5 rounded-xl text-sm font-bold transition-all ${
                            item.available && restaurant.isOpen
                              ? "bg-orange-600 text-white hover:bg-orange-500 active:scale-95"
                              : "bg-gray-100 text-gray-400 cursor-not-allowed"
                          }`}
                        >
                          {!restaurant.isOpen ? "Closed" : !item.available ? "Sold Out" : "Add to Cart"}
                        </button>
                      ) : (
                        <div className="flex items-center justify-between bg-orange-50 rounded-xl p-1">
                          <button
                            onClick={() => updateQuantity(item.id, qty - 1)}
                            className="w-9 h-9 bg-white rounded-lg shadow-sm flex items-center justify-center font-bold text-gray-700 hover:bg-orange-600 hover:text-white transition-colors"
                          >
                            −
                          </button>
                          <span className="font-bold text-orange-600 text-sm">{qty}</span>
                          <button
                            onClick={() => updateQuantity(item.id, qty + 1)}
                            className="w-9 h-9 bg-white rounded-lg shadow-sm flex items-center justify-center font-bold text-gray-700 hover:bg-orange-600 hover:text-white transition-colors"
                          >
                            +
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* STICKY CART BAR */}
      {totalItems > 0 && !cartOpen && !checkoutOpen && (
        <div className="fixed bottom-0 left-0 right-0 z-40 p-4 bg-white border-t border-gray-100 shadow-2xl">
          <div className="max-w-4xl mx-auto">
            <button
              onClick={() => setCartOpen(true)}
              className="w-full bg-orange-600 text-white font-bold py-4 rounded-2xl flex items-center justify-between px-5 hover:bg-orange-500 transition-colors shadow-lg shadow-orange-600/20 active:scale-[0.99]"
            >
              <span className="bg-orange-500 text-white text-sm font-black w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0">
                {totalItems}
              </span>
              <span className="font-bold text-base">View Cart</span>
              <span className="font-bold">₦{orderTotal.toLocaleString("en-NG")}</span>
            </button>
          </div>
        </div>
      )}

      {/* CART DRAWER */}
      {cartOpen && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end md:justify-center md:items-end">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setCartOpen(false)}
          />
          <div className="relative bg-white w-full md:w-[420px] md:h-full rounded-t-3xl md:rounded-none flex flex-col max-h-[90vh] md:max-h-full shadow-2xl">
            <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100 flex-shrink-0">
              <h2 className="text-lg font-black text-gray-900">Your Cart ({totalItems})</h2>
              <button
                onClick={() => setCartOpen(false)}
                className="w-9 h-9 bg-gray-100 rounded-full flex items-center justify-center text-gray-600 hover:bg-gray-200 transition-colors font-bold"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {items.map((item) => (
                <div key={item.id} className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm text-gray-900 truncate">{item.name}</p>
                    <p className="text-sm text-orange-600 font-bold">
                      ₦{(item.price * item.quantity).toLocaleString("en-NG")}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 bg-gray-50 rounded-xl p-1 flex-shrink-0">
                    <button
                      onClick={() => updateQuantity(item.id, item.quantity - 1)}
                      className="w-8 h-8 bg-white rounded-lg shadow-sm flex items-center justify-center font-bold text-gray-600 hover:bg-orange-600 hover:text-white transition-colors text-sm"
                    >
                      −
                    </button>
                    <span className="font-bold text-sm w-5 text-center">{item.quantity}</span>
                    <button
                      onClick={() => updateQuantity(item.id, item.quantity + 1)}
                      className="w-8 h-8 bg-white rounded-lg shadow-sm flex items-center justify-center font-bold text-gray-600 hover:bg-orange-600 hover:text-white transition-colors text-sm"
                    >
                      +
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="px-5 py-4 border-t border-gray-100 bg-gray-50 flex-shrink-0">
              <div className="space-y-2 mb-4">
                <div className="flex justify-between text-sm text-gray-500">
                  <span>Subtotal</span>
                  <span className="font-medium text-gray-700">₦{subtotal.toLocaleString("en-NG")}</span>
                </div>
                {restaurant.deliveryEnabled && deliveryType === "delivery" && restaurant.deliveryFee > 0 && (
                  <div className="flex justify-between text-sm text-gray-500">
                    <span>Delivery fee</span>
                    <span className="font-medium text-gray-700">₦{restaurant.deliveryFee.toLocaleString("en-NG")}</span>
                  </div>
                )}
                <div className="flex justify-between font-black text-base pt-2 border-t border-gray-200">
                  <span>Total</span>
                  <span className="text-orange-600">₦{orderTotal.toLocaleString("en-NG")}</span>
                </div>
              </div>

              {restaurant.minimumOrder > 0 && !meetsMinimum && (
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-3 font-medium">
                  Add ₦{(restaurant.minimumOrder - subtotal).toLocaleString("en-NG")} more to meet the minimum order
                </p>
              )}

              <button
                disabled={!restaurant.isOpen || !meetsMinimum}
                onClick={openCheckout}
                className="w-full bg-orange-600 text-white font-bold py-3.5 rounded-xl hover:bg-orange-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.99]"
              >
                {!restaurant.isOpen
                  ? "Restaurant is closed"
                  : !meetsMinimum
                  ? "Add more items"
                  : "Proceed to Checkout →"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CHECKOUT MODAL */}
      {checkoutOpen && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setCheckoutOpen(false)}
          />
          <div className="relative bg-white w-full md:max-w-lg rounded-t-3xl md:rounded-3xl max-h-[95vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100 sticky top-0 bg-white z-10">
              <h2 className="text-lg font-black text-gray-900">Checkout</h2>
              <button
                onClick={() => setCheckoutOpen(false)}
                className="w-9 h-9 bg-gray-100 rounded-full flex items-center justify-center text-gray-600 hover:bg-gray-200 transition-colors font-bold"
              >
                ✕
              </button>
            </div>

            <div className="px-5 py-5 space-y-5">
              {/* Delivery / Pickup toggle */}
              {restaurant.deliveryEnabled && restaurant.pickupEnabled && (
                <div>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Order type</p>
                  <div className="grid grid-cols-2 gap-2 p-1 bg-gray-100 rounded-xl">
                    <button
                      onClick={() => setDeliveryType("delivery")}
                      className={`py-2.5 rounded-lg text-sm font-bold transition-all ${
                        deliveryType === "delivery" ? "bg-white text-orange-600 shadow" : "text-gray-500"
                      }`}
                    >
                      Delivery
                    </button>
                    <button
                      onClick={() => setDeliveryType("pickup")}
                      className={`py-2.5 rounded-lg text-sm font-bold transition-all ${
                        deliveryType === "pickup" ? "bg-white text-orange-600 shadow" : "text-gray-500"
                      }`}
                    >
                      Pickup
                    </button>
                  </div>
                </div>
              )}

              {/* Contact details */}
              <div className="space-y-3">
                <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Your details</p>
                <input
                  type="text"
                  placeholder="Full name *"
                  value={formData.customerName}
                  onChange={(e) => setFormData({ ...formData, customerName: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100 text-gray-900 placeholder-gray-400"
                />
                <input
                  type="tel"
                  placeholder="Phone number *"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100 text-gray-900 placeholder-gray-400"
                />
              </div>

              {/* Delivery address */}
              {deliveryType === "delivery" && (
                <div>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Delivery address</p>
                  <textarea
                    placeholder="Enter your full delivery address *"
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    rows={2}
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100 text-gray-900 placeholder-gray-400 resize-none"
                  />
                </div>
              )}

              {/* Pickup location */}
              {deliveryType === "pickup" && restaurant.address && (
                <div className="bg-orange-50 border border-orange-100 rounded-xl px-4 py-3">
                  <p className="text-xs font-bold text-orange-600 mb-1">Pickup location</p>
                  <p className="text-sm text-orange-700">{restaurant.address}</p>
                </div>
              )}

              {/* Note */}
              <textarea
                placeholder="Special instructions (optional)"
                value={formData.note}
                onChange={(e) => setFormData({ ...formData, note: e.target.value })}
                rows={2}
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100 text-gray-900 placeholder-gray-400 resize-none"
              />

              {/* Order summary */}
              <div className="bg-gray-50 border border-gray-100 rounded-xl p-4">
                <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Order summary</p>
                <div className="space-y-1.5 mb-3">
                  {items.map((item) => (
                    <div key={item.id} className="flex justify-between text-sm">
                      <span className="text-gray-600">
                        {item.quantity}× {item.name}
                      </span>
                      <span className="font-medium text-gray-700">
                        ₦{(item.quantity * item.price).toLocaleString("en-NG")}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="border-t border-gray-200 pt-2 space-y-1.5">
                  <div className="flex justify-between text-sm text-gray-500">
                    <span>Subtotal</span>
                    <span>₦{subtotal.toLocaleString("en-NG")}</span>
                  </div>
                  {deliveryType === "delivery" && restaurant.deliveryFee > 0 && (
                    <div className="flex justify-between text-sm text-gray-500">
                      <span>Delivery fee</span>
                      <span>₦{restaurant.deliveryFee.toLocaleString("en-NG")}</span>
                    </div>
                  )}
                  {deliveryType === "pickup" && (
                    <div className="flex justify-between text-sm text-green-600 font-medium">
                      <span>Pickup savings</span>
                      <span>Free</span>
                    </div>
                  )}
                  <div className="flex justify-between font-black text-base pt-1.5 border-t border-gray-200">
                    <span>Total</span>
                    <span className="text-orange-600">₦{orderTotal.toLocaleString("en-NG")}</span>
                  </div>
                </div>
              </div>

              {orderError && (
                <div className="bg-red-50 border border-red-200 text-red-600 text-sm font-medium px-4 py-3 rounded-xl">
                  {orderError}
                </div>
              )}

              {/* Payment buttons */}
              <div className="space-y-3 pb-2">
                <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Payment method</p>
                {restaurant.onlinePaymentEnabled && (
                  <button
                    onClick={handleOnlinePayment}
                    disabled={isSubmitting}
                    className="w-full bg-orange-600 text-white font-bold py-4 rounded-xl flex items-center justify-center gap-2.5 hover:bg-orange-500 transition-colors disabled:opacity-60 active:scale-[0.99]"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                    </svg>
                    {isSubmitting ? "Redirecting…" : "Pay Online (Paystack)"}
                  </button>
                )}
                <button
                  onClick={handleCashOrder}
                  disabled={isSubmitting}
                  className="w-full bg-gray-900 text-white font-bold py-4 rounded-xl flex items-center justify-center gap-2.5 hover:bg-gray-700 transition-colors disabled:opacity-60 active:scale-[0.99]"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                  {isSubmitting
                    ? "Placing Order…"
                    : deliveryType === "pickup"
                    ? "Pay on Pickup"
                    : "Pay on Delivery"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <footer className="py-8 text-center border-t border-gray-100">
        <p className="text-xs text-gray-300 font-medium">Powered by RestoFlow</p>
      </footer>
    </div>
  );
}
