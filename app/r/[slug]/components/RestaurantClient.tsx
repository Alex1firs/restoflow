"use client";

import { useState, useEffect } from "react";
import { useCart } from "./CartContext";

type View = "home" | "menu" | "cart" | "checkout" | "success";

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
    slug: string;
    onlinePaymentEnabled: boolean;
    deliveryFee: number;
    minimumOrder: number;
    isOpen: boolean;
  };
  menuItems: MenuItemData[];
  initialView?: View;
}

export default function RestaurantClient({ restaurant, menuItems, initialView = "home" }: RestaurantClientProps) {
  const [view, setView] = useState<View>(initialView);
  const [isHydrated, setIsHydrated] = useState(false);
  const { items, addToCart, updateQuantity, totalPrice, clearCart } = useCart();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [formData, setFormData] = useState({ customerName: "", phone: "", address: "", note: "" });

  useEffect(() => { setIsHydrated(true); }, []);

  const handleSetView = (newView: View) => {
    setView(newView);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const validateForm = () => formData.customerName.trim() && formData.phone.trim() && formData.address.trim();

  const itemsSubtotal = totalPrice;
  const orderTotal = itemsSubtotal + restaurant.deliveryFee;

  const checkMinimum = () => {
    if (restaurant.minimumOrder > 0 && itemsSubtotal < restaurant.minimumOrder) {
      setOrderError(`Minimum order is ₦${restaurant.minimumOrder.toLocaleString("en-NG")}. Please add more items.`);
      return false;
    }
    return true;
  };

  const orderPayload = () => ({
    restaurantId: restaurant.slug,
    customerName: formData.customerName,
    phone: formData.phone,
    address: formData.address,
    note: formData.note,
    items: items.map((i) => ({ id: i.id, quantity: i.quantity })),
  });

  const handleCashOrder = async () => {
    if (isSubmitting || items.length === 0 || !validateForm()) return;
    if (!checkMinimum()) return;
    setIsSubmitting(true);
    setOrderError(null);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(orderPayload()),
      });
      const data = await res.json();
      if (!res.ok) { setOrderError(data.error ?? "Failed to place order."); return; }
      setOrderId(data.orderId);
      clearCart();
      setFormData({ customerName: "", phone: "", address: "", note: "" });
      handleSetView("success");
    } catch {
      setOrderError("Network error. Please check your connection.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOnlinePayment = async () => {
    if (isSubmitting || items.length === 0 || !validateForm()) return;
    if (!checkMinimum()) return;
    setIsSubmitting(true);
    setOrderError(null);
    try {
      const res = await fetch("/api/orders/initialize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(orderPayload()),
      });
      const data = await res.json();
      if (!res.ok) { setOrderError(data.error ?? "Could not initialize payment."); setIsSubmitting(false); return; }
      window.location.href = data.authorizationUrl;
    } catch {
      setOrderError("Network error. Please check your connection.");
      setIsSubmitting(false);
    }
  };

  const liveMenuItems = menuItems || [];
  const categories = [...new Set(liveMenuItems.map((i) => i.category))].filter(Boolean);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const filteredItems = activeCategory ? liveMenuItems.filter((i) => i.category === activeCategory) : liveMenuItems;

  const getItemImage = (item: MenuItemData) => {
    if (item.image && !item.image.includes("placeholder")) return item.image;
    const n = item.name.toLowerCase();
    if (n.includes("steak") || n.includes("rib")) return "https://images.unsplash.com/photo-1600891964599-f61ba0e24092?w=800&auto=format";
    if (n.includes("chicken")) return "https://images.unsplash.com/photo-1598515214211-89d3c73ae83b?w=800&auto=format";
    if (n.includes("burger")) return "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=800&auto=format";
    if (n.includes("frie")) return "https://images.unsplash.com/photo-1573037153445-5626cc96760e?w=800&auto=format";
    if (n.includes("salad")) return "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=800&auto=format";
    if (n.includes("cake") || n.includes("dessert")) return "https://images.unsplash.com/photo-1533134242443-d4fd215305ad?w=800&auto=format";
    if (n.includes("pasta") || n.includes("spaghetti")) return "https://images.unsplash.com/photo-1516100882582-96c3a05fe590?w=800&auto=format";
    if (n.includes("pizza")) return "https://images.unsplash.com/photo-1513104890138-7c749659a591?w=800&auto=format";
    if (n.includes("drink") || n.includes("juice") || n.includes("soda")) return "https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?w=800&auto=format";
    return "https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=800&auto=format";
  };

  const cartCount = items.reduce((a, i) => a + i.quantity, 0);

  return (
    <div className="min-h-screen bg-gray-900 text-white font-sans selection:bg-orange-500/30 overflow-x-hidden flex flex-col">

      {/* Closed banner */}
      {!restaurant.isOpen && (
        <div className="bg-red-900/80 border-b border-red-700/50 px-4 py-2.5 text-center">
          <p className="text-sm font-bold text-red-200">We&apos;re currently closed — browse the menu and come back when we open!</p>
        </div>
      )}

      {/* Sticky Navigation */}
      <nav className="sticky top-0 z-50 bg-gray-900/90 backdrop-blur-xl border-b border-white/5 px-4 py-3">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <button onClick={() => handleSetView("home")} className="text-xl font-black italic tracking-tighter hover:text-orange-500 transition-colors uppercase truncate max-w-[40vw]">
            {restaurant.name}
          </button>
          <div className="flex items-center gap-1.5 md:gap-3">
            <button onClick={() => handleSetView("home")} className={`px-3 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all hidden sm:block ${view === "home" ? "bg-white/10 text-orange-500" : "text-gray-400 hover:text-white"}`}>Home</button>
            <button onClick={() => handleSetView("menu")} className={`px-3 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${view === "menu" ? "bg-white/10 text-orange-500" : "text-gray-400 hover:text-white"}`}>Menu</button>
            <button onClick={() => handleSetView("cart")} className="relative bg-orange-600 hover:bg-orange-500 p-2.5 rounded-xl transition-all shadow-lg shadow-orange-600/20 active:scale-95">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" /></svg>
              {cartCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-white text-orange-600 text-[10px] font-black w-5 h-5 flex items-center justify-center rounded-full border-2 border-orange-600 animate-pulse">{cartCount}</span>
              )}
            </button>
          </div>
        </div>
      </nav>

      <main className={`${view === "home" ? "pb-24" : "pb-16"} flex-1`}>
        {!isHydrated && <div className="bg-orange-600/10 border-b border-orange-600/20 text-orange-500 p-2 text-center text-[10px] font-black uppercase tracking-widest">Loading…</div>}

        {/* HOME */}
        {view === "home" && (
          <div className="relative h-[90vh] w-full flex items-center justify-center overflow-hidden">
            <div className="absolute inset-0">
              <img src={restaurant.coverImage && !restaurant.coverImage.includes("placehold.co") ? restaurant.coverImage : "https://images.unsplash.com/photo-1544025162-d76694265947?w=1600&auto=format"} alt={restaurant.name} className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-b from-gray-900/60 via-gray-900/30 to-gray-900" />
              <div className="absolute inset-0 bg-black/20" />
            </div>
            <div className="relative z-10 max-w-5xl mx-auto px-6 text-center">
              {restaurant.isOpen ? (
                <div className="mb-8 inline-flex items-center gap-2 bg-green-500/20 border border-green-500/30 px-5 py-2 rounded-full">
                  <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                  <span className="text-xs font-black uppercase tracking-widest text-green-300">Open Now</span>
                </div>
              ) : (
                <div className="mb-8 inline-flex items-center gap-2 bg-red-500/20 border border-red-500/30 px-5 py-2 rounded-full">
                  <span className="w-2 h-2 bg-red-400 rounded-full" />
                  <span className="text-xs font-black uppercase tracking-widest text-red-300">Currently Closed</span>
                </div>
              )}
              <h1 className="text-6xl md:text-9xl font-black mb-6 text-white italic tracking-tighter uppercase leading-none drop-shadow-2xl">{restaurant.name}</h1>
              <p className="text-lg md:text-xl text-gray-200 mb-12 max-w-2xl mx-auto font-medium leading-relaxed opacity-90 italic">
                {restaurant.description || "Experience the finest culinary delights."}
              </p>
              <button
                onClick={() => handleSetView("menu")}
                className="bg-orange-600 hover:bg-orange-500 text-white font-black py-5 px-14 rounded-3xl transition-all transform hover:scale-105 active:scale-95 text-xl uppercase tracking-widest shadow-[0_0_50px_rgba(234,88,12,0.4)]"
              >
                {restaurant.isOpen ? "Start Your Order" : "View Menu"}
              </button>
              {restaurant.deliveryFee > 0 && (
                <p className="text-xs text-gray-400 mt-4">Delivery fee: ₦{restaurant.deliveryFee.toLocaleString("en-NG")}</p>
              )}
              {restaurant.minimumOrder > 0 && (
                <p className="text-xs text-gray-400 mt-1">Minimum order: ₦{restaurant.minimumOrder.toLocaleString("en-NG")}</p>
              )}
            </div>
          </div>
        )}

        {/* MENU */}
        {view === "menu" && (
          <div className="max-w-6xl mx-auto px-4 pt-8 pb-4">
            <div className="text-center mb-8">
              <h1 className="text-4xl md:text-6xl font-black italic tracking-tighter uppercase">{restaurant.name} <span className="text-orange-500">Menu</span></h1>
            </div>

            {/* Category filter */}
            {categories.length > 1 && (
              <div className="flex gap-2 overflow-x-auto pb-2 mb-8 scrollbar-hide">
                <button
                  onClick={() => setActiveCategory(null)}
                  className={`flex-shrink-0 px-4 py-2 rounded-full text-xs font-black uppercase tracking-widest transition-all ${activeCategory === null ? "bg-orange-600 text-white" : "bg-white/10 text-gray-300 hover:bg-white/20"}`}
                >
                  All
                </button>
                {categories.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setActiveCategory(cat)}
                    className={`flex-shrink-0 px-4 py-2 rounded-full text-xs font-black uppercase tracking-widest transition-all ${activeCategory === cat ? "bg-orange-600 text-white" : "bg-white/10 text-gray-300 hover:bg-white/20"}`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            )}

            {filteredItems.length === 0 ? (
              <div className="bg-white/5 border border-dashed border-white/10 rounded-3xl p-20 text-center text-gray-500">
                <p className="text-xl font-bold">Menu is currently empty.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredItems.map((item) => (
                  <div key={item.id} className="group bg-gray-800/50 border border-white/5 rounded-3xl overflow-hidden flex flex-col transition-all hover:border-orange-600/30 hover:shadow-xl hover:shadow-orange-600/10">
                    <div className="relative h-52 overflow-hidden">
                      <img src={getItemImage(item)} alt={item.name} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" />
                      <div className="absolute inset-0 bg-gradient-to-t from-gray-900/80 via-transparent to-transparent" />
                      <span className="absolute top-3 left-3 bg-orange-600 text-white text-[10px] font-black uppercase px-3 py-1 rounded-full">{item.category}</span>
                      {!item.available && (
                        <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
                          <span className="text-red-400 font-black text-xl uppercase italic border-4 border-red-400 px-4 py-1 rounded-xl -rotate-12">Sold Out</span>
                        </div>
                      )}
                    </div>
                    <div className="p-5 flex flex-col flex-1">
                      <div className="flex justify-between items-start mb-2">
                        <h3 className="font-black text-xl uppercase italic tracking-tight leading-tight flex-1 pr-2">{item.name}</h3>
                        <span className="font-black text-orange-500 text-lg flex-shrink-0">₦{item.price.toLocaleString("en-NG")}</span>
                      </div>
                      <p className="text-sm text-gray-400 mb-5 flex-1 leading-relaxed">{item.description}</p>
                      <button
                        disabled={!item.available || !restaurant.isOpen}
                        onClick={() => addToCart({ id: item.id, name: item.name, price: item.price })}
                        className={`w-full py-3.5 rounded-2xl font-black uppercase text-xs tracking-widest transition-all ${item.available && restaurant.isOpen ? "bg-white text-gray-900 hover:bg-orange-600 hover:text-white active:scale-95" : "bg-gray-700 text-gray-500 cursor-not-allowed"}`}
                      >
                        {!restaurant.isOpen ? "Closed" : item.available ? "Add to Order" : "Sold Out"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* CART */}
        {view === "cart" && (
          <div className="max-w-lg mx-auto px-4 pt-8">
            <h2 className="text-4xl font-black mb-8 italic tracking-tighter uppercase text-center">Your Order</h2>
            {items.length === 0 ? (
              <div className="bg-white/5 border border-white/10 rounded-3xl p-16 text-center">
                <p className="text-gray-400 mb-6 text-lg font-medium italic">Cart is empty</p>
                <button onClick={() => handleSetView("menu")} className="bg-orange-600 text-white font-black py-3 px-8 rounded-2xl uppercase tracking-widest">Back to Menu</button>
              </div>
            ) : (
              <div className="bg-gray-800/30 rounded-3xl border border-white/5 overflow-hidden">
                <div className="p-6 space-y-4">
                  {items.map((item) => (
                    <div key={item.id} className="flex items-center justify-between pb-4 border-b border-white/5 last:border-0 last:pb-0">
                      <div className="flex-1 min-w-0 pr-3">
                        <h4 className="font-bold text-base uppercase truncate">{item.name}</h4>
                        <p className="text-orange-500 font-black text-sm">₦{item.price.toLocaleString("en-NG")}</p>
                      </div>
                      <div className="flex items-center gap-2 bg-white/5 px-2 py-1.5 rounded-xl flex-shrink-0">
                        <button onClick={() => updateQuantity(item.id, item.quantity - 1)} className="w-8 h-8 flex items-center justify-center bg-white/5 hover:bg-orange-600 rounded-lg transition font-black text-sm">−</button>
                        <span className="font-black w-5 text-center text-sm">{item.quantity}</span>
                        <button onClick={() => updateQuantity(item.id, item.quantity + 1)} className="w-8 h-8 flex items-center justify-center bg-white/5 hover:bg-orange-600 rounded-lg transition font-black text-sm">+</button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="px-6 py-4 bg-white/5 border-t border-white/5 space-y-2">
                  <div className="flex justify-between text-sm text-gray-400">
                    <span>Subtotal</span>
                    <span>₦{itemsSubtotal.toLocaleString("en-NG")}</span>
                  </div>
                  {restaurant.deliveryFee > 0 && (
                    <div className="flex justify-between text-sm text-gray-400">
                      <span>Delivery</span>
                      <span>₦{restaurant.deliveryFee.toLocaleString("en-NG")}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-black text-xl pt-2 border-t border-white/10">
                    <span>Total</span>
                    <span className="text-orange-500">₦{orderTotal.toLocaleString("en-NG")}</span>
                  </div>
                </div>

                <div className="p-6 pt-4">
                  {restaurant.minimumOrder > 0 && itemsSubtotal < restaurant.minimumOrder && (
                    <p className="text-xs text-amber-400 bg-amber-400/10 rounded-xl px-4 py-2.5 mb-4 font-medium">
                      Minimum order is ₦{restaurant.minimumOrder.toLocaleString("en-NG")} — add ₦{(restaurant.minimumOrder - itemsSubtotal).toLocaleString("en-NG")} more
                    </p>
                  )}
                  {!restaurant.isOpen ? (
                    <div className="text-center py-4 text-red-400 font-bold text-sm">Restaurant is currently closed</div>
                  ) : (
                    <button
                      onClick={() => handleSetView("checkout")}
                      disabled={restaurant.minimumOrder > 0 && itemsSubtotal < restaurant.minimumOrder}
                      className="w-full bg-orange-600 text-white font-black py-4 rounded-2xl text-sm uppercase tracking-widest shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Proceed to Checkout
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* CHECKOUT */}
        {view === "checkout" && (
          <div className="max-w-4xl mx-auto px-4 pt-8">
            <h2 className="text-4xl font-black mb-8 italic tracking-tighter uppercase text-center">Checkout</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Form */}
              <div className="space-y-4">
                <div className="bg-gray-800/30 p-6 rounded-3xl border border-white/5 space-y-4">
                  <input type="text" placeholder="Full Name *" value={formData.customerName} onChange={(e) => setFormData({ ...formData, customerName: e.target.value })} className="w-full bg-white/5 px-4 py-3.5 rounded-xl border border-white/10 outline-none focus:border-orange-500 text-sm placeholder-gray-500" />
                  <input type="tel" placeholder="Phone *" value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} className="w-full bg-white/5 px-4 py-3.5 rounded-xl border border-white/10 outline-none focus:border-orange-500 text-sm placeholder-gray-500" />
                  <textarea placeholder="Delivery Address *" value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })} rows={3} className="w-full bg-white/5 px-4 py-3.5 rounded-xl border border-white/10 outline-none focus:border-orange-500 text-sm placeholder-gray-500 resize-none" />
                  <textarea placeholder="Special instructions (optional)" value={formData.note} onChange={(e) => setFormData({ ...formData, note: e.target.value })} rows={2} className="w-full bg-white/5 px-4 py-3.5 rounded-xl border border-white/10 outline-none focus:border-orange-500 text-sm placeholder-gray-500 resize-none" />
                </div>

                {orderError && <div className="bg-red-900/50 border border-red-500/30 text-red-300 text-sm font-medium px-4 py-3 rounded-2xl">{orderError}</div>}

                <div className="space-y-3">
                  <p className="text-xs font-black text-gray-500 uppercase tracking-widest">Payment method</p>
                  {restaurant.onlinePaymentEnabled && (
                    <button type="button" onClick={handleOnlinePayment} disabled={isSubmitting} className="w-full bg-orange-600 hover:bg-orange-500 disabled:opacity-60 text-white font-black py-4 rounded-2xl text-sm uppercase tracking-widest flex items-center justify-center gap-3 transition-all active:scale-95">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>
                      {isSubmitting ? "Redirecting…" : "Pay Online"}
                    </button>
                  )}
                  <button type="button" onClick={handleCashOrder} disabled={isSubmitting} className="w-full bg-white/10 hover:bg-white/20 disabled:opacity-60 text-white font-black py-4 rounded-2xl text-sm uppercase tracking-widest flex items-center justify-center gap-3 transition-all active:scale-95">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
                    {isSubmitting ? "Placing Order…" : "Pay on Delivery"}
                  </button>
                </div>
              </div>

              {/* Summary */}
              <div className="bg-gray-800/30 p-6 rounded-3xl border border-white/5">
                <h3 className="font-bold text-lg uppercase mb-5">Order Summary</h3>
                <div className="space-y-3 mb-5">
                  {items.map((item) => (
                    <div key={item.id} className="flex justify-between text-sm">
                      <span className="font-medium text-gray-300">{item.quantity}× {item.name}</span>
                      <span className="text-gray-400">₦{(item.quantity * item.price).toLocaleString("en-NG")}</span>
                    </div>
                  ))}
                </div>
                <div className="border-t border-white/10 pt-4 space-y-2">
                  <div className="flex justify-between text-sm text-gray-400">
                    <span>Subtotal</span><span>₦{itemsSubtotal.toLocaleString("en-NG")}</span>
                  </div>
                  {restaurant.deliveryFee > 0 && (
                    <div className="flex justify-between text-sm text-gray-400">
                      <span>Delivery</span><span>₦{restaurant.deliveryFee.toLocaleString("en-NG")}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-black text-xl pt-2 border-t border-white/10">
                    <span>Total</span><span className="text-orange-500">₦{orderTotal.toLocaleString("en-NG")}</span>
                  </div>
                </div>
                {restaurant.onlinePaymentEnabled && (
                  <p className="text-xs text-gray-500 mt-5 leading-relaxed">Secure payments via Paystack. Funds go directly to the restaurant.</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* SUCCESS */}
        {view === "success" && (
          <div className="max-w-lg mx-auto px-4 py-20 text-center">
            <div className="bg-orange-600 rounded-[2.5rem] p-8 inline-block shadow-2xl mb-10">
              <svg className="w-14 h-14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>
            </div>
            <h2 className="text-5xl font-black mb-4 italic tracking-tighter uppercase">Order Placed!</h2>
            <p className="text-lg text-gray-400 mb-10">Your order has been received. The restaurant will start preparing it shortly.</p>
            <div className="bg-white/5 p-6 rounded-2xl border border-white/10 mb-10">
              <p className="text-xs font-black text-gray-500 uppercase tracking-widest mb-2">Order Reference</p>
              <p className="font-mono font-bold text-orange-500">{orderId}</p>
            </div>
            <button onClick={() => handleSetView("menu")} className="bg-white text-gray-900 font-black py-4 px-10 rounded-2xl uppercase tracking-widest hover:bg-orange-600 hover:text-white transition-all">Order More</button>
          </div>
        )}
      </main>

      <footer className="border-t border-white/5 py-8 px-6">
        <p className="text-[10px] font-medium tracking-widest uppercase text-center opacity-30">© 2026 {restaurant.name}. Powered by RestoFlow.</p>
      </footer>
    </div>
  );
}
