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
  seo?: {
    seoTitle?: string;
    seoDescription?: string;
    serviceAreas?: string;
    foodKeywords?: string;
    googleBusinessUrl?: string;
    instagramUrl?: string;
    tiktokUrl?: string;
  };
}

function fmt(n: number) {
  return `₦${n.toLocaleString("en-NG")}`;
}

function parseList(s?: string): string[] {
  if (!s?.trim()) return [];
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

export default function RestaurantClient({ restaurant, menuItems, seo }: RestaurantClientProps) {
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
  const [activeSection, setActiveSection] = useState("menu");
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const categoryTabsRef = useRef<HTMLDivElement>(null);
  const menuSectionRef = useRef<HTMLElement>(null);
  const aboutSectionRef = useRef<HTMLElement>(null);
  const popularSectionRef = useRef<HTMLElement>(null);
  const faqSectionRef = useRef<HTMLElement>(null);

  const categories = [...new Set(menuItems.map((i) => i.category))].filter(Boolean);
  const filteredItems = activeCategory ? menuItems.filter((i) => i.category === activeCategory) : menuItems;
  const subtotal = totalPrice;
  const effectiveDeliveryFee = deliveryType === "pickup" ? 0 : restaurant.deliveryFee;
  const orderTotal = subtotal + effectiveDeliveryFee;
  const meetsMinimum = restaurant.minimumOrder <= 0 || subtotal >= restaurant.minimumOrder;

  const areas = parseList(seo?.serviceAreas);
  const keywords = parseList(seo?.foodKeywords);
  const popularItems = menuItems.filter((i) => i.available).slice(0, 4);

  const paymentMethods = [
    restaurant.onlinePaymentEnabled ? "Online payment (card/transfer)" : null,
    restaurant.deliveryEnabled ? "Cash on delivery" : null,
    restaurant.pickupEnabled ? "Cash on pickup" : null,
  ].filter(Boolean) as string[];

  const faqs = [
    {
      q: `How long does ${restaurant.name} take to deliver?`,
      a: "Most orders are prepared and dispatched within 20–40 minutes. Delivery time depends on your location.",
    },
    {
      q: `What payment methods does ${restaurant.name} accept?`,
      a: paymentMethods.length > 0
        ? `${restaurant.name} accepts: ${paymentMethods.join(", ")}.`
        : `${restaurant.name} accepts cash on delivery and cash on pickup.`,
    },
    {
      q: `Where does ${restaurant.name} deliver?`,
      a: areas.length > 0
        ? `${restaurant.name} delivers to ${areas.join(", ")} and surrounding areas.`
        : `${restaurant.name} delivers to several locations. Enter your address at checkout to confirm coverage.`,
    },
    {
      q: `What kind of food does ${restaurant.name} serve?`,
      a: keywords.length > 0
        ? `${restaurant.name} serves ${keywords.join(", ")}.`
        : `${restaurant.name} serves a variety of freshly prepared meals. Browse the menu to see all available items.`,
    },
    ...(restaurant.deliveryFee > 0
      ? [{ q: `What is the delivery fee at ${restaurant.name}?`, a: `The delivery fee is ${fmt(restaurant.deliveryFee)}. This is added at checkout.` }]
      : [{ q: `Does ${restaurant.name} offer free delivery?`, a: `Yes — ${restaurant.name} currently offers free delivery on all orders.` }]
    ),
  ];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setCartOpen(false); setCheckoutOpen(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    document.body.style.overflow = cartOpen || checkoutOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [cartOpen, checkoutOpen]);

  useEffect(() => {
    const refs = [
      { id: "menu", ref: menuSectionRef },
      { id: "about", ref: aboutSectionRef },
      { id: "popular", ref: popularSectionRef },
      { id: "faq", ref: faqSectionRef },
    ];
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActiveSection(entry.target.id);
        }
      },
      { rootMargin: "-20% 0px -60% 0px" }
    );
    refs.forEach(({ ref }) => { if (ref.current) observer.observe(ref.current); });
    return () => observer.disconnect();
  }, []);

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const offset = 44;
    const top = el.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top, behavior: "smooth" });
  };

  const openCheckout = () => {
    setCartOpen(false);
    setOrderError(null);
    setCheckoutOpen(true);
  };

  const validateForm = (): string | null => {
    if (!formData.customerName.trim()) return "Please enter your name.";
    if (!formData.phone.trim()) return "Please enter your phone number.";
    if (deliveryType === "delivery" && !formData.address.trim()) return "Please enter your delivery address.";
    if (!meetsMinimum) return `Minimum order is ${fmt(restaurant.minimumOrder)}.`;
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
          {restaurant.name} has received your order and will start preparing it shortly.
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

  const navSections = [
    { id: "menu", label: "Menu" },
    { id: "about", label: "About" },
    ...(popularItems.length > 0 ? [{ id: "popular", label: "Popular" }] : []),
    { id: "faq", label: "FAQ" },
  ];

  // ── Main page ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-white text-gray-900">

      {/* ── HERO ──────────────────────────────────────────────────────────────── */}
      <section className="relative h-[70vh] min-h-[480px] max-h-[760px] overflow-hidden group">
        <img
          src={
            restaurant.coverImage && restaurant.coverImage.startsWith("http")
              ? restaurant.coverImage
              : "https://images.unsplash.com/photo-1544025162-d76694265947?w=1600&auto=format"
          }
          alt={restaurant.name}
          className="w-full h-full object-cover transition-transform duration-[8000ms] group-hover:scale-110"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/45 to-transparent" />

        {/* Open / Closed badge */}
        <div className="absolute top-5 right-5">
          {restaurant.isOpen ? (
            <span className="inline-flex items-center gap-1.5 bg-green-500 text-white text-xs font-bold px-3 py-1.5 rounded-full shadow-lg">
              <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
              Open Now
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 bg-red-500/90 text-white text-xs font-bold px-3 py-1.5 rounded-full shadow-lg">
              <span className="w-1.5 h-1.5 bg-white rounded-full" />
              Closed
            </span>
          )}
        </div>

        {/* Hero content — centered, bottom-anchored */}
        <div className="absolute inset-0 flex flex-col items-center justify-end pb-10 px-6 text-center">
          {restaurant.logo && (
            <div className="w-20 h-20 rounded-2xl border-2 border-white/30 shadow-2xl overflow-hidden mb-4 bg-white/10 backdrop-blur-sm flex-shrink-0">
              <img src={restaurant.logo} alt="logo" className="w-full h-full object-cover" />
            </div>
          )}
          <h1 className="text-4xl md:text-6xl font-black text-white leading-tight mb-2 drop-shadow-2xl tracking-tight">
            {restaurant.name}
          </h1>
          {restaurant.description && (
            <p className="text-white/70 text-sm md:text-base mb-4 max-w-md leading-relaxed">
              {restaurant.description.length > 100 ? restaurant.description.slice(0, 100) + "…" : restaurant.description}
            </p>
          )}
          {/* Stats row */}
          <div className="flex items-center gap-2 flex-wrap justify-center mb-6">
            <span className="bg-white/15 backdrop-blur-sm text-white text-xs font-bold px-3 py-1.5 rounded-full border border-white/20">
              ⭐ 4.5
            </span>
            <span className="bg-white/15 backdrop-blur-sm text-white text-xs font-bold px-3 py-1.5 rounded-full border border-white/20">
              ⏱ 20–35 min
            </span>
            {restaurant.deliveryEnabled && (
              <span className="bg-white/15 backdrop-blur-sm text-white text-xs font-bold px-3 py-1.5 rounded-full border border-white/20">
                🚚 {restaurant.deliveryFee > 0 ? `${fmt(restaurant.deliveryFee)} delivery` : "Free delivery"}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => scrollTo("menu")}
              className="bg-orange-600 hover:bg-orange-500 hover:scale-105 text-white font-bold px-8 py-4 rounded-2xl shadow-lg shadow-orange-600/50 transition-all duration-200 active:scale-95 hover:shadow-xl hover:shadow-orange-600/40"
            >
              Start Order
            </button>
            <button
              onClick={() => scrollTo("menu")}
              className="bg-white/10 hover:bg-white/25 hover:scale-105 text-white font-bold px-8 py-4 rounded-2xl backdrop-blur-sm border border-white/30 transition-all duration-200 active:scale-95"
            >
              View Menu
            </button>
          </div>
        </div>
      </section>

      {/* ── QUICK INFO BAR ────────────────────────────────────────────────────── */}
      <div className="bg-orange-600 px-4 py-3">
        <div className="max-w-4xl mx-auto flex flex-wrap gap-x-5 gap-y-2 text-sm justify-center sm:justify-start">
          {restaurant.deliveryEnabled && (
            <span className="flex items-center gap-1.5 text-white font-semibold">
              <svg className="w-4 h-4 text-white/70 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" />
              </svg>
              {restaurant.deliveryFee > 0 ? `${fmt(restaurant.deliveryFee)} delivery` : "Free delivery"}
            </span>
          )}
          {restaurant.pickupEnabled && (
            <span className="flex items-center gap-1.5 text-white font-semibold">
              <svg className="w-4 h-4 text-white/70 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
              </svg>
              Pickup available
            </span>
          )}
          {restaurant.minimumOrder > 0 && (
            <span className="flex items-center gap-1.5 text-white font-semibold">
              <svg className="w-4 h-4 text-white/70 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 11h.01M12 11h.01M15 11h.01M4 19h16a2 2 0 002-2V7a2 2 0 00-2-2H4a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              Min {fmt(restaurant.minimumOrder)}
            </span>
          )}
          {restaurant.todayHoursLabel && (
            <span className="flex items-center gap-1.5 text-white font-semibold">
              <svg className="w-4 h-4 text-white/70 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {restaurant.todayHoursLabel}
            </span>
          )}
          {restaurant.onlinePaymentEnabled && (
            <span className="flex items-center gap-1.5 text-white font-semibold">
              <svg className="w-4 h-4 text-white/70 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
              </svg>
              Pay online
            </span>
          )}
        </div>
      </div>

      {/* ── TRUST STRIP ───────────────────────────────────────────────────────── */}
      <div className="bg-gray-950 text-white py-3 overflow-x-auto">
        <div className="max-w-4xl mx-auto px-4">
          <div className="flex items-center gap-5 text-xs font-bold min-w-max mx-auto justify-center">
            <span className="text-orange-400">🔥 120+ orders today</span>
            <span className="text-white/20">|</span>
            <span className="text-yellow-300">⭐ Rated 4.6 by customers</span>
            <span className="text-white/20">|</span>
            <span className="text-green-400">⚡ Fast delivery in 20–30 mins</span>
          </div>
        </div>
      </div>

      {/* ── STICKY PAGE NAV ───────────────────────────────────────────────────── */}
      <nav className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm border-b border-gray-100 shadow-sm">
        <div className="max-w-4xl mx-auto px-4 w-full">
          <div className="flex gap-1 overflow-x-auto scrollbar-hide py-2">
            {navSections.map((s) => (
              <button
                key={s.id}
                onClick={() => scrollTo(s.id)}
                className={`flex-shrink-0 px-5 py-2 rounded-full text-sm font-bold transition-all duration-200 ${
                  activeSection === s.id
                    ? "bg-orange-600 text-white shadow-md shadow-orange-600/25 scale-105"
                    : "text-gray-500 hover:text-gray-900 hover:bg-gray-100"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* ── CLOSED BANNER ─────────────────────────────────────────────────────── */}
      {!restaurant.isOpen && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-3 text-center">
          <p className="text-sm font-medium text-amber-700">
            We&apos;re currently closed — browse the menu and come back when we open!
          </p>
        </div>
      )}

      {/* ── MENU SECTION ──────────────────────────────────────────────────────── */}
      <section id="menu" ref={menuSectionRef} className="scroll-mt-11">
        {/* Sticky category tabs */}
        <div className="sticky top-[44px] z-20 bg-white/95 backdrop-blur-sm border-b border-gray-100">
          <div className="max-w-4xl mx-auto">
            <div ref={categoryTabsRef} className="flex gap-2 overflow-x-auto px-4 py-3 scrollbar-hide">
              <button
                onClick={() => setActiveCategory(null)}
                className={`flex-shrink-0 px-4 py-2 rounded-full text-sm font-bold transition-all duration-200 ${
                  activeCategory === null
                    ? "bg-gray-900 text-white shadow-md scale-105"
                    : "text-gray-500 hover:text-gray-900 hover:bg-gray-100"
                }`}
              >
                All
              </button>
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={`flex-shrink-0 px-4 py-2 rounded-full text-sm font-bold transition-all duration-200 ${
                    activeCategory === cat
                      ? "bg-gray-900 text-white shadow-md scale-105"
                      : "text-gray-500 hover:text-gray-900 hover:bg-gray-100"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Menu grid */}
        <div className="max-w-4xl mx-auto px-4 py-8 pb-12">
          {filteredItems.length === 0 ? (
            <div className="text-center py-20">
              <p className="text-gray-400 text-lg font-medium">No items here yet.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {filteredItems.map((item, idx) => {
                const cartItem = items.find((i) => i.id === item.id);
                const qty = cartItem?.quantity ?? 0;
                return (
                  <div
                    key={item.id}
                    className={`group bg-white rounded-3xl border overflow-hidden flex flex-col transition-all duration-300 ${
                      item.available
                        ? "border-gray-100 hover:border-orange-200 hover:shadow-2xl hover:-translate-y-1"
                        : "border-gray-100 opacity-60"
                    }`}
                  >
                    <div className="relative h-48 overflow-hidden bg-gray-100 flex-shrink-0">
                      {idx < 3 && item.available && (
                        <div className="absolute top-3 left-3 z-10 bg-orange-600 text-white text-[10px] font-black px-2.5 py-1 rounded-full shadow-md tracking-wide">
                          🔥 Popular
                        </div>
                      )}
                      <img
                        src={getItemImage(item)}
                        alt={item.name}
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
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
                        <h3 className="font-black text-[15px] text-gray-900 leading-snug">{item.name}</h3>
                        <span className="font-black text-orange-600 text-base flex-shrink-0">{fmt(item.price)}</span>
                      </div>
                      {item.description && (
                        <p className="text-xs text-gray-400 mb-3 leading-relaxed line-clamp-2">{item.description}</p>
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
      </section>

      {/* ── ABOUT SECTION ─────────────────────────────────────────────────────── */}
      <section id="about" ref={aboutSectionRef} className="scroll-mt-11 bg-gray-50 border-t border-gray-100">
        <div className="max-w-4xl mx-auto px-4 py-14">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
            {/* LEFT: description + chips */}
            <div>
              <p className="text-xs font-black text-orange-600 uppercase tracking-widest mb-2">About</p>
              <h2 className="text-2xl font-black text-gray-900 mb-4">About {restaurant.name}</h2>
              {restaurant.description && (
                <p className="text-gray-600 leading-relaxed mb-6">{restaurant.description}</p>
              )}
              {keywords.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {keywords.map((k) => (
                    <span key={k} className="bg-orange-50 text-orange-700 text-sm font-bold px-3 py-1.5 rounded-full border border-orange-100">
                      {k}
                    </span>
                  ))}
                </div>
              )}
            </div>
            {/* RIGHT: info cards */}
            <div className="space-y-3">
              {restaurant.address && (
                <div className="bg-white rounded-2xl border border-gray-100 px-4 py-4 flex items-start gap-3 shadow-sm">
                  <span className="text-2xl flex-shrink-0">📍</span>
                  <div>
                    <p className="text-xs font-black text-gray-400 uppercase tracking-widest mb-0.5">Address</p>
                    <p className="text-sm font-medium text-gray-800">{restaurant.address}</p>
                  </div>
                </div>
              )}
              {restaurant.todayHoursLabel && (
                <div className="bg-white rounded-2xl border border-gray-100 px-4 py-4 flex items-start gap-3 shadow-sm">
                  <span className="text-2xl flex-shrink-0">🕒</span>
                  <div>
                    <p className="text-xs font-black text-gray-400 uppercase tracking-widest mb-0.5">Hours Today</p>
                    <p className="text-sm font-medium text-gray-800">{restaurant.todayHoursLabel}</p>
                  </div>
                </div>
              )}
              <div className="bg-white rounded-2xl border border-gray-100 px-4 py-4 flex items-start gap-3 shadow-sm">
                <span className="text-2xl flex-shrink-0">🚚</span>
                <div>
                  <p className="text-xs font-black text-gray-400 uppercase tracking-widest mb-0.5">Delivery</p>
                  <p className="text-sm font-medium text-gray-800">
                    {restaurant.deliveryEnabled
                      ? restaurant.deliveryFee > 0
                        ? `${fmt(restaurant.deliveryFee)} delivery fee`
                        : "Free delivery on all orders"
                      : "Pickup only"}
                  </p>
                </div>
              </div>
              {areas.length > 0 && (
                <div className="bg-white rounded-2xl border border-gray-100 px-4 py-4 shadow-sm">
                  <p className="text-xs font-black text-gray-400 uppercase tracking-widest mb-3">Delivery Areas</p>
                  <div className="flex flex-wrap gap-1.5">
                    {areas.map((area) => (
                      <span key={area} className="text-xs font-medium text-gray-600 bg-gray-50 border border-gray-100 px-2.5 py-1 rounded-lg">
                        {area}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ── POPULAR SECTION ───────────────────────────────────────────────────── */}
      {popularItems.length > 0 && (
        <section id="popular" ref={popularSectionRef} className="scroll-mt-11 border-t border-gray-100 bg-orange-50/40">
          <div className="max-w-4xl mx-auto px-4 py-14">
            <p className="text-xs font-black text-orange-600 uppercase tracking-widest mb-2">Most Loved</p>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-black text-gray-900">Popular Items</h2>
              <button
                onClick={() => scrollTo("menu")}
                className="text-sm font-bold text-orange-600 hover:text-orange-500 transition-colors"
              >
                View all →
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {popularItems.slice(0, 4).map((item) => {
                const cartItem = items.find((i) => i.id === item.id);
                const qty = cartItem?.quantity ?? 0;
                return (
                  <div key={item.id} className="group bg-white rounded-3xl border border-gray-100 overflow-hidden hover:border-orange-200 hover:shadow-2xl hover:-translate-y-1 transition-all duration-300">
                    <div className="relative h-40 overflow-hidden bg-gray-50">
                      <div className="absolute top-2.5 left-2.5 z-10 bg-orange-600 text-white text-[9px] font-black px-2 py-0.5 rounded-full shadow-md tracking-wide">
                        Most Ordered
                      </div>
                      <img
                        src={getItemImage(item)}
                        alt={item.name}
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                        loading="lazy"
                      />
                    </div>
                    <div className="p-3">
                      <p className="font-black text-gray-900 text-sm leading-snug mb-0.5">{item.name}</p>
                      <p className="text-orange-600 font-black text-sm mb-2">{fmt(item.price)}</p>
                      {qty === 0 ? (
                        <button
                          disabled={!restaurant.isOpen}
                          onClick={() => addToCart({ id: item.id, name: item.name, price: item.price })}
                          className={`w-full py-1.5 rounded-lg text-xs font-bold transition-all ${
                            restaurant.isOpen
                              ? "bg-orange-600 text-white hover:bg-orange-500 active:scale-95"
                              : "bg-gray-100 text-gray-400 cursor-not-allowed"
                          }`}
                        >
                          {restaurant.isOpen ? "Add to Cart" : "Closed"}
                        </button>
                      ) : (
                        <div className="flex items-center justify-between bg-orange-50 rounded-lg px-1 py-0.5">
                          <button onClick={() => updateQuantity(item.id, qty - 1)} className="w-7 h-7 flex items-center justify-center font-bold text-gray-600 hover:text-orange-600 transition-colors">−</button>
                          <span className="font-bold text-orange-600 text-xs">{qty}</span>
                          <button onClick={() => updateQuantity(item.id, qty + 1)} className="w-7 h-7 flex items-center justify-center font-bold text-gray-600 hover:text-orange-600 transition-colors">+</button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* ── FAQ SECTION ───────────────────────────────────────────────────────── */}
      <section id="faq" ref={faqSectionRef} className="scroll-mt-11 bg-gray-50 border-t border-gray-100">
        <div className="max-w-4xl mx-auto px-4 py-14">
          <p className="text-xs font-black text-orange-600 uppercase tracking-widest mb-2">Help</p>
          <h2 className="text-2xl font-black text-gray-900 mb-6">Frequently Asked Questions</h2>
          <div className="space-y-2.5">
            {faqs.map((faq, i) => (
              <div key={i} className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm">
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50 transition-colors"
                >
                  <span className="font-bold text-gray-900 text-sm pr-4">{faq.q}</span>
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-200 ${openFaq === i ? "bg-orange-600 text-white" : "bg-gray-100 text-gray-500"}`}>
                    <svg
                      className={`w-3.5 h-3.5 transition-transform duration-200 ${openFaq === i ? "rotate-180" : ""}`}
                      fill="none" stroke="currentColor" viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                    </svg>
                  </span>
                </button>
                <div className={`grid transition-all duration-300 ease-in-out ${openFaq === i ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
                  <div className="overflow-hidden">
                    <div className="px-5 pb-4 border-t border-gray-50">
                      <p className="text-gray-500 text-sm leading-relaxed pt-3">{faq.a}</p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FOOTER ────────────────────────────────────────────────────────────── */}
      <footer className="border-t border-gray-100 bg-white">
        <div className="max-w-4xl mx-auto px-4 py-12">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
            <div>
              {restaurant.logo && (
                <div className="w-12 h-12 rounded-2xl overflow-hidden mb-3 border border-gray-100 shadow-sm">
                  <img src={restaurant.logo} alt="logo" className="w-full h-full object-cover" />
                </div>
              )}
              <p className="font-black text-gray-900 text-xl">{restaurant.name}</p>
              {restaurant.address && (
                <p className="text-sm text-gray-400 mt-1">{restaurant.address}</p>
              )}
            </div>
            <div className="flex flex-col items-start sm:items-end gap-3">
              <button
                onClick={() => scrollTo("menu")}
                className="bg-orange-600 hover:bg-orange-500 text-white font-bold px-5 py-2.5 rounded-xl text-sm transition-all active:scale-95 hover:shadow-lg hover:shadow-orange-600/25"
              >
                Order Online →
              </button>
              {(seo?.googleBusinessUrl || seo?.instagramUrl || seo?.tiktokUrl) && (
                <div className="flex flex-wrap gap-2">
                  {seo.googleBusinessUrl && (
                    <a href={seo.googleBusinessUrl} target="_blank" rel="noopener noreferrer"
                      className="w-10 h-10 bg-gray-50 rounded-xl border border-gray-100 hover:border-orange-200 hover:bg-orange-50 flex items-center justify-center transition-all group" title="Google Business">
                      <svg className="w-5 h-5 text-gray-500 group-hover:text-orange-600 transition-colors" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 11h8.533c.044.385.067.773.067 1.167C20.6 17.48 16.956 21 11.8 21 6.928 21 3 17.07 3 12.2S6.928 3.4 11.8 3.4c2.418 0 4.444.897 5.995 2.362l-2.43 2.43c-.678-.647-1.854-1.406-3.565-1.406-3.065 0-5.567 2.527-5.567 5.614 0 3.086 2.502 5.613 5.567 5.613 3.559 0 4.892-2.548 5.098-3.875H12V11z"/>
                      </svg>
                    </a>
                  )}
                  {seo.instagramUrl && (
                    <a href={seo.instagramUrl} target="_blank" rel="noopener noreferrer"
                      className="w-10 h-10 bg-gray-50 rounded-xl border border-gray-100 hover:border-orange-200 hover:bg-orange-50 flex items-center justify-center transition-all group" title="Instagram">
                      <svg className="w-5 h-5 text-gray-500 group-hover:text-orange-600 transition-colors" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
                      </svg>
                    </a>
                  )}
                  {seo.tiktokUrl && (
                    <a href={seo.tiktokUrl} target="_blank" rel="noopener noreferrer"
                      className="w-10 h-10 bg-gray-50 rounded-xl border border-gray-100 hover:border-orange-200 hover:bg-orange-50 flex items-center justify-center transition-all group" title="TikTok">
                      <svg className="w-5 h-5 text-gray-500 group-hover:text-orange-600 transition-colors" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.31 6.31 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.19 8.19 0 004.79 1.52V6.75a4.85 4.85 0 01-1.02-.06z"/>
                      </svg>
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="border-t border-gray-100 mt-10 pt-6 text-center">
            <p className="text-xs text-gray-300 font-medium">Powered by RestoFlow</p>
          </div>
        </div>
      </footer>

      {/* ── STICKY CART BAR ───────────────────────────────────────────────────── */}
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
              <span className="font-bold">{fmt(orderTotal)}</span>
            </button>
          </div>
        </div>
      )}

      {/* ── CART DRAWER ───────────────────────────────────────────────────────── */}
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
                      {fmt(item.price * item.quantity)}
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
                  <span className="font-medium text-gray-700">{fmt(subtotal)}</span>
                </div>
                {restaurant.deliveryEnabled && deliveryType === "delivery" && restaurant.deliveryFee > 0 && (
                  <div className="flex justify-between text-sm text-gray-500">
                    <span>Delivery fee</span>
                    <span className="font-medium text-gray-700">{fmt(restaurant.deliveryFee)}</span>
                  </div>
                )}
                <div className="flex justify-between font-black text-base pt-2 border-t border-gray-200">
                  <span>Total</span>
                  <span className="text-orange-600">{fmt(orderTotal)}</span>
                </div>
              </div>

              {restaurant.minimumOrder > 0 && !meetsMinimum && (
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-3 font-medium">
                  Add {fmt(restaurant.minimumOrder - subtotal)} more to meet the minimum order
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

      {/* ── CHECKOUT MODAL ────────────────────────────────────────────────────── */}
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
                      <span className="text-gray-600">{item.quantity}× {item.name}</span>
                      <span className="font-medium text-gray-700">{fmt(item.quantity * item.price)}</span>
                    </div>
                  ))}
                </div>
                <div className="border-t border-gray-200 pt-2 space-y-1.5">
                  <div className="flex justify-between text-sm text-gray-500">
                    <span>Subtotal</span>
                    <span>{fmt(subtotal)}</span>
                  </div>
                  {deliveryType === "delivery" && restaurant.deliveryFee > 0 && (
                    <div className="flex justify-between text-sm text-gray-500">
                      <span>Delivery fee</span>
                      <span>{fmt(restaurant.deliveryFee)}</span>
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
                    <span className="text-orange-600">{fmt(orderTotal)}</span>
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
    </div>
  );
}
