"use client";

import { useState, useEffect, useRef, useCallback } from "react";
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
    primaryColor?: string;
    accentColor?: string;
    promoBanner?: string;
    rating?: number | null;
    ordersToday?: number | null;
    deliveryTime?: string;
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
  isPreview?: boolean;
}

function fmt(n: number) {
  return `₦${n.toLocaleString("en-NG")}`;
}

function parseList(s?: string): string[] {
  if (!s?.trim()) return [];
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

export default function RestaurantClient({ restaurant, menuItems, seo, isPreview }: RestaurantClientProps) {
  const { items, addToCart, updateQuantity, clearCart, totalPrice, totalItems } = useCart();

  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");
  const [isScheduledOrder, setIsScheduledOrder] = useState(false);
  const [scrollY, setScrollY] = useState(0);
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
  const [visibleSections, setVisibleSections] = useState<Set<string>>(new Set());
  const [promoDismissed, setPromoDismissed] = useState(false);

  const categoryTabsRef = useRef<HTMLDivElement>(null);
  const menuSectionRef = useRef<HTMLElement>(null);
  const aboutSectionRef = useRef<HTMLElement>(null);
  const popularSectionRef = useRef<HTMLElement>(null);
  const faqSectionRef = useRef<HTMLElement>(null);

  // Brand colors
  const primary = restaurant.primaryColor || "#c9a452";
  const accent = restaurant.accentColor || primary;
  const rating = restaurant.rating;
  const ordersToday = restaurant.ordersToday;
  const deliveryTime = restaurant.deliveryTime || "20–35 min";

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

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setCartOpen(false); setCheckoutOpen(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Parallax scroll listener
  useEffect(() => {
    const handleScroll = () => {
      // Only track scroll for parallax if near top
      if (window.scrollY < 1000) setScrollY(window.scrollY);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Body scroll lock
  useEffect(() => {
    document.body.style.overflow = cartOpen || checkoutOpen || scheduleOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [cartOpen, checkoutOpen, scheduleOpen]);

  // Active section tracking (sticky nav highlight)
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

  // Section fade-in on scroll
  useEffect(() => {
    const els = document.querySelectorAll("[data-fade]");
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const id = (entry.target as HTMLElement).dataset.fade;
            if (id) setVisibleSections((prev) => new Set([...prev, id]));
          }
        });
      },
      { threshold: 0.06 }
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  const fade = useCallback(
    (id: string) =>
      `transition-all duration-700 ease-out ${
        visibleSections.has(id) ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
      }`,
    [visibleSections]
  );

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

  const handleScheduleSubmit = async () => {
    if (isPreview) {
      setOrderError("Orders cannot be placed in Preview Mode.");
      return;
    }
    if (items.length === 0) {
      setOrderError("Please add items before scheduling");
      return;
    }
    const err = validateForm();
    if (err) { setOrderError(err); return; }
    if (!scheduleDate || !scheduleTime) {
      setOrderError("Please select a date and time");
      return;
    }

    if (isSubmitting) return;
    setIsSubmitting(true);
    setOrderError(null);

    const payload = {
      ...buildPayload(),
      orderType: "scheduled",
      scheduledFor: `${scheduleDate}T${scheduleTime}`,
    };

    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to schedule order");
      }
      setOrderId(data.orderId);
      setIsScheduledOrder(true);
      setOrderSuccess(true);
      clearCart();
    } catch (e: unknown) {
      setOrderError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCashOrder = async () => {
    if (isPreview) {
      setOrderError("Orders cannot be placed in Preview Mode.");
      return;
    }
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
    if (isPreview) {
      setOrderError("Orders cannot be placed in Preview Mode.");
      return;
    }
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
      <div className="min-h-screen bg-[#0d0802] flex flex-col items-center justify-center px-6 text-center">
        <div className="w-20 h-20 bg-[#1a1008] rounded-full flex items-center justify-center mb-6">
          <svg className="w-10 h-10 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="text-3xl font-black text-[#f5e6c8] mb-2">
          {isScheduledOrder ? "Order Scheduled!" : "Order Received!"}
        </h1>
        <p className="text-[#9a8060] mb-8 max-w-sm leading-relaxed">
          {isScheduledOrder
            ? `${restaurant.name} has received your scheduled order and will prepare it for ${new Date(`${scheduleDate}T${scheduleTime}`).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })}.`
            : `${restaurant.name} has received your order and will start preparing it shortly.`}
        </p>
        {orderId && (
          <div className="w-full max-w-sm bg-[#1a1008] border border-[#2e2010] rounded-2xl p-5 mb-6 text-left">
            <p className="text-xs font-bold text-[#9a8060] uppercase tracking-widest mb-1">Order ID</p>
            <p className="font-mono text-sm text-[#f5e6c8] mb-4 break-all">{orderId}</p>
            <a
              href={`/track/${orderId}`}
              style={{ backgroundColor: primary }}
              className="w-full text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 transition-opacity hover:opacity-90"
            >
              Track My Order →
            </a>
          </div>
        )}
        <button
          onClick={() => { setOrderSuccess(false); setOrderId(null); setIsScheduledOrder(false); }}
          className="text-sm font-bold text-[#9a8060] hover:text-[#f5e6c8] transition-colors"
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
    <div className="min-h-screen bg-[#0f0f0f] text-[#f5e6c8] pb-24 relative">
      {isPreview && (
        <div className="bg-amber-500 text-white font-black text-xs tracking-widest uppercase text-center py-2.5 px-4 sticky top-0 z-[100] shadow-md flex items-center justify-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
          PREVIEW MODE - Orders are disabled
        </div>
      )}

      {/* ── HERO ──────────────────────────────────────────────────────────────── */}
      <section className="relative min-h-[92vh] flex flex-col bg-[#0f0f0f] overflow-hidden">

        {/* Top nav bar */}
        <div className="flex items-center justify-between px-6 py-5 z-20 relative">
          {/* Logo / name */}
          <div className="flex items-center gap-3">
            {restaurant.logo ? (
              <div className="w-10 h-10 rounded-xl overflow-hidden border border-white/10">
                <img src={restaurant.logo} alt="logo" className="w-full h-full object-cover" />
              </div>
            ) : (
              <span className="text-white font-black text-xl tracking-tight">
                {restaurant.name.slice(0, 2).toUpperCase()}
              </span>
            )}
          </div>

          {/* Center nav links — desktop */}
          <div className="hidden md:flex items-center gap-8">
            {navSections.map((s) => (
              <button
                key={s.id}
                onClick={() => scrollTo(s.id)}
                className="text-white/60 hover:text-white text-xs font-bold uppercase tracking-[0.2em] transition-colors"
              >
                {s.label}
              </button>
            ))}
          </div>

          {/* Right: status + cart */}
          <div className="flex items-center gap-4">
            {restaurant.isOpen ? (
              <span className="hidden sm:flex items-center gap-1.5 text-green-400 text-xs font-bold">
                <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
                Open Now
              </span>
            ) : (
              <span className="hidden sm:flex items-center gap-1.5 text-red-400 text-xs font-bold">
                <span className="w-1.5 h-1.5 bg-red-400/60 rounded-full" />
                Closed
              </span>
            )}
            <button
              onClick={() => setCartOpen(true)}
              className="relative w-10 h-10 flex items-center justify-center rounded-full border border-white/20 hover:border-white/40 transition-all"
            >
              {totalItems > 0 && (
                <span
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black text-white"
                  style={{ backgroundColor: primary }}
                >
                  {totalItems}
                </span>
              )}
              <svg className="w-5 h-5 text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
              </svg>
            </button>
          </div>
        </div>

        {/* Hero body */}
        <div className="flex-1 relative flex flex-col items-center justify-center">

          {/* Category label */}
          <p className="text-white/40 text-[10px] md:text-xs font-black uppercase tracking-[0.5em] mb-4 z-10 relative">
            {restaurant.todayHoursLabel
              ? `Today · ${restaurant.todayHoursLabel}`
              : restaurant.isOpen ? "Open Now · Order Online" : "Browse Menu"}
          </p>

          {/* Huge restaurant name — behind the image */}
          <div className="absolute inset-0 flex items-center justify-center px-4 overflow-hidden pointer-events-none select-none">
            <h1
              className="font-black uppercase text-center leading-none"
              style={{
                fontSize: "clamp(3.5rem, 16vw, 14rem)",
                color: primary,
                lineHeight: 0.85,
                letterSpacing: "-0.02em",
              }}
            >
              {restaurant.name}
            </h1>
          </div>

          {/* Circular food image — overlaid on top of name */}
          <div className="relative z-10 w-64 h-64 sm:w-80 sm:h-80 md:w-[420px] md:h-[420px] rounded-full overflow-hidden shadow-[0_20px_80px_rgba(0,0,0,0.9)] border border-white/5 my-8">
            <img
              src={
                restaurant.coverImage && restaurant.coverImage.startsWith("http")
                  ? restaurant.coverImage
                  : "https://images.unsplash.com/photo-1544025162-d76694265947?w=1600&auto=format"
              }
              alt={restaurant.name}
              className="w-full h-full object-cover"
            />
          </div>

          {/* Left circle CTA — desktop */}
          <button
            onClick={() => scrollTo("menu")}
            className="absolute left-8 md:left-20 top-1/2 -translate-y-1/2 z-20 hidden md:flex items-center justify-center w-28 h-28 rounded-full border-2 border-white/20 hover:border-white/50 transition-all hover:scale-105 group"
          >
            <span className="text-white/70 group-hover:text-white text-[11px] font-black uppercase tracking-widest text-center leading-tight transition-colors">
              Order<br />Now
            </span>
          </button>

          {/* Right circle CTA — desktop */}
          <button
            onClick={() => scrollTo("menu")}
            className="absolute right-8 md:right-20 top-1/2 -translate-y-1/2 z-20 hidden md:flex items-center justify-center w-28 h-28 rounded-full border-2 transition-all hover:scale-105 group"
            style={{ borderColor: primary + "60" }}
          >
            <span
              className="text-[11px] font-black uppercase tracking-widest text-center leading-tight transition-colors group-hover:opacity-100 opacity-70"
              style={{ color: primary }}
            >
              View<br />Menu
            </span>
          </button>
        </div>

        {/* Mobile CTAs */}
        <div className="flex gap-3 justify-center px-6 pb-6 md:hidden relative z-20">
          <button
            onClick={() => scrollTo("menu")}
            style={{ backgroundColor: primary }}
            className="flex-1 text-white font-black py-4 rounded-2xl text-xs uppercase tracking-widest active:scale-95 transition-transform"
          >
            Order Now
          </button>
          <button
            onClick={() => scrollTo("menu")}
            className="flex-1 border border-white/20 text-white/80 font-black py-4 rounded-2xl text-xs uppercase tracking-widest active:scale-95 transition-transform"
          >
            View Menu
          </button>
        </div>

        {/* Stats strip */}
        <div className="flex justify-center gap-6 pb-6 relative z-10 flex-wrap px-4">
          {rating && <span className="text-white/40 text-xs font-bold">⭐ {rating}</span>}
          <span className="text-white/40 text-xs font-bold">⏱ {deliveryTime}</span>
          {restaurant.deliveryEnabled && (
            <span className="text-white/40 text-xs font-bold">
              🚚 {restaurant.deliveryFee > 0 ? fmt(restaurant.deliveryFee) : "Free delivery"}
            </span>
          )}
        </div>
      </section>

      {/* ── QUICK INFO BAR ────────────────────────────────────────────────────── */}
      <div className="bg-[#0d0802] border-t border-b border-[#2e2010] px-4 py-5">
        <div className="max-w-4xl mx-auto grid grid-cols-1 sm:grid-cols-3 gap-4 text-center sm:divide-x divide-[#2e2010]">
          {/* Column 1: Location */}
          <div className="flex flex-col items-center gap-1">
            <p className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: primary }}>Location</p>
            <p className="text-sm font-semibold text-[#f5e6c8] leading-snug">
              {restaurant.address || restaurant.name}
            </p>
          </div>
          {/* Column 2: Opening Hours */}
          <div className="flex flex-col items-center gap-1">
            <p className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: primary }}>Hours Today</p>
            <p className="text-sm font-semibold text-[#f5e6c8] leading-snug">
              {restaurant.todayHoursLabel || (restaurant.isOpen ? "Open Now" : "Closed")}
            </p>
          </div>
          {/* Column 3: Delivery / Contact */}
          <div className="flex flex-col items-center gap-1">
            <p className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: primary }}>Delivery</p>
            <p className="text-sm font-semibold text-[#f5e6c8] leading-snug">
              {restaurant.deliveryEnabled
                ? restaurant.deliveryFee > 0
                  ? `${fmt(restaurant.deliveryFee)} fee · ${deliveryTime}`
                  : `Free · ${deliveryTime}`
                : restaurant.pickupEnabled
                ? "Pickup only"
                : deliveryTime}
            </p>
          </div>
        </div>
      </div>

      {/* ── TRUST STRIP ───────────────────────────────────────────────────────── */}
      <div className="bg-[#0a0600] text-[#f5e6c8] py-3 overflow-x-auto">
        <div className="max-w-4xl mx-auto px-4">
          <div className="flex items-center gap-5 text-xs font-bold min-w-max mx-auto justify-center">
            {ordersToday ? (
              <>
                <span style={{ color: accent }}>🔥 {ordersToday}+ orders today</span>
                <span className="text-[#2e2010]">|</span>
              </>
            ) : (
              <>
                <span style={{ color: accent }}>⚡ Trending now</span>
                <span className="text-[#2e2010]">|</span>
              </>
            )}
            {rating && (
              <>
                <span className="text-yellow-400">⭐ Rated {rating} by customers</span>
                <span className="text-[#2e2010]">|</span>
              </>
            )}
            <span className="text-green-500">⚡ Fast delivery in {deliveryTime}</span>
          </div>
        </div>
      </div>

      {/* ── PROMO BANNER ──────────────────────────────────────────────────────── */}
      {restaurant.promoBanner && !promoDismissed && (
        <div className="bg-gradient-to-r from-amber-500 to-orange-500 text-white px-4 py-3">
          <div className="max-w-4xl mx-auto flex items-center justify-between gap-4">
            <p className="text-sm font-bold">🎉 {restaurant.promoBanner}</p>
            <button
              onClick={() => setPromoDismissed(true)}
              className="text-white/70 hover:text-white flex-shrink-0 text-xl leading-none font-bold transition-colors"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* ── STICKY PAGE NAV ───────────────────────────────────────────────────── */}
      <nav className="sticky top-0 z-30 bg-[#0d0802]/95 backdrop-blur-sm border-b border-[#2e2010] shadow-sm">
        <div className="max-w-4xl mx-auto px-4 w-full">
          <div className="flex gap-1 overflow-x-auto scrollbar-hide py-2">
            {navSections.map((s) => (
              <button
                key={s.id}
                onClick={() => scrollTo(s.id)}
                style={activeSection === s.id ? { backgroundColor: primary } : {}}
                className={`flex-shrink-0 px-5 py-2 rounded-full text-sm font-bold transition-all duration-200 ${
                  activeSection === s.id
                    ? "text-white shadow-md scale-105"
                    : "text-[#9a8060] hover:text-[#f5e6c8] hover:bg-[#1a1008]"
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
        <div className="bg-[#0a0600] border-t border-[#2e2010] px-4 py-4">
          <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="text-2xl flex-shrink-0">🌙</span>
              <div>
                <p className="text-[#f5e6c8] font-black text-sm">We&apos;re closed right now</p>
                {restaurant.todayHoursLabel ? (
                  <p className="text-[#9a8060] text-xs mt-0.5">
                    Hours today: {restaurant.todayHoursLabel} — browse the menu and order when we open!
                  </p>
                ) : (
                  <p className="text-[#9a8060] text-xs mt-0.5">
                    Browse the menu and place your order when we open.
                  </p>
                )}
              </div>
            </div>
              <div className="flex gap-2">
                <button
                  onClick={() => scrollTo("menu")}
                  className="flex-shrink-0 bg-[#1a1008] hover:bg-[#2e2010] text-[#f5e6c8] text-xs font-bold px-4 py-2 rounded-xl border border-[#3a2518] transition-all"
                >
                  Browse Menu →
                </button>
                <button
                  onClick={() => setScheduleOpen(true)}
                  className="flex-shrink-0 bg-[#0d0802] hover:bg-[#1a1008] text-[#9a8060] text-xs font-bold px-4 py-2 rounded-xl border border-[#2e2010] transition-all"
                >
                  Schedule Order
                </button>
              </div>
          </div>
        </div>
      )}

      {/* ── MENU SECTION ──────────────────────────────────────────────────────── */}
      <section id="menu" ref={menuSectionRef} className="scroll-mt-11">
        {/* Aurelio-inspired menu section header */}
        <div className="max-w-4xl mx-auto px-4 pt-10 pb-4">
          <p className="text-xs font-black uppercase tracking-[0.2em] mb-2" style={{ color: primary }}>Our Menu</p>
          <h2 className="text-3xl font-black text-[#f5e6c8]">
            {restaurant.name}
          </h2>
          {restaurant.description && (
            <p className="text-[#9a8060] mt-2 max-w-md text-sm leading-relaxed">
              {restaurant.description.slice(0, 120)}
            </p>
          )}
        </div>

        {/* Sticky category tabs */}
        <div className="sticky top-[44px] z-20 bg-[#0d0802]/95 backdrop-blur-sm border-b border-[#2e2010]">
          <div className="max-w-4xl mx-auto">
            <div ref={categoryTabsRef} className="flex gap-2 overflow-x-auto px-4 py-3 scrollbar-hide">
              <button
                onClick={() => { setActiveCategory(null); scrollTo("menu"); }}
                style={activeCategory === null ? { backgroundColor: primary } : {}}
                className={`flex-shrink-0 px-4 py-2 rounded-full text-sm font-bold transition-all duration-200 ${
                  activeCategory === null
                    ? "text-white shadow-md scale-105"
                    : "text-[#9a8060] hover:text-[#f5e6c8] hover:bg-[#1a1008]"
                }`}
              >
                All
              </button>
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => { setActiveCategory(cat); scrollTo("menu"); }}
                  style={activeCategory === cat ? { backgroundColor: primary } : {}}
                  className={`flex-shrink-0 px-4 py-2 rounded-full text-sm font-bold transition-all duration-200 ${
                    activeCategory === cat
                      ? "text-white shadow-md scale-105"
                      : "text-[#9a8060] hover:text-[#f5e6c8] hover:bg-[#1a1008]"
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
              <p className="text-[#9a8060] text-lg font-medium">No items here yet.</p>
            </div>
          ) : (
            <div
              data-fade="menu-grid"
              className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 ${fade("menu-grid")}`}
            >
              {filteredItems.map((item, idx) => {
                const cartItem = items.find((i) => i.id === item.id);
                const qty = cartItem?.quantity ?? 0;
                return (
                  <div
                    key={item.id}
                    className={`group bg-[#1a1008] rounded-3xl border overflow-hidden flex flex-col transition-all duration-300 ${
                      item.available
                        ? "border-[#2e2010] hover:border-[#4a3520] hover:shadow-[0_8px_32px_rgba(0,0,0,0.5)] hover:-translate-y-1"
                        : "border-[#2e2010] opacity-60"
                    }`}
                  >
                    <div className="relative h-48 overflow-hidden bg-[#211508] flex-shrink-0">
                      {idx < 3 && item.available && (
                        <div
                          style={{ backgroundColor: primary }}
                          className="absolute top-3 left-3 z-10 text-white text-[10px] font-black px-2.5 py-1 rounded-full shadow-md tracking-wide"
                        >
                          🔥 Popular
                        </div>
                      )}
                      <img
                        src={getItemImage(item)}
                        alt={item.name}
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                      />
                      {!item.available && (
                        <div className="absolute inset-0 bg-[#0d0802]/80 flex items-center justify-center">
                          <span className="bg-[#1a1008] text-[#9a8060] text-xs font-bold px-3 py-1.5 rounded-full border border-[#2e2010]">
                            Sold Out
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="p-4 flex flex-col flex-1">
                      <div className="flex justify-between items-start gap-2 mb-1">
                        <h3 className="font-black text-[15px] text-[#f5e6c8] leading-snug">{item.name}</h3>
                        <span className="font-black text-base flex-shrink-0" style={{ color: primary }}>{fmt(item.price)}</span>
                      </div>
                      {item.description && (
                        <p className="text-xs text-[#9a8060] mb-3 leading-relaxed line-clamp-2">{item.description}</p>
                      )}
                      <div className="mt-auto">
                        {qty === 0 ? (
                          <button
                            disabled={!item.available || !restaurant.isOpen}
                            onClick={() => addToCart({ id: item.id, name: item.name, price: item.price })}
                            style={item.available && restaurant.isOpen ? { backgroundColor: primary } : {}}
                            className={`w-full py-2.5 rounded-xl text-sm font-bold transition-all ${
                              item.available && restaurant.isOpen
                                ? "text-white hover:opacity-90 active:scale-95 hover:shadow-[0_4px_14px_0_rgba(0,0,0,0.39)]"
                                : "bg-[#211508] text-[#9a8060] cursor-not-allowed"
                            }`}
                            onMouseEnter={(e) => {
                              if (item.available && restaurant.isOpen) e.currentTarget.style.boxShadow = `0 4px 14px 0 ${primary}66`;
                            }}
                            onMouseLeave={(e) => {
                              if (item.available && restaurant.isOpen) e.currentTarget.style.boxShadow = "";
                            }}
                          >
                            {!restaurant.isOpen ? "Closed" : !item.available ? "Sold Out" : "+ Add"}
                          </button>
                        ) : (
                          <div className="flex items-center justify-between bg-[#241808] rounded-xl p-1">
                            <button
                              onClick={() => updateQuantity(item.id, qty - 1)}
                              className="w-9 h-9 bg-[#1a1008] rounded-lg flex items-center justify-center font-bold text-[#9a8060] hover:text-white transition-all"
                              style={{ ["--hover-bg" as string]: primary }}
                              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = primary)}
                              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "")}
                            >
                              −
                            </button>
                            <span className="font-bold text-sm" style={{ color: primary }}>{qty}</span>
                            <button
                              onClick={() => updateQuantity(item.id, qty + 1)}
                              className="w-9 h-9 bg-[#1a1008] rounded-lg flex items-center justify-center font-bold text-[#9a8060] transition-all"
                              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = primary; e.currentTarget.style.color = "white"; }}
                              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ""; e.currentTarget.style.color = ""; }}
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
      <section id="about" ref={aboutSectionRef} className="scroll-mt-11 bg-[#0a0600] border-t border-[#2e2010]">
        <div className="max-w-4xl mx-auto px-4 py-14">
          <div
            data-fade="about"
            className={`grid grid-cols-1 md:grid-cols-2 gap-10 ${fade("about")}`}
          >
            {/* LEFT */}
            <div>
              <p className="text-xs font-black uppercase tracking-widest mb-2" style={{ color: primary }}>About</p>
              <h2 className="text-2xl font-black text-[#f5e6c8] mb-4">About {restaurant.name}</h2>
              {restaurant.description && (
                <p className="text-[#9a8060] leading-relaxed mb-6">{restaurant.description}</p>
              )}
              {keywords.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {keywords.map((k) => (
                    <span
                      key={k}
                      className="text-sm font-bold px-3 py-1.5 rounded-full border"
                      style={{ backgroundColor: primary + "15", color: primary, borderColor: primary + "30" }}
                    >
                      {k}
                    </span>
                  ))}
                </div>
              )}
            </div>
            {/* RIGHT: info cards */}
            <div className="space-y-3">
              {restaurant.address && (
                <div className="bg-[#1a1008] rounded-2xl border border-[#2e2010] px-4 py-4 flex items-start gap-3">
                  <span className="text-2xl flex-shrink-0">📍</span>
                  <div>
                    <p className="text-xs font-black uppercase tracking-widest mb-0.5" style={{ color: primary }}>Address</p>
                    <p className="text-sm font-medium text-[#f5e6c8]">{restaurant.address}</p>
                  </div>
                </div>
              )}
              {restaurant.todayHoursLabel && (
                <div className="bg-[#1a1008] rounded-2xl border border-[#2e2010] px-4 py-4 flex items-start gap-3">
                  <span className="text-2xl flex-shrink-0">🕒</span>
                  <div>
                    <p className="text-xs font-black uppercase tracking-widest mb-0.5" style={{ color: primary }}>Hours Today</p>
                    <p className="text-sm font-medium text-[#f5e6c8]">{restaurant.todayHoursLabel}</p>
                  </div>
                </div>
              )}
              <div className="bg-[#1a1008] rounded-2xl border border-[#2e2010] px-4 py-4 flex items-start gap-3">
                <span className="text-2xl flex-shrink-0">🚚</span>
                <div>
                  <p className="text-xs font-black uppercase tracking-widest mb-0.5" style={{ color: primary }}>Delivery</p>
                  <p className="text-sm font-medium text-[#f5e6c8]">
                    {restaurant.deliveryEnabled
                      ? restaurant.deliveryFee > 0
                        ? `${fmt(restaurant.deliveryFee)} delivery fee`
                        : "Free delivery on all orders"
                      : "Pickup only"}
                  </p>
                </div>
              </div>
              {areas.length > 0 && (
                <div className="bg-[#1a1008] rounded-2xl border border-[#2e2010] px-4 py-4">
                  <p className="text-xs font-black uppercase tracking-widest mb-3" style={{ color: primary }}>Delivery Areas</p>
                  <div className="flex flex-wrap gap-1.5">
                    {areas.map((area) => (
                      <span key={area} className="text-xs font-medium text-[#9a8060] bg-[#211508] border border-[#2e2010] px-2.5 py-1 rounded-lg">
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
        <section id="popular" ref={popularSectionRef} className="scroll-mt-11 border-t border-[#2e2010] bg-[#0d0802]">
          <div className="max-w-4xl mx-auto px-4 py-14">
            <div data-fade="popular" className={fade("popular")}>
              <p className="text-xs font-black uppercase tracking-widest mb-2" style={{ color: primary }}>Chef&apos;s Special</p>
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-black text-[#f5e6c8]">Top Picks</h2>
                <button
                  onClick={() => scrollTo("menu")}
                  className="text-sm font-bold transition-colors hover:opacity-70"
                  style={{ color: primary }}
                >
                  View all →
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                {popularItems.slice(0, 4).map((item) => {
                  const cartItem = items.find((i) => i.id === item.id);
                  const qty = cartItem?.quantity ?? 0;
                  return (
                    <div key={item.id} className="group bg-[#1a1008] rounded-3xl border border-[#2e2010] overflow-hidden hover:border-[#4a3520] hover:shadow-[0_8px_32px_rgba(0,0,0,0.5)] hover:-translate-y-1 transition-all duration-300">
                      <div className="relative h-40 overflow-hidden bg-[#211508]">
                        <div
                          style={{ backgroundColor: primary }}
                          className="absolute top-2.5 left-2.5 z-10 text-white text-[9px] font-black px-2 py-0.5 rounded-full shadow-md tracking-wide"
                        >
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
                        <p className="font-black text-[#f5e6c8] text-sm leading-snug mb-0.5">{item.name}</p>
                        <p className="font-black text-sm mb-2" style={{ color: primary }}>{fmt(item.price)}</p>
                        {qty === 0 ? (
                          <button
                            disabled={!restaurant.isOpen}
                            onClick={() => addToCart({ id: item.id, name: item.name, price: item.price })}
                            style={restaurant.isOpen ? { backgroundColor: primary } : {}}
                            className={`w-full py-1.5 rounded-lg text-xs font-bold transition-all ${
                              restaurant.isOpen
                                ? "text-white hover:opacity-90 active:scale-95 hover:shadow-[0_4px_14px_0_rgba(0,0,0,0.39)]"
                                : "bg-[#211508] text-[#9a8060] cursor-not-allowed"
                            }`}
                            onMouseEnter={(e) => {
                              if (restaurant.isOpen) e.currentTarget.style.boxShadow = `0 4px 14px 0 ${primary}66`;
                            }}
                            onMouseLeave={(e) => {
                              if (restaurant.isOpen) e.currentTarget.style.boxShadow = "";
                            }}
                          >
                            {restaurant.isOpen ? "+ Add" : "Closed"}
                          </button>
                        ) : (
                          <div className="flex items-center justify-between bg-[#241808] rounded-lg px-1 py-0.5">
                            <button onClick={() => updateQuantity(item.id, qty - 1)} className="w-7 h-7 flex items-center justify-center font-bold text-[#9a8060] hover:text-[#f5e6c8] transition-colors">−</button>
                            <span className="font-bold text-xs" style={{ color: primary }}>{qty}</span>
                            <button onClick={() => updateQuantity(item.id, qty + 1)} className="w-7 h-7 flex items-center justify-center font-bold text-[#9a8060] hover:text-[#f5e6c8] transition-colors">+</button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ── FAQ SECTION ───────────────────────────────────────────────────────── */}
      <section id="faq" ref={faqSectionRef} className="scroll-mt-11 bg-[#0a0600] border-t border-[#2e2010]">
        <div className="max-w-4xl mx-auto px-4 py-14">
          <div data-fade="faq" className={fade("faq")}>
            <p className="text-xs font-black uppercase tracking-widest mb-2" style={{ color: primary }}>Help</p>
            <h2 className="text-2xl font-black text-[#f5e6c8] mb-6">Frequently Asked Questions</h2>
            <div className="space-y-2.5">
              {faqs.map((faq, i) => (
                <div key={i} className="bg-[#1a1008] border border-[#2e2010] rounded-2xl overflow-hidden">
                  <button
                    onClick={() => setOpenFaq(openFaq === i ? null : i)}
                    className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-[#211508] transition-colors"
                  >
                    <span className="font-bold text-[#f5e6c8] text-sm pr-4">{faq.q}</span>
                    <span
                      className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-200"
                      style={openFaq === i ? { backgroundColor: primary } : { backgroundColor: "#2e2010", color: "#9a8060" }}
                    >
                      <svg
                        className={`w-3.5 h-3.5 transition-transform duration-200 ${openFaq === i ? "rotate-180 text-white" : ""}`}
                        fill="none" stroke="currentColor" viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                      </svg>
                    </span>
                  </button>
                  <div className={`grid transition-all duration-300 ease-in-out ${openFaq === i ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
                    <div className="overflow-hidden">
                      <div className="px-5 pb-4 border-t border-[#2e2010]">
                        <p className="text-[#9a8060] text-sm leading-relaxed pt-3">{faq.a}</p>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── FOOTER ────────────────────────────────────────────────────────────── */}
      <footer className="border-t border-[#2e2010] bg-[#0a0600]">
        <div className="max-w-4xl mx-auto px-4 py-12">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
            <div>
              {restaurant.logo && (
                <div className="w-12 h-12 rounded-2xl overflow-hidden mb-3 border border-[#2e2010]">
                  <img src={restaurant.logo} alt="logo" className="w-full h-full object-cover" />
                </div>
              )}
              <p className="font-black text-[#f5e6c8] text-xl">{restaurant.name}</p>
              {restaurant.address && (
                <p className="text-sm text-[#9a8060] mt-1">{restaurant.address}</p>
              )}
            </div>
            <div className="flex flex-col items-start sm:items-end gap-3">
              <button
                onClick={() => scrollTo("menu")}
                style={{ backgroundColor: primary }}
                className="text-white font-bold px-5 py-2.5 rounded-xl text-sm transition-all active:scale-95 hover:opacity-90 hover:shadow-lg"
              >
                Order Online →
              </button>
              {(seo?.googleBusinessUrl || seo?.instagramUrl || seo?.tiktokUrl) && (
                <div className="flex flex-wrap gap-2">
                  {seo.googleBusinessUrl && (
                    <a href={seo.googleBusinessUrl} target="_blank" rel="noopener noreferrer"
                      className="w-10 h-10 bg-[#1a1008] rounded-xl border border-[#2e2010] hover:border-[#3a2518] hover:bg-[#211508] flex items-center justify-center transition-all group" title="Google Business">
                      <svg className="w-5 h-5 text-[#9a8060] group-hover:text-[#f5e6c8] transition-colors" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 11h8.533c.044.385.067.773.067 1.167C20.6 17.48 16.956 21 11.8 21 6.928 21 3 17.07 3 12.2S6.928 3.4 11.8 3.4c2.418 0 4.444.897 5.995 2.362l-2.43 2.43c-.678-.647-1.854-1.406-3.565-1.406-3.065 0-5.567 2.527-5.567 5.614 0 3.086 2.502 5.613 5.567 5.613 3.559 0 4.892-2.548 5.098-3.875H12V11z"/>
                      </svg>
                    </a>
                  )}
                  {seo.instagramUrl && (
                    <a href={seo.instagramUrl} target="_blank" rel="noopener noreferrer"
                      className="w-10 h-10 bg-[#1a1008] rounded-xl border border-[#2e2010] hover:border-[#3a2518] hover:bg-[#211508] flex items-center justify-center transition-all group" title="Instagram">
                      <svg className="w-5 h-5 text-[#9a8060] group-hover:text-[#f5e6c8] transition-colors" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
                      </svg>
                    </a>
                  )}
                  {seo.tiktokUrl && (
                    <a href={seo.tiktokUrl} target="_blank" rel="noopener noreferrer"
                      className="w-10 h-10 bg-[#1a1008] rounded-xl border border-[#2e2010] hover:border-[#3a2518] hover:bg-[#211508] flex items-center justify-center transition-all group" title="TikTok">
                      <svg className="w-5 h-5 text-[#9a8060] group-hover:text-[#f5e6c8] transition-colors" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.31 6.31 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.19 8.19 0 004.79 1.52V6.75a4.85 4.85 0 01-1.02-.06z"/>
                      </svg>
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="border-t border-[#2e2010] mt-10 pt-6 text-center">
            <p className="text-xs text-[#9a8060] font-medium">Powered by RestoFlow</p>
          </div>
        </div>
      </footer>

      {/* ── STICKY BOTTOM BAR (always visible) ───────────────────────────────── */}
      {!cartOpen && !checkoutOpen && (
        <div className="fixed bottom-0 left-0 right-0 z-40 px-4 py-3 bg-[#0d0802]/95 backdrop-blur-sm border-t border-[#2e2010] shadow-2xl">
          <div className="max-w-4xl mx-auto">
            {totalItems === 0 ? (
              <button
                onClick={() => scrollTo("menu")}
                style={{ backgroundColor: primary }}
                className="w-full text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-2.5 transition-all hover:opacity-90 hover:scale-[1.01] active:scale-[0.99] shadow-lg"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                <span>Browse Menu &amp; Start Order</span>
              </button>
            ) : (
              <button
                onClick={() => setCartOpen(true)}
                style={{ backgroundColor: primary }}
                className="w-full text-white font-bold py-4 rounded-2xl flex items-center justify-between px-5 transition-all hover:opacity-90 active:scale-[0.99] shadow-lg"
              >
                <span className="bg-white/20 text-white text-sm font-black w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0">
                  {totalItems}
                </span>
                <span className="font-bold text-base">View Cart</span>
                <span className="font-bold">{fmt(orderTotal)}</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── CART DRAWER ───────────────────────────────────────────────────────── */}
      {cartOpen && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end md:justify-center md:items-end">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setCartOpen(false)}
          />
          <div className="relative bg-[#1a1008] w-full md:w-[420px] md:h-full rounded-t-3xl md:rounded-none flex flex-col max-h-[90vh] md:max-h-full shadow-2xl">
            <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-[#2e2010] flex-shrink-0">
              <h2 className="text-lg font-black text-[#f5e6c8]">Your Cart ({totalItems})</h2>
              <button
                onClick={() => setCartOpen(false)}
                className="w-9 h-9 bg-[#241808] rounded-full flex items-center justify-center text-[#9a8060] hover:bg-[#2e2010] transition-colors font-bold"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {items.map((item) => (
                <div key={item.id} className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm text-[#f5e6c8] truncate">{item.name}</p>
                    <p className="text-sm font-bold" style={{ color: primary }}>
                      {fmt(item.price * item.quantity)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 bg-[#241808] rounded-xl p-1 flex-shrink-0">
                    <button
                      onClick={() => updateQuantity(item.id, item.quantity - 1)}
                      className="w-8 h-8 bg-[#1a1008] rounded-lg flex items-center justify-center font-bold text-[#9a8060] transition-colors text-sm hover:bg-[#2e2010] hover:text-[#f5e6c8]"
                    >
                      −
                    </button>
                    <span className="font-bold text-sm w-5 text-center text-[#f5e6c8]">{item.quantity}</span>
                    <button
                      onClick={() => updateQuantity(item.id, item.quantity + 1)}
                      className="w-8 h-8 bg-[#1a1008] rounded-lg flex items-center justify-center font-bold text-[#9a8060] transition-colors text-sm hover:bg-[#2e2010] hover:text-[#f5e6c8]"
                    >
                      +
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="px-5 py-4 border-t border-[#2e2010] bg-[#0d0802] flex-shrink-0">
              <div className="space-y-2 mb-4">
                <div className="flex justify-between text-sm text-[#9a8060]">
                  <span>Subtotal</span>
                  <span className="font-medium text-[#f5e6c8]">{fmt(subtotal)}</span>
                </div>
                {restaurant.deliveryEnabled && deliveryType === "delivery" && restaurant.deliveryFee > 0 && (
                  <div className="flex justify-between text-sm text-[#9a8060]">
                    <span>Delivery fee</span>
                    <span className="font-medium text-[#f5e6c8]">{fmt(restaurant.deliveryFee)}</span>
                  </div>
                )}
                <div className="flex justify-between font-black text-base pt-2 border-t border-[#2e2010]">
                  <span className="text-[#f5e6c8]">Total</span>
                  <span style={{ color: primary }}>{fmt(orderTotal)}</span>
                </div>
              </div>

              {restaurant.minimumOrder > 0 && !meetsMinimum && (
                <p className="text-xs text-amber-400 bg-amber-950/50 border border-amber-800/50 rounded-xl px-3 py-2 mb-3 font-medium">
                  Add {fmt(restaurant.minimumOrder - subtotal)} more to meet the minimum order
                </p>
              )}

              <button
                disabled={!restaurant.isOpen || !meetsMinimum}
                onClick={openCheckout}
                style={restaurant.isOpen && meetsMinimum ? { backgroundColor: primary } : {}}
                className="w-full text-white font-bold py-3.5 rounded-xl transition-all hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-[#2e2010] active:scale-[0.99]"
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
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setCheckoutOpen(false)}
          />
          <div className="relative bg-[#1a1008] w-full md:max-w-lg rounded-t-3xl md:rounded-3xl max-h-[95vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-[#2e2010] sticky top-0 bg-[#1a1008] z-10">
              <h2 className="text-lg font-black text-[#f5e6c8]">Checkout</h2>
              <button
                onClick={() => setCheckoutOpen(false)}
                className="w-9 h-9 bg-[#241808] rounded-full flex items-center justify-center text-[#9a8060] hover:bg-[#2e2010] transition-colors font-bold"
              >
                ✕
              </button>
            </div>

            <div className="px-5 py-5 space-y-5">
              {/* Delivery / Pickup toggle */}
              {restaurant.deliveryEnabled && restaurant.pickupEnabled && (
                <div>
                  <p className="text-xs font-bold text-[#9a8060] uppercase tracking-widest mb-2">Order type</p>
                  <div className="grid grid-cols-2 gap-2 p-1 bg-[#0d0802] rounded-xl">
                    <button
                      onClick={() => setDeliveryType("delivery")}
                      className={`py-2.5 rounded-lg text-sm font-bold transition-all ${
                        deliveryType === "delivery" ? "bg-[#1a1008] shadow" : "text-[#9a8060]"
                      }`}
                      style={deliveryType === "delivery" ? { color: primary } : {}}
                    >
                      Delivery
                    </button>
                    <button
                      onClick={() => setDeliveryType("pickup")}
                      className={`py-2.5 rounded-lg text-sm font-bold transition-all ${
                        deliveryType === "pickup" ? "bg-[#1a1008] shadow" : "text-[#9a8060]"
                      }`}
                      style={deliveryType === "pickup" ? { color: primary } : {}}
                    >
                      Pickup
                    </button>
                  </div>
                </div>
              )}

              {/* Contact details */}
              <div className="space-y-3">
                <p className="text-xs font-bold text-[#9a8060] uppercase tracking-widest">Your details</p>
                <input
                  type="text"
                  placeholder="Full name *"
                  value={formData.customerName}
                  onChange={(e) => setFormData({ ...formData, customerName: e.target.value })}
                  className="w-full border border-[#3a2518] rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 text-[#f5e6c8] placeholder-[#6a5040] transition-all bg-[#0d0802]"
                  style={{ ["--tw-ring-color" as string]: primary + "40" } as React.CSSProperties}
                  onFocus={(e) => { e.currentTarget.style.borderColor = primary; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = ""; }}
                />
                <input
                  type="tel"
                  placeholder="Phone number *"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  className="w-full border border-[#3a2518] rounded-xl px-4 py-3 text-sm outline-none text-[#f5e6c8] placeholder-[#6a5040] transition-all bg-[#0d0802]"
                  onFocus={(e) => { e.currentTarget.style.borderColor = primary; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = ""; }}
                />
              </div>

              {/* Delivery address */}
              {deliveryType === "delivery" && (
                <div>
                  <p className="text-xs font-bold text-[#9a8060] uppercase tracking-widest mb-2">Delivery address</p>
                  <textarea
                    placeholder="Enter your full delivery address *"
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    rows={2}
                    className="w-full border border-[#3a2518] rounded-xl px-4 py-3 text-sm outline-none text-[#f5e6c8] placeholder-[#6a5040] resize-none transition-all bg-[#0d0802]"
                    onFocus={(e) => { e.currentTarget.style.borderColor = primary; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = ""; }}
                  />
                </div>
              )}

              {/* Pickup location */}
              {deliveryType === "pickup" && restaurant.address && (
                <div className="rounded-xl px-4 py-3 border" style={{ backgroundColor: primary + "10", borderColor: primary + "30" }}>
                  <p className="text-xs font-bold mb-1" style={{ color: primary }}>Pickup location</p>
                  <p className="text-sm font-medium text-[#f5e6c8]">{restaurant.address}</p>
                </div>
              )}

              {/* Note */}
              <textarea
                placeholder="Special instructions (optional)"
                value={formData.note}
                onChange={(e) => setFormData({ ...formData, note: e.target.value })}
                rows={2}
                className="w-full border border-[#3a2518] rounded-xl px-4 py-3 text-sm outline-none text-[#f5e6c8] placeholder-[#6a5040] resize-none transition-all bg-[#0d0802]"
                onFocus={(e) => { e.currentTarget.style.borderColor = primary; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = ""; }}
              />

              {/* Order summary */}
              <div className="bg-[#0d0802] border border-[#2e2010] rounded-xl p-4">
                <p className="text-xs font-bold text-[#9a8060] uppercase tracking-widest mb-3">Order summary</p>
                <div className="space-y-1.5 mb-3">
                  {items.map((item) => (
                    <div key={item.id} className="flex justify-between text-sm">
                      <span className="text-[#9a8060]">{item.quantity}× {item.name}</span>
                      <span className="font-medium text-[#f5e6c8]">{fmt(item.quantity * item.price)}</span>
                    </div>
                  ))}
                </div>
                <div className="border-t border-[#2e2010] pt-2 space-y-1.5">
                  <div className="flex justify-between text-sm text-[#9a8060]">
                    <span>Subtotal</span>
                    <span>{fmt(subtotal)}</span>
                  </div>
                  {deliveryType === "delivery" && restaurant.deliveryFee > 0 && (
                    <div className="flex justify-between text-sm text-[#9a8060]">
                      <span>Delivery fee</span>
                      <span>{fmt(restaurant.deliveryFee)}</span>
                    </div>
                  )}
                  {deliveryType === "pickup" && (
                    <div className="flex justify-between text-sm text-green-500 font-medium">
                      <span>Pickup savings</span>
                      <span>Free</span>
                    </div>
                  )}
                  <div className="flex justify-between font-black text-base pt-1.5 border-t border-[#2e2010]">
                    <span className="text-[#f5e6c8]">Total</span>
                    <span style={{ color: primary }}>{fmt(orderTotal)}</span>
                  </div>
                </div>
              </div>

              {orderError && (
                <div className="bg-red-950/50 border border-red-800/50 text-red-400 text-sm font-medium px-4 py-3 rounded-xl">
                  {orderError}
                </div>
              )}

              {/* Payment buttons */}
              <div className="space-y-3 pb-2">
                <p className="text-xs font-bold text-[#9a8060] uppercase tracking-widest">Payment method</p>
                {restaurant.onlinePaymentEnabled && (
                  <button
                    onClick={handleOnlinePayment}
                    disabled={isSubmitting}
                    style={{ backgroundColor: primary }}
                    className="w-full text-white font-bold py-4 rounded-xl flex items-center justify-center gap-2.5 transition-all hover:opacity-90 disabled:opacity-60 active:scale-[0.99]"
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
                  className="w-full bg-[#241808] text-[#f5e6c8] font-bold py-4 rounded-xl flex items-center justify-center gap-2.5 hover:bg-[#2e2010] transition-colors disabled:opacity-60 active:scale-[0.99]"
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
      {/* ── SCHEDULE MODAL ────────────────────────────────────────────────────── */}
      {scheduleOpen && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setScheduleOpen(false)}
          />
          <div className="relative bg-[#1a1008] w-full md:max-w-lg rounded-t-3xl md:rounded-3xl max-h-[95vh] overflow-y-auto shadow-2xl">
            <div className="flex flex-col px-5 pt-5 pb-4 border-b border-[#2e2010] sticky top-0 bg-[#1a1008] z-10">
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-lg font-black text-[#f5e6c8]">Schedule Your Order</h2>
                <button
                  onClick={() => setScheduleOpen(false)}
                  className="w-9 h-9 bg-[#241808] rounded-full flex items-center justify-center text-[#9a8060] hover:bg-[#2e2010] transition-colors font-bold"
                >
                  ✕
                </button>
              </div>
              <p className="text-sm text-[#9a8060] font-medium">We&apos;re currently closed. Choose when you want your order prepared.</p>
            </div>

            <div className="px-5 py-5 space-y-5">
              {items.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-[#9a8060] font-medium mb-4">Browse the menu first, then schedule your order.</p>
                  <button
                    onClick={() => { setScheduleOpen(false); scrollTo("menu"); }}
                    className="bg-[#241808] text-[#f5e6c8] font-bold px-6 py-3 rounded-xl hover:bg-[#2e2010] transition-colors"
                  >
                    Browse Menu
                  </button>
                </div>
              ) : (
                <>
                  {/* Delivery / Pickup toggle */}
                  {restaurant.deliveryEnabled && restaurant.pickupEnabled && (
                    <div>
                      <p className="text-xs font-bold text-[#9a8060] uppercase tracking-widest mb-2">Order type</p>
                      <div className="grid grid-cols-2 gap-2 p-1 bg-[#0d0802] rounded-xl">
                        <button
                          onClick={() => setDeliveryType("delivery")}
                          className={`py-2.5 rounded-lg text-sm font-bold transition-all ${
                            deliveryType === "delivery" ? "bg-[#1a1008] shadow" : "text-[#9a8060]"
                          }`}
                          style={deliveryType === "delivery" ? { color: primary } : {}}
                        >
                          Delivery
                        </button>
                        <button
                          onClick={() => setDeliveryType("pickup")}
                          className={`py-2.5 rounded-lg text-sm font-bold transition-all ${
                            deliveryType === "pickup" ? "bg-[#1a1008] shadow" : "text-[#9a8060]"
                          }`}
                          style={deliveryType === "pickup" ? { color: primary } : {}}
                        >
                          Pickup
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Schedule Time */}
                  <div className="space-y-3">
                    <p className="text-xs font-bold text-[#9a8060] uppercase tracking-widest">When do you want it?</p>
                    <div className="grid grid-cols-2 gap-3">
                      <input
                        type="date"
                        value={scheduleDate}
                        onChange={(e) => setScheduleDate(e.target.value)}
                        className="w-full border border-[#3a2518] rounded-xl px-4 py-3 text-sm outline-none text-[#f5e6c8] transition-all focus:border-[#c9a452] bg-[#0d0802]"
                      />
                      <input
                        type="time"
                        value={scheduleTime}
                        onChange={(e) => setScheduleTime(e.target.value)}
                        className="w-full border border-[#3a2518] rounded-xl px-4 py-3 text-sm outline-none text-[#f5e6c8] transition-all focus:border-[#c9a452] bg-[#0d0802]"
                      />
                    </div>
                  </div>

                  {/* Contact details */}
                  <div className="space-y-3">
                    <p className="text-xs font-bold text-[#9a8060] uppercase tracking-widest">Your details</p>
                    <input
                      type="text"
                      placeholder="Full name *"
                      value={formData.customerName}
                      onChange={(e) => setFormData({ ...formData, customerName: e.target.value })}
                      className="w-full border border-[#3a2518] rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 text-[#f5e6c8] placeholder-[#6a5040] transition-all bg-[#0d0802]"
                      style={{ ["--tw-ring-color" as string]: primary + "40" } as React.CSSProperties}
                      onFocus={(e) => { e.currentTarget.style.borderColor = primary; }}
                      onBlur={(e) => { e.currentTarget.style.borderColor = ""; }}
                    />
                    <input
                      type="tel"
                      placeholder="Phone number *"
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      className="w-full border border-[#3a2518] rounded-xl px-4 py-3 text-sm outline-none text-[#f5e6c8] placeholder-[#6a5040] transition-all bg-[#0d0802]"
                      onFocus={(e) => { e.currentTarget.style.borderColor = primary; }}
                      onBlur={(e) => { e.currentTarget.style.borderColor = ""; }}
                    />
                  </div>

                  {/* Delivery address */}
                  {deliveryType === "delivery" && (
                    <div>
                      <p className="text-xs font-bold text-[#9a8060] uppercase tracking-widest mb-2">Delivery address</p>
                      <textarea
                        placeholder="Enter your full delivery address *"
                        value={formData.address}
                        onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                        rows={2}
                        className="w-full border border-[#3a2518] rounded-xl px-4 py-3 text-sm outline-none text-[#f5e6c8] placeholder-[#6a5040] resize-none transition-all bg-[#0d0802]"
                        onFocus={(e) => { e.currentTarget.style.borderColor = primary; }}
                        onBlur={(e) => { e.currentTarget.style.borderColor = ""; }}
                      />
                    </div>
                  )}

                  {/* Note */}
                  <textarea
                    placeholder="Special instructions (optional)"
                    value={formData.note}
                    onChange={(e) => setFormData({ ...formData, note: e.target.value })}
                    rows={2}
                    className="w-full border border-[#3a2518] rounded-xl px-4 py-3 text-sm outline-none text-[#f5e6c8] placeholder-[#6a5040] resize-none transition-all bg-[#0d0802]"
                    onFocus={(e) => { e.currentTarget.style.borderColor = primary; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = ""; }}
                  />

                  {/* Order summary */}
                  <div className="bg-[#0d0802] border border-[#2e2010] rounded-xl p-4">
                    <p className="text-xs font-bold text-[#9a8060] uppercase tracking-widest mb-3">Order summary</p>
                    <div className="space-y-1.5 mb-3">
                      {items.map((item) => (
                        <div key={item.id} className="flex justify-between text-sm">
                          <span className="text-[#9a8060]">{item.quantity}× {item.name}</span>
                          <span className="font-medium text-[#f5e6c8]">{fmt(item.quantity * item.price)}</span>
                        </div>
                      ))}
                    </div>
                    <div className="border-t border-[#2e2010] pt-2 space-y-1.5">
                      <div className="flex justify-between text-sm text-[#9a8060]">
                        <span>Subtotal</span>
                        <span>{fmt(subtotal)}</span>
                      </div>
                      {deliveryType === "delivery" && restaurant.deliveryFee > 0 && (
                        <div className="flex justify-between text-sm text-[#9a8060]">
                          <span>Delivery fee</span>
                          <span>{fmt(restaurant.deliveryFee)}</span>
                        </div>
                      )}
                      <div className="flex justify-between font-black text-base pt-1.5 border-t border-[#2e2010]">
                        <span className="text-[#f5e6c8]">Total</span>
                        <span style={{ color: primary }}>{fmt(orderTotal)}</span>
                      </div>
                    </div>
                  </div>

                  {restaurant.minimumOrder > 0 && !meetsMinimum && (
                    <p className="text-xs text-amber-400 bg-amber-950/50 border border-amber-800/50 rounded-xl px-3 py-2 mb-3 font-medium">
                      Add {fmt(restaurant.minimumOrder - subtotal)} more to meet the minimum order
                    </p>
                  )}

                  {orderError && (
                    <div className="bg-red-950/50 border border-red-800/50 text-red-400 text-sm font-medium px-4 py-3 rounded-xl">
                      {orderError}
                    </div>
                  )}

                  <button
                    onClick={handleScheduleSubmit}
                    disabled={isSubmitting || !meetsMinimum}
                    style={meetsMinimum ? { backgroundColor: primary } : {}}
                    className="w-full text-white font-bold py-4 rounded-xl flex items-center justify-center gap-2.5 transition-all hover:opacity-90 disabled:opacity-60 disabled:bg-[#2e2010] active:scale-[0.99]"
                  >
                    {isSubmitting ? "Scheduling…" : "Schedule Order"}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
