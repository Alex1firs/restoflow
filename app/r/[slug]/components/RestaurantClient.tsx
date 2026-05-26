"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useCart } from "./CartContext";
import SEOSections from "./SEOSections";

type DeliveryType = "delivery" | "pickup" | "dine_in";

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
    dineInEnabled: boolean;
    todayHoursLabel: string | null;
    primaryColor?: string;
    accentColor?: string;
    promoBanner?: string;
    rating?: number | null;
    ordersToday?: number | null;
    deliveryTime?: string;
    hidePrices?: boolean;
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
  initialTable?: string;
}

function fmt(n: number) {
  return `₦${n.toLocaleString("en-NG")}`;
}

function parseList(s?: string): string[] {
  if (!s?.trim()) return [];
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

export default function RestaurantClient({ restaurant, menuItems, seo, isPreview, initialTable }: RestaurantClientProps) {
  const { items, addToCart, updateQuantity, clearCart, totalPrice, totalItems } = useCart();

  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");
  const [isScheduledOrder, setIsScheduledOrder] = useState(false);
  const [scrollY, setScrollY] = useState(0);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [deliveryType, setDeliveryType] = useState<DeliveryType>(() => {
    if (initialTable && restaurant.dineInEnabled) return "dine_in";
    if (restaurant.deliveryEnabled) return "delivery";
    return "pickup";
  });
  const [formData, setFormData] = useState({ customerName: "", phone: "", address: "", note: "", tableNumber: initialTable ?? "" });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [trackingToken, setTrackingToken] = useState<string | null>(null);
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

  // Dynamic Brand Theme Variables
  const primary = restaurant.primaryColor || "#F26E21"; // premium warm orange accent
  const accent = restaurant.accentColor || primary;
  const rating = restaurant.rating;
  const ordersToday = restaurant.ordersToday;
  const deliveryTime = restaurant.deliveryTime || "20–35 min";

  const categories = [...new Set(menuItems.map((i) => i.category))].filter(Boolean);
  const filteredItems = activeCategory ? menuItems.filter((i) => i.category === activeCategory) : menuItems;
  const subtotal = totalPrice;
  const effectiveDeliveryFee = (deliveryType === "pickup" || deliveryType === "dine_in") ? 0 : restaurant.deliveryFee;
  const orderTotal = subtotal + effectiveDeliveryFee;
  const meetsMinimum = restaurant.hidePrices || restaurant.minimumOrder <= 0 || subtotal >= restaurant.minimumOrder;

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
    ...(!restaurant.hidePrices
      ? restaurant.deliveryFee > 0
        ? [{ q: `What is the delivery fee at ${restaurant.name}?`, a: `The delivery fee is ${fmt(restaurant.deliveryFee)}. This is added at checkout.` }]
        : [{ q: `Does ${restaurant.name} offer free delivery?`, a: `Yes — ${restaurant.name} currently offers free delivery on all orders.` }]
      : []
    ),
  ];

  // Dynamic CSS styling properties
  const brandStyle = {
    "--brand-primary": primary,
    "--brand-accent": accent,
    "--brand-primary-10": `${primary}1a`,
    "--brand-primary-20": `${primary}33`,
    "--brand-primary-90": `${primary}e6`,
  } as React.CSSProperties;

  // Keyboard accessibility
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
      if (window.scrollY < 1000) setScrollY(window.scrollY);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Modal body scroll lock
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
    const offset = 90; // optimized dynamic header offset
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

  const tableLabel = formData.tableNumber.trim()
    ? `Table ${formData.tableNumber.trim()}`
    : "";

  const buildPayload = () => ({
    restaurantId: restaurant.slug,
    customerName: formData.customerName.trim(),
    phone: formData.phone.trim(),
    address: deliveryType === "delivery"
      ? formData.address.trim()
      : deliveryType === "dine_in"
      ? "Dine In"
      : (restaurant.address || "Pickup"),
    note: formData.note.trim(),
    deliveryType,
    ...(deliveryType === "dine_in" ? { serviceMode: "dine_in", tableLabel } : {}),
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
      setTrackingToken(data.trackingToken ?? null);
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
      setTrackingToken(data.trackingToken ?? null);
      clearCart();
      setFormData({ customerName: "", phone: "", address: "", note: "", tableNumber: "" });
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
      <div style={brandStyle} className="min-h-screen bg-[#FAF9F5] dark:bg-[#0D0C0B] flex flex-col items-center justify-center px-6 text-center transition-colors duration-300">
        <div className="w-20 h-20 bg-emerald-50 dark:bg-emerald-950/30 rounded-full flex items-center justify-center mb-6 shadow-sm border border-emerald-100 dark:border-emerald-900/40">
          <svg className="w-10 h-10 text-emerald-600 dark:text-emerald-500 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="text-3xl font-extrabold text-neutral-900 dark:text-neutral-50 mb-3 tracking-tight">
          {isScheduledOrder ? "Order Scheduled!" : "Order Received!"}
        </h1>
        <p className="text-[#7A7368] dark:text-[#A19B91] mb-8 max-w-sm leading-relaxed text-sm font-medium">
          {isScheduledOrder
            ? `${restaurant.name} has received your scheduled order and will prepare it for ${new Date(`${scheduleDate}T${scheduleTime}`).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })}.`
            : `${restaurant.name} has successfully received your order and will begin preparation immediately.`}
        </p>
        {orderId && (
          <div className="w-full max-w-sm bg-white dark:bg-[#141412] border border-[#EFECE6] dark:border-[#1F1F1C] rounded-3xl p-6 mb-6 text-left shadow-lg">
            <p className="text-[10px] font-black text-[#7A7368] uppercase tracking-wider mb-1">Receipt reference</p>
            <p className="font-mono text-sm text-neutral-900 dark:text-neutral-100 mb-5 break-all font-semibold select-all">{orderId}</p>
            <a
              href={`/track/${orderId}${trackingToken ? `?t=${trackingToken}` : ""}`}
              style={{ backgroundColor: primary }}
              className="w-full text-white font-bold py-3.5 rounded-2xl flex items-center justify-center gap-2 transition-opacity hover:opacity-95 shadow-md active:scale-[0.98] transition-transform text-sm"
            >
              Track Preparation Link
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </a>
          </div>
        )}
        <button
          onClick={() => { setOrderSuccess(false); setOrderId(null); setTrackingToken(null); setIsScheduledOrder(false); }}
          className="text-xs font-bold text-[#7A7368] hover:text-neutral-900 dark:text-[#A19B91] dark:hover:text-white transition-colors py-2 px-4 rounded-full border border-[#EFECE6] dark:border-[#1F1F1C] bg-white dark:bg-[#141412] hover:bg-stone-50"
        >
          Return to Storefront
        </button>
      </div>
    );
  }

  const navSections = [
    { id: "menu", label: "Menu" },
    { id: "about", label: "About" },
    ...(popularItems.length > 0 ? [{ id: "popular", label: "Top Picks" }] : []),
    { id: "faq", label: "FAQ" },
  ];

  // ── Main Page Storefront ───────────────────────────────────────────────────
  return (
    <div style={brandStyle} className="min-h-screen bg-[#FAF9F5] dark:bg-[#0D0C0B] text-neutral-900 dark:text-neutral-50 pb-24 relative transition-colors duration-300 font-sans">
      {isPreview && (
        <div className="bg-gradient-to-r from-amber-500 to-orange-600 text-white font-black text-xs tracking-widest uppercase text-center py-3 px-4 sticky top-0 z-[100] shadow-md flex items-center justify-center gap-2">
          <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          PREVIEW MODE - Offline Simulations Enabled
        </div>
      )}

      {/* ── HERO REDESIGN (Phase 10A) ────────────────────────────────────────── */}
      <section className="relative min-h-[75vh] flex flex-col justify-end bg-stone-100 dark:bg-stone-900 overflow-hidden">
        {restaurant.coverImage && (
          <div 
            className="absolute inset-0 z-0 pointer-events-none"
            style={{ transform: `translateY(${scrollY * 0.25}px)` }}
          >
            <img 
              src={restaurant.coverImage} 
              alt="" 
              className="w-full h-full object-cover opacity-90 transition-transform duration-500 scale-100"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-black/10" />
          </div>
        )}

        {/* Top Navbar details */}
        <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-6 py-5 bg-gradient-to-b from-black/50 to-transparent">
          <div className="flex items-center gap-3">
            {restaurant.logo ? (
              <div className="w-10 h-10 rounded-2xl overflow-hidden border border-white/20 shadow-md">
                <img src={restaurant.logo} alt="logo" className="w-full h-full object-cover" />
              </div>
            ) : (
              <div className="w-10 h-10 rounded-2xl bg-white/10 backdrop-blur-md flex items-center justify-center border border-white/25">
                <span className="text-white font-extrabold text-sm tracking-tight">
                  {restaurant.name.slice(0, 2).toUpperCase()}
                </span>
              </div>
            )}
            <span className="text-white font-black text-lg tracking-tight drop-shadow-sm select-none">{restaurant.name}</span>
          </div>

          <div className="hidden md:flex items-center gap-8">
            {navSections.map((s) => (
              <button
                key={s.id}
                onClick={() => scrollTo(s.id)}
                className="text-white/80 hover:text-white text-[11px] font-bold uppercase tracking-widest transition-all hover:scale-105 active:scale-95"
              >
                {s.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3">
            {restaurant.isOpen ? (
              <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/20 backdrop-blur-md border border-emerald-400/30 text-emerald-400 text-[10px] font-bold uppercase tracking-wider shadow-sm">
                <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
                Open Now
              </span>
            ) : (
              <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-rose-500/20 backdrop-blur-md border border-rose-400/30 text-rose-400 text-[10px] font-bold uppercase tracking-wider shadow-sm">
                <span className="w-1.5 h-1.5 bg-rose-400/60 rounded-full" />
                Closed
              </span>
            )}
          </div>
        </div>

        {/* Hero details card */}
        <div className="relative z-10 max-w-4xl mx-auto w-full px-6 pb-8 md:pb-12 text-white">
          <div className="max-w-2xl space-y-4">
            <h1 className="text-3xl md:text-5xl font-black tracking-tight leading-none drop-shadow-md">
              {restaurant.name}
            </h1>
            {restaurant.description && (
              <p className="text-white/85 text-sm md:text-base leading-relaxed drop-shadow-sm max-w-xl font-medium">
                {restaurant.description}
              </p>
            )}
            
            {/* Cuisine tags */}
            {keywords.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {keywords.slice(0, 4).map((k) => (
                  <span key={k} className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-white/15 border border-white/10 backdrop-blur-sm">
                    {k}
                  </span>
                ))}
              </div>
            )}

            {/* Floating metrics grid */}
            <div className="grid grid-cols-3 gap-3 pt-4 border-t border-white/15 max-w-md">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center">
                  <span className="text-sm">⭐</span>
                </div>
                <div>
                  <p className="text-[10px] text-white/50 uppercase font-black tracking-wider">Rating</p>
                  <p className="text-xs font-bold text-white">{rating ? rating.toFixed(1) : "4.8"}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center">
                  <span className="text-sm">⏱️</span>
                </div>
                <div>
                  <p className="text-[10px] text-white/50 uppercase font-black tracking-wider">Speed</p>
                  <p className="text-xs font-bold text-white">{deliveryTime}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center">
                  <span className="text-sm">🚚</span>
                </div>
                <div>
                  <p className="text-[10px] text-white/50 uppercase font-black tracking-wider">Delivery</p>
                  <p className="text-xs font-bold text-white">
                    {restaurant.deliveryEnabled
                      ? restaurant.hidePrices
                        ? "Available"
                        : restaurant.deliveryFee > 0
                        ? fmt(restaurant.deliveryFee)
                        : "Free"
                      : "N/A"}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Operational Info Bar ─────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-[#141412] border-b border-[#EFECE6] dark:border-[#1F1F1C] px-6 py-6 shadow-[0_2px_15px_rgba(0,0,0,0.015)] transition-colors duration-300">
        <div className="max-w-4xl mx-auto flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-2xl bg-stone-50 dark:bg-stone-900 border border-[#EFECE6] dark:border-[#1F1F1C] flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-[var(--brand-primary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <div>
              <p className="text-[10px] text-[#7A7368] dark:text-[#A19B91] uppercase font-bold tracking-wider">Address Location</p>
              <p className="text-sm font-bold text-neutral-800 dark:text-neutral-200 mt-0.5">{restaurant.address || "Main Restaurant Outlet"}</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-2xl bg-stone-50 dark:bg-stone-900 border border-[#EFECE6] dark:border-[#1F1F1C] flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-[var(--brand-primary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <p className="text-[10px] text-[#7A7368] dark:text-[#A19B91] uppercase font-bold tracking-wider">Opening Hours</p>
              <p className="text-sm font-bold text-neutral-800 dark:text-neutral-200 mt-0.5">{restaurant.todayHoursLabel || "Open 9:00 AM - 10:00 PM"}</p>
            </div>
          </div>
          <div className="flex gap-2.5 w-full md:w-auto">
            <button
              onClick={() => scrollTo("menu")}
              style={{ backgroundColor: primary }}
              className="flex-1 md:flex-initial text-white font-bold py-3.5 px-6 rounded-2xl text-xs uppercase tracking-widest active:scale-95 transition-all shadow-md shadow-[var(--brand-primary-20)] hover:opacity-95"
            >
              Order Online
            </button>
            {!restaurant.isOpen && (
              <button
                onClick={() => setScheduleOpen(true)}
                className="flex-1 md:flex-initial border border-[#EFECE6] dark:border-[#1F1F1C] bg-white dark:bg-[#141412] text-neutral-800 dark:text-neutral-200 hover:bg-stone-50 font-bold py-3.5 px-6 rounded-2xl text-xs uppercase tracking-widest active:scale-95 transition-all shadow-sm"
              >
                Schedule
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Trending Strip / Social Proof (Phase 10G) ────────────────────────── */}
      <div className="bg-[#FAF9F5] dark:bg-[#0D0C0B] py-3.5 border-b border-[#EFECE6] dark:border-[#1F1F1C] overflow-x-auto scrollbar-hide">
        <div className="max-w-4xl mx-auto px-6">
          <div className="flex items-center gap-6 text-xs font-bold text-[#7A7368] dark:text-[#A19B91] min-w-max justify-center">
            {ordersToday ? (
              <span className="flex items-center gap-1.5"><span className="text-rose-500 animate-pulse">🔥</span> {ordersToday}+ placed today</span>
            ) : (
              <span className="flex items-center gap-1.5"><span className="text-[var(--brand-primary)]">⚡</span> Trending restaurant hub</span>
            )}
            <span className="text-stone-300 dark:text-stone-800">|</span>
            <span className="flex items-center gap-1.5"><span className="text-emerald-500">✨</span> Hygiene Standard Certified</span>
            <span className="text-stone-300 dark:text-stone-800">|</span>
            <span className="flex items-center gap-1.5"><span className="text-yellow-400">⭐</span> 99% Satisfaction Rate</span>
          </div>
        </div>
      </div>

      {/* ── Promo Banner ─────────────────────────────────────────────────────── */}
      {restaurant.promoBanner && !promoDismissed && (
        <div className="bg-gradient-to-r from-orange-500 to-amber-500 text-white px-6 py-3.5 shadow-sm">
          <div className="max-w-4xl mx-auto flex items-center justify-between gap-4">
            <p className="text-xs md:text-sm font-black tracking-tight flex items-center gap-2">
              <span className="text-lg">🎉</span> {restaurant.promoBanner}
            </p>
            <button
              onClick={() => setPromoDismissed(true)}
              className="text-white/80 hover:text-white flex-shrink-0 text-lg leading-none font-bold transition-colors w-7 h-7 bg-white/10 rounded-full flex items-center justify-center"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* ── Sticky Section Navigation ────────────────────────────────────────── */}
      <nav className="sticky top-0 z-30 bg-[#FAF9F5]/90 dark:bg-[#0D0C0B]/90 backdrop-blur-md border-b border-[#EFECE6] dark:border-[#1F1F1C] shadow-sm py-2.5 transition-all">
        <div className="max-w-4xl mx-auto px-6 w-full flex items-center justify-between">
          <div className="flex gap-1.5 overflow-x-auto scrollbar-hide py-1">
            {navSections.map((s) => (
              <button
                key={s.id}
                onClick={() => scrollTo(s.id)}
                style={activeSection === s.id ? { backgroundColor: primary } : {}}
                className={`flex-shrink-0 px-4.5 py-2 rounded-full text-xs font-black uppercase tracking-wider transition-all ${
                  activeSection === s.id
                    ? "text-white shadow-md shadow-[var(--brand-primary-20)] scale-105"
                    : "text-[#7A7368] hover:text-neutral-900 dark:text-[#A19B91] dark:hover:text-white hover:bg-stone-100/50 dark:hover:bg-stone-900/50"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => setCartOpen(true)}
            className="relative w-9 h-9 flex items-center justify-center rounded-2xl bg-white dark:bg-[#141412] border border-[#EFECE6] dark:border-[#1F1F1C] hover:border-[var(--brand-primary)] shadow-sm transition-all"
          >
            {totalItems > 0 && (
              <span
                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-black text-white shadow-md animate-scaleUp"
                style={{ backgroundColor: primary }}
              >
                {totalItems}
              </span>
            )}
            <svg className="w-4 h-4 text-neutral-800 dark:text-neutral-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
            </svg>
          </button>
        </div>
      </nav>

      {/* ── Closed Banner ────────────────────────────────────────────────────── */}
      {!restaurant.isOpen && (
        <div className="bg-stone-50 dark:bg-[#141412] border-b border-[#EFECE6] dark:border-[#1F1F1C] px-6 py-4.5">
          <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <span className="text-2xl flex-shrink-0 animate-pulse">🌙</span>
              <div>
                <p className="text-neutral-900 dark:text-neutral-100 font-extrabold text-sm tracking-tight">Currently Resting</p>
                <p className="text-[#7A7368] dark:text-[#A19B91] text-xs mt-0.5 font-medium leading-relaxed max-w-lg">
                  We are closed for preparation right now. Browse our full online selection and schedule a preorder delivery for when we reopen!
                </p>
              </div>
            </div>
            <div className="flex gap-2 w-full sm:w-auto">
              <button
                onClick={() => scrollTo("menu")}
                className="flex-1 sm:flex-initial bg-white dark:bg-[#1E1E1C] hover:bg-stone-50 dark:hover:bg-stone-900 text-neutral-800 dark:text-neutral-200 text-xs font-bold px-4 py-3 rounded-xl border border-[#EFECE6] dark:border-[#1F1F1C] transition-all shadow-sm active:scale-95"
              >
                Browse Menu
              </button>
              <button
                onClick={() => setScheduleOpen(true)}
                style={{ backgroundColor: primary }}
                className="flex-1 sm:flex-initial text-white text-xs font-bold px-5 py-3 rounded-xl shadow-md transition-opacity hover:opacity-95 active:scale-95"
              >
                Schedule Delivery
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MENU EXPERIENCE REDESIGN (Phase 10B) ──────────────────────────────── */}
      <section id="menu" ref={menuSectionRef} className="scroll-mt-24 max-w-4xl mx-auto px-6 pt-12 pb-6">
        <div className="mb-8">
          <span className="text-[10px] font-black uppercase tracking-wider text-[var(--brand-primary)]">Elite Gastronomy</span>
          <h2 className="text-3xl font-extrabold text-neutral-900 dark:text-neutral-50 tracking-tight mt-0.5">Explore Culinary Menu</h2>
          {restaurant.description && (
            <p className="text-[#7A7368] dark:text-[#A19B91] text-sm mt-2 max-w-xl leading-relaxed">
              Explore freshly made signature dishes, snacks, side selections, beverages, and desserts.
            </p>
          )}
        </div>

        {/* Scrollable menu category pills */}
        <div className="sticky top-[58px] z-20 bg-[#FAF9F5]/95 dark:bg-[#0D0C0B]/95 backdrop-blur-md py-3.5 border-b border-[#EFECE6] dark:border-[#1F1F1C] -mx-6 px-6 overflow-x-auto scrollbar-hide">
          <div ref={categoryTabsRef} className="flex gap-2">
            <button
              onClick={() => { setActiveCategory(null); scrollTo("menu"); }}
              style={activeCategory === null ? { backgroundColor: primary } : {}}
              className={`flex-shrink-0 px-4.5 py-2.5 rounded-2xl text-xs font-black uppercase tracking-wider transition-all duration-200 ${
                activeCategory === null
                  ? "text-white shadow-md shadow-[var(--brand-primary-20)] scale-105"
                  : "text-[#7A7368] hover:text-neutral-900 dark:text-[#A19B91] dark:hover:text-white bg-white dark:bg-[#141412] border border-[#EFECE6] dark:border-[#1F1F1C] hover:border-[var(--brand-primary)]"
              }`}
            >
              All Specialties
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => { setActiveCategory(cat); scrollTo("menu"); }}
                style={activeCategory === cat ? { backgroundColor: primary } : {}}
                className={`flex-shrink-0 px-4.5 py-2.5 rounded-2xl text-xs font-black uppercase tracking-wider transition-all duration-200 ${
                  activeCategory === cat
                    ? "text-white shadow-md shadow-[var(--brand-primary-20)] scale-105"
                    : "text-[#7A7368] hover:text-neutral-900 dark:text-[#A19B91] dark:hover:text-white bg-white dark:bg-[#141412] border border-[#EFECE6] dark:border-[#1F1F1C] hover:border-[var(--brand-primary)]"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Menu grid */}
        <div className="py-8">
          {filteredItems.length === 0 ? (
            <div className="text-center py-20 bg-white dark:bg-[#141412] rounded-3xl border border-[#EFECE6] dark:border-[#1F1F1C] p-8 shadow-sm">
              <span className="text-4xl">🍽️</span>
              <p className="text-neutral-900 dark:text-neutral-50 text-base font-extrabold mt-3 tracking-tight">Menu is currently empty</p>
              <p className="text-[#7A7368] dark:text-[#A19B91] text-xs mt-1">Our kitchen is preparing fresh lists. Check back shortly!</p>
            </div>
          ) : (
            <div
              data-fade="menu-grid"
              className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 ${fade("menu-grid")}`}
            >
              {filteredItems.map((item, idx) => {
                const cartItem = items.find((i) => i.id === item.id);
                const qty = cartItem?.quantity ?? 0;
                return (
                  <div
                    key={item.id}
                    className={`group bg-white dark:bg-[#141412] rounded-3xl border flex flex-col transition-all duration-300 shadow-[0_4px_25px_rgba(0,0,0,0.01)] ${
                      item.available
                        ? "border-[#EFECE6] dark:border-[#1F1F1C] hover:border-[var(--brand-primary)] dark:hover:border-[var(--brand-primary)] hover:shadow-xl hover:-translate-y-1.5"
                        : "border-[#EFECE6] dark:border-[#1F1F1C] opacity-65"
                    }`}
                  >
                    <div className="relative h-48 overflow-hidden bg-stone-50 dark:bg-stone-900/60 rounded-t-3xl flex-shrink-0">
                      {idx < 3 && item.available && (
                        <div
                          style={{ backgroundColor: primary }}
                          className="absolute top-3 left-3 z-10 text-white text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg shadow-sm"
                        >
                          🔥 Popular
                        </div>
                      )}
                      <img
                        src={getItemImage(item)}
                        alt={item.name}
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                        loading="lazy"
                      />
                      {!item.available && (
                        <div className="absolute inset-0 bg-[#0D0C0B]/75 backdrop-blur-xs flex items-center justify-center">
                          <span className="bg-[#141412] text-rose-500 text-xs font-black uppercase tracking-wider px-3.5 py-2 rounded-xl border border-rose-950/20 shadow-lg">
                            Sold Out
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="p-5 flex flex-col flex-1">
                      <div className="flex justify-between items-start gap-2 mb-1.5">
                        <h3 className="font-extrabold text-[15px] text-neutral-900 dark:text-neutral-50 leading-snug group-hover:text-[var(--brand-primary)] transition-colors">{item.name}</h3>
                        {!restaurant.hidePrices && (
                          <span className="font-black text-sm text-[var(--brand-primary)] flex-shrink-0 tracking-tight">{fmt(item.price)}</span>
                        )}
                      </div>
                      {item.description && (
                        <p className="text-xs text-[#7A7368] dark:text-[#A19B91] mb-4 leading-relaxed line-clamp-2 font-medium">{item.description}</p>
                      )}
                      <div className="mt-auto pt-2 border-t border-[#FAF9F5] dark:border-[#1F1F1C]">
                        {qty === 0 ? (
                          <button
                            disabled={!item.available || !restaurant.isOpen}
                            onClick={() => addToCart({ id: item.id, name: item.name, price: item.price })}
                            style={item.available && restaurant.isOpen ? { backgroundColor: primary } : {}}
                            className={`w-full py-3 rounded-2xl text-xs font-black uppercase tracking-wider transition-all ${
                              item.available && restaurant.isOpen
                                ? "text-white hover:opacity-95 active:scale-95 shadow-sm"
                                : "bg-stone-50 dark:bg-[#1C1C1A] text-[#7A7368] dark:text-[#5C574F] cursor-not-allowed border border-[#EFECE6] dark:border-[#1F1F1C]"
                            }`}
                          >
                            {!restaurant.isOpen ? "Closed" : !item.available ? "Sold Out" : "Add to Cart"}
                          </button>
                        ) : (
                          <div className="flex items-center justify-between bg-stone-50 dark:bg-[#1E1E1C] rounded-2xl p-1 border border-[#EFECE6] dark:border-[#1F1F1C] animate-scaleUp">
                            <button
                              onClick={() => updateQuantity(item.id, qty - 1)}
                              className="w-9 h-9 bg-white dark:bg-[#141412] hover:bg-stone-100 dark:hover:bg-stone-900 rounded-xl flex items-center justify-center font-bold text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 transition-all border border-[#EFECE6] dark:border-[#1F1F1C] active:scale-90"
                            >
                              −
                            </button>
                            <span className="font-extrabold text-sm text-neutral-800 dark:text-neutral-200">{qty}</span>
                            <button
                              onClick={() => updateQuantity(item.id, qty + 1)}
                              className="w-9 h-9 bg-white dark:bg-[#141412] hover:bg-stone-100 dark:hover:bg-stone-900 rounded-xl flex items-center justify-center font-bold text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 transition-all border border-[#EFECE6] dark:border-[#1F1F1C] active:scale-90"
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

      {/* ── Chef Specialties Showcase (Phase 10G) ───────────────────────────── */}
      {popularItems.length > 0 && (
        <section id="popular" ref={popularSectionRef} className="scroll-mt-24 border-t border-[#EFECE6] dark:border-[#1F1F1C] bg-white dark:bg-[#141412] transition-colors duration-300">
          <div className="max-w-4xl mx-auto px-6 py-16">
            <div data-fade="popular" className={fade("popular")}>
              <span className="text-[10px] font-black uppercase tracking-wider text-[var(--brand-primary)]">Chef&apos;s Showcase</span>
              <div className="flex items-center justify-between mb-8 mt-0.5">
                <h2 className="text-2xl font-extrabold text-neutral-900 dark:text-neutral-50 tracking-tight">Our Signature Specialties</h2>
                <button
                  onClick={() => scrollTo("menu")}
                  className="text-xs font-black uppercase tracking-wider hover:opacity-85 transition-opacity"
                  style={{ color: primary }}
                >
                  Full Menu →
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {popularItems.slice(0, 4).map((item) => {
                  const cartItem = items.find((i) => i.id === item.id);
                  const qty = cartItem?.quantity ?? 0;
                  return (
                    <div key={item.id} className="group bg-[#FAF9F5] dark:bg-[#0D0C0B] rounded-3xl border border-[#EFECE6] dark:border-[#1F1F1C] overflow-hidden hover:border-[var(--brand-primary)] hover:shadow-lg transition-all duration-300 flex flex-col">
                      <div className="relative h-40 overflow-hidden bg-stone-100 dark:bg-stone-900">
                        <div
                          style={{ backgroundColor: primary }}
                          className="absolute top-2.5 left-2.5 z-10 text-white text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded-lg shadow-sm"
                        >
                          Top Order
                        </div>
                        <img
                          src={getItemImage(item)}
                          alt={item.name}
                          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                          loading="lazy"
                        />
                      </div>
                      <div className="p-4 flex flex-col flex-1 justify-between">
                        <div>
                          <p className="font-extrabold text-neutral-900 dark:text-neutral-50 text-sm leading-snug tracking-tight truncate">{item.name}</p>
                          {!restaurant.hidePrices && (
                            <p className="font-black text-xs text-[var(--brand-primary)] mt-0.5 tracking-tight">{fmt(item.price)}</p>
                          )}
                        </div>
                        <div className="mt-4">
                          {qty === 0 ? (
                            <button
                              disabled={!restaurant.isOpen}
                              onClick={() => addToCart({ id: item.id, name: item.name, price: item.price })}
                              style={restaurant.isOpen ? { backgroundColor: primary } : {}}
                              className={`w-full py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all ${
                                restaurant.isOpen
                                  ? "text-white hover:opacity-95 active:scale-95 shadow-xs"
                                  : "bg-stone-100 dark:bg-stone-900 text-[#7A7368] cursor-not-allowed border border-[#EFECE6] dark:border-[#1F1F1C]"
                              }`}
                            >
                              {restaurant.isOpen ? "Add" : "Closed"}
                            </button>
                          ) : (
                            <div className="flex items-center justify-between bg-white dark:bg-[#1E1E1C] border border-[#EFECE6] dark:border-[#1F1F1C] rounded-xl px-1 py-0.5">
                              <button onClick={() => updateQuantity(item.id, qty - 1)} className="w-7 h-7 flex items-center justify-center font-bold text-[#7A7368] hover:text-neutral-900 dark:hover:text-white transition-colors">−</button>
                              <span className="font-extrabold text-xs text-neutral-800 dark:text-neutral-200">{qty}</span>
                              <button onClick={() => updateQuantity(item.id, qty + 1)} className="w-7 h-7 flex items-center justify-center font-bold text-[#7A7368] hover:text-neutral-900 dark:hover:text-white transition-colors">+</button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ── ABOUT SECTION (Phase 10D) ────────────────────────────────────────── */}
      <section id="about" ref={aboutSectionRef} className="scroll-mt-24 bg-white dark:bg-[#141412] border-t border-[#EFECE6] dark:border-[#1F1F1C] transition-colors duration-300">
        <div className="max-w-4xl mx-auto px-6 py-16">
          <div
            data-fade="about"
            className={`grid grid-cols-1 md:grid-cols-2 gap-12 ${fade("about")}`}
          >
            <div>
              <span className="text-[10px] font-black uppercase tracking-wider text-[var(--brand-primary)]">Gastronomy Heritage</span>
              <h2 className="text-2xl font-extrabold text-neutral-900 dark:text-neutral-50 tracking-tight mt-0.5 mb-4">About {restaurant.name}</h2>
              {restaurant.description && (
                <p className="text-[#7A7368] dark:text-[#A19B91] leading-relaxed text-sm md:text-base font-medium">{restaurant.description}</p>
              )}
              {keywords.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-4">
                  {keywords.map((k) => (
                    <span
                      key={k}
                      className="text-xs font-bold px-3.5 py-2 rounded-xl border"
                      style={{ backgroundColor: primary + "0d", color: primary, borderColor: primary + "26" }}
                    >
                      {k}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-3.5">
              {restaurant.address && (
                <div className="bg-[#FAF9F5] dark:bg-[#0D0C0B] rounded-3xl border border-[#EFECE6] dark:border-[#1F1F1C] px-5 py-4 flex items-start gap-4">
                  <span className="text-2xl flex-shrink-0">📍</span>
                  <div>
                    <p className="text-[10px] font-black text-[#7A7368] uppercase tracking-wider mb-0.5">Outlet Location</p>
                    <p className="text-sm font-bold text-neutral-800 dark:text-neutral-200 leading-tight">{restaurant.address}</p>
                  </div>
                </div>
              )}
              {restaurant.todayHoursLabel && (
                <div className="bg-[#FAF9F5] dark:bg-[#0D0C0B] rounded-3xl border border-[#EFECE6] dark:border-[#1F1F1C] px-5 py-4 flex items-start gap-4">
                  <span className="text-2xl flex-shrink-0">🕒</span>
                  <div>
                    <p className="text-[10px] font-black text-[#7A7368] uppercase tracking-wider mb-0.5">Today&apos;s Schedule</p>
                    <p className="text-sm font-bold text-neutral-800 dark:text-neutral-200 leading-tight">{restaurant.todayHoursLabel}</p>
                  </div>
                </div>
              )}
              <div className="bg-[#FAF9F5] dark:bg-[#0D0C0B] rounded-3xl border border-[#EFECE6] dark:border-[#1F1F1C] px-5 py-4 flex items-start gap-4">
                <span className="text-2xl flex-shrink-0">🚚</span>
                <div>
                  <p className="text-[10px] font-black text-[#7A7368] uppercase tracking-wider mb-0.5">Dispatch Terms</p>
                  <p className="text-sm font-bold text-neutral-800 dark:text-neutral-200 leading-tight">
                    {restaurant.deliveryEnabled
                      ? restaurant.hidePrices
                        ? "Delivery service is active"
                        : restaurant.deliveryFee > 0
                        ? `${fmt(restaurant.deliveryFee)} delivery fee applies`
                        : "Complimentary free delivery"
                      : "Direct takeaway pickup only"}
                  </p>
                </div>
              </div>
              {areas.length > 0 && (
                <div className="bg-[#FAF9F5] dark:bg-[#0D0C0B] rounded-3xl border border-[#EFECE6] dark:border-[#1F1F1C] px-5 py-4.5">
                  <p className="text-[10px] font-black text-[#7A7368] uppercase tracking-wider mb-3">Service Boundaries</p>
                  <div className="flex flex-wrap gap-1.5">
                    {areas.map((area) => (
                      <span key={area} className="text-xs font-semibold text-[#7A7368] dark:text-[#A19B91] bg-white dark:bg-[#141412] border border-[#EFECE6] dark:border-[#1F1F1C] px-3 py-1.5 rounded-xl">
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

      {/* ── FAQ SECTION (Phase 10I) ──────────────────────────────────────────── */}
      <section id="faq" ref={faqSectionRef} className="scroll-mt-24 bg-[#FAF9F5] dark:bg-[#0D0C0B] border-t border-[#EFECE6] dark:border-[#1F1F1C] transition-colors duration-300">
        <div className="max-w-4xl mx-auto px-6 py-16">
          <div data-fade="faq" className={fade("faq")}>
            <span className="text-[10px] font-black uppercase tracking-wider text-[var(--brand-primary)]">Assistance</span>
            <h2 className="text-2xl font-extrabold text-neutral-900 dark:text-neutral-50 tracking-tight mt-0.5 mb-8">Order Help &amp; FAQs</h2>
            <div className="space-y-3">
              {faqs.map((faq, i) => (
                <div key={i} className="bg-white dark:bg-[#141412] border border-[#EFECE6] dark:border-[#1F1F1C] rounded-3xl overflow-hidden shadow-xs hover:border-[var(--brand-primary)] transition-colors duration-200">
                  <button
                    onClick={() => setOpenFaq(openFaq === i ? null : i)}
                    className="w-full flex items-center justify-between px-6 py-4.5 text-left hover:bg-stone-50 dark:hover:bg-stone-900/50 transition-colors"
                  >
                    <span className="font-extrabold text-neutral-900 dark:text-neutral-50 text-sm md:text-base pr-4 tracking-tight leading-snug">{faq.q}</span>
                    <span
                      className="w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0 transition-all duration-200 border border-[#EFECE6] dark:border-[#1F1F1C]"
                      style={openFaq === i ? { backgroundColor: primary, borderColor: primary, color: "#fff" } : { backgroundColor: "transparent", color: "#7A7368" }}
                    >
                      <svg
                        className={`w-3.5 h-3.5 transition-transform duration-350 ${openFaq === i ? "rotate-180 text-white" : ""}`}
                        fill="none" stroke="currentColor" viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 9l-7 7-7-7" />
                      </svg>
                    </span>
                  </button>
                  <div className={`grid transition-all duration-350 ease-in-out ${openFaq === i ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
                    <div className="overflow-hidden">
                      <div className="px-6 pb-5 border-t border-[#EFECE6] dark:border-[#1F1F1C] pt-4">
                        <p className="text-[#7A7368] dark:text-[#A19B91] text-xs md:text-sm leading-relaxed font-medium">{faq.a}</p>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Phase 10J — SEO Integration Strip ────────────────────────────────── */}
      {seo && (
        <SEOSections
          restaurant={{
            name: restaurant.name,
            address: restaurant.address,
            description: restaurant.description,
            onlinePaymentEnabled: restaurant.onlinePaymentEnabled,
            deliveryEnabled: restaurant.deliveryEnabled,
            pickupEnabled: restaurant.pickupEnabled,
            deliveryFee: restaurant.deliveryFee,
          }}
          seo={seo}
          menuItems={menuItems}
        />
      )}

      {/* ── FOOTER ────────────────────────────────────────────────────────────── */}
      <footer className="border-t border-[#EFECE6] dark:border-[#1F1F1C] bg-white dark:bg-[#141412] transition-colors duration-300">
        <div className="max-w-4xl mx-auto px-6 py-16">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-8">
            <div className="space-y-4">
              {restaurant.logo && (
                <div className="w-12 h-12 rounded-2xl overflow-hidden border border-[#EFECE6] dark:border-[#1F1F1C] shadow-sm">
                  <img src={restaurant.logo} alt="logo" className="w-full h-full object-cover" />
                </div>
              )}
              <h3 className="font-extrabold text-neutral-900 dark:text-neutral-50 text-xl tracking-tight leading-none">{restaurant.name}</h3>
              {restaurant.address && (
                <p className="text-xs text-[#7A7368] dark:text-[#A19B91] font-medium leading-relaxed max-w-sm">{restaurant.address}</p>
              )}
            </div>
            <div className="flex flex-col items-start sm:items-end gap-3.5 w-full sm:w-auto">
              <button
                onClick={() => scrollTo("menu")}
                style={{ backgroundColor: primary }}
                className="w-full sm:w-auto text-white font-bold px-6 py-3.5 rounded-2xl text-xs uppercase tracking-widest transition-opacity hover:opacity-95 active:scale-95 shadow-md shadow-[var(--brand-primary-20)]"
              >
                Order Online Now
              </button>
              {(seo?.googleBusinessUrl || seo?.instagramUrl || seo?.tiktokUrl) && (
                <div className="flex items-center gap-2">
                  {seo.googleBusinessUrl && (
                    <a href={seo.googleBusinessUrl} target="_blank" rel="noopener noreferrer"
                      className="w-9 h-9 bg-stone-50 dark:bg-stone-900 rounded-xl border border-[#EFECE6] dark:border-[#1F1F1C] hover:border-[var(--brand-primary)] flex items-center justify-center transition-all group" title="Google Business">
                      <svg className="w-4 h-4 text-[#7A7368] group-hover:text-[var(--brand-primary)] transition-colors" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 11h8.533c.044.385.067.773.067 1.167C20.6 17.48 16.956 21 11.8 21 6.928 21 3 17.07 3 12.2S6.928 3.4 11.8 3.4c2.418 0 4.444.897 5.995 2.362l-2.43 2.43c-.678-.647-1.854-1.406-3.565-1.406-3.065 0-5.567 2.527-5.567 5.614 0 3.086 2.502 5.613 5.567 5.613 3.559 0 4.892-2.548 5.098-3.875H12V11z"/>
                      </svg>
                    </a>
                  )}
                  {seo.instagramUrl && (
                    <a href={seo.instagramUrl} target="_blank" rel="noopener noreferrer"
                      className="w-9 h-9 bg-stone-50 dark:bg-stone-900 rounded-xl border border-[#EFECE6] dark:border-[#1F1F1C] hover:border-[var(--brand-primary)] flex items-center justify-center transition-all group" title="Instagram">
                      <svg className="w-4 h-4 text-[#7A7368] group-hover:text-[var(--brand-primary)] transition-colors" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204 013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
                      </svg>
                    </a>
                  )}
                  {seo.tiktokUrl && (
                    <a href={seo.tiktokUrl} target="_blank" rel="noopener noreferrer"
                      className="w-9 h-9 bg-stone-50 dark:bg-stone-900 rounded-xl border border-[#EFECE6] dark:border-[#1F1F1C] hover:border-[var(--brand-primary)] flex items-center justify-center transition-all group" title="TikTok">
                      <svg className="w-4 h-4 text-[#7A7368] group-hover:text-[var(--brand-primary)] transition-colors" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.31 6.31 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.19 8.19 0 004.79 1.52V6.75a4.85 4.85 0 01-1.02-.06z"/>
                      </svg>
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="border-t border-[#EFECE6] dark:border-[#1F1F1C] mt-12 pt-8 text-center flex flex-col md:flex-row justify-between items-center gap-3">
            <p className="text-xs text-[#7A7368] dark:text-[#A19B91] font-semibold tracking-tight">© {new Date().getFullYear()} {restaurant.name}. All rights reserved.</p>
            <p className="text-[10px] uppercase font-black text-[#7A7368] dark:text-[#5C574F] tracking-widest flex items-center gap-1">Powered by <span className="text-neutral-900 dark:text-neutral-300 font-extrabold normal-case text-xs">RestoFlow</span></p>
          </div>
        </div>
      </footer>

      {/* ── STICKY BOTTOM ORDER BAR (Phase 10E) ───────────────────────────────── */}
      {!cartOpen && !checkoutOpen && (
        <div className="fixed bottom-0 left-0 right-0 z-40 px-6 py-4 bg-white/95 dark:bg-[#141412]/95 backdrop-blur-md border-t border-[#EFECE6] dark:border-[#1F1F1C] shadow-[0_-8px_30px_rgba(0,0,0,0.04)] transition-all">
          <div className="max-w-4xl mx-auto flex items-center gap-4">
            {totalItems === 0 ? (
              <button
                onClick={() => scrollTo("menu")}
                style={{ backgroundColor: primary }}
                className="w-full text-white font-bold py-4.5 rounded-2xl flex items-center justify-center gap-2.5 transition-opacity hover:opacity-95 active:scale-[0.99] shadow-lg shadow-[var(--brand-primary-20)]"
              >
                <svg className="w-5 h-5 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                <span className="text-sm font-black uppercase tracking-wider">Browse Selection &amp; Preorder</span>
              </button>
            ) : (
              <button
                onClick={() => setCartOpen(true)}
                style={{ backgroundColor: primary }}
                className="w-full text-white font-bold py-4 px-5 rounded-2xl flex items-center justify-between transition-opacity hover:opacity-95 active:scale-[0.99] shadow-lg shadow-[var(--brand-primary-20)] animate-scaleUp"
              >
                <div className="flex items-center gap-2">
                  <span className="bg-white/20 text-white text-xs font-black w-6.5 h-6.5 rounded-xl flex items-center justify-center">
                    {totalItems}
                  </span>
                  <span className="font-extrabold text-sm uppercase tracking-wider">View Cart Drawer</span>
                </div>
                <div className="flex items-center gap-1.5 font-black text-sm">
                  <span>Checkout</span>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                  {!restaurant.hidePrices && (
                    <span className="ml-1 bg-black/15 py-1 px-2.5 rounded-lg">{fmt(orderTotal)}</span>
                  )}
                </div>
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── CART DRAWER OVERHAUL (Phase 10C) ─────────────────────────────────── */}
      {cartOpen && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end md:justify-center md:items-end animate-fadeIn">
          <div
            className="absolute inset-0 bg-neutral-900/60 dark:bg-black/85 backdrop-blur-xs transition-opacity duration-300"
            onClick={() => setCartOpen(false)}
          />
          <div className="relative bg-white dark:bg-[#141412] w-full md:w-[420px] md:h-full rounded-t-[32px] md:rounded-none flex flex-col max-h-[85vh] md:max-h-full shadow-2xl border-t md:border-t-0 md:border-l border-[#EFECE6] dark:border-[#1F1F1C] animate-slideUp md:animate-slideLeft transition-colors duration-300">
            <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-[#EFECE6] dark:border-[#1F1F1C] flex-shrink-0">
              <div>
                <h2 className="text-lg font-extrabold text-neutral-900 dark:text-neutral-50 tracking-tight leading-none">Your Cart</h2>
                <p className="text-[10px] text-[#7A7368] dark:text-[#A19B91] uppercase font-bold tracking-wider mt-1">{totalItems} selections added</p>
              </div>
              <button
                onClick={() => setCartOpen(false)}
                className="w-9 h-9 bg-stone-50 dark:bg-[#1E1E1C] rounded-2xl flex items-center justify-center text-[#7A7368] hover:text-neutral-900 hover:bg-stone-100 dark:hover:bg-stone-900 transition-colors border border-[#EFECE6] dark:border-[#1F1F1C]"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5 scrollbar-hide">
              {items.map((item) => (
                <div key={item.id} className="flex items-center gap-4 py-1 animate-scaleUp">
                  <div className="flex-1 min-w-0">
                    <p className="font-extrabold text-sm text-neutral-900 dark:text-neutral-100 truncate tracking-tight leading-snug">{item.name}</p>
                    {!restaurant.hidePrices && (
                      <p className="text-xs font-black text-[var(--brand-primary)] mt-0.5" style={{ color: primary }}>
                        {fmt(item.price * item.quantity)}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 bg-stone-50 dark:bg-[#1E1E1C] rounded-2xl p-1 border border-[#EFECE6] dark:border-[#1F1F1C] flex-shrink-0">
                    <button
                      onClick={() => updateQuantity(item.id, item.quantity - 1)}
                      className="w-8 h-8 bg-white dark:bg-[#141412] hover:bg-stone-100 dark:hover:bg-stone-900 rounded-xl flex items-center justify-center font-bold text-[#7A7368] transition-colors border border-[#EFECE6] dark:border-[#1F1F1C] text-sm active:scale-90"
                    >
                      −
                    </button>
                    <span className="font-extrabold text-sm w-5 text-center text-neutral-800 dark:text-neutral-200">{item.quantity}</span>
                    <button
                      onClick={() => updateQuantity(item.id, item.quantity + 1)}
                      className="w-8 h-8 bg-white dark:bg-[#141412] hover:bg-stone-100 dark:hover:bg-stone-900 rounded-xl flex items-center justify-center font-bold text-[#7A7368] transition-colors border border-[#EFECE6] dark:border-[#1F1F1C] text-sm active:scale-90"
                    >
                      +
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="px-6 py-6 border-t border-[#EFECE6] dark:border-[#1F1F1C] bg-[#FAF9F5] dark:bg-[#0D0C0B] flex-shrink-0 transition-colors duration-300">
              {restaurant.hidePrices ? (
                <div className="mb-5 text-center bg-stone-100/50 dark:bg-stone-900/50 border border-dashed border-stone-200 dark:border-stone-800 rounded-2xl py-3.5 px-4">
                  <p className="text-xs font-black text-neutral-700 dark:text-neutral-300">📖 Catalog Order Mode Active</p>
                  <p className="text-[10px] text-stone-500 dark:text-stone-400 mt-1 leading-relaxed">
                    Pay table-side or in-person upon order dispatch. Prices are hidden from the menu.
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5 mb-5">
                  <div className="flex justify-between text-xs font-medium text-[#7A7368] dark:text-[#A19B91]">
                    <span>Items Subtotal</span>
                    <span className="font-bold text-neutral-900 dark:text-neutral-200">{fmt(subtotal)}</span>
                  </div>
                  {restaurant.deliveryEnabled && deliveryType === "delivery" && restaurant.deliveryFee > 0 && (
                    <div className="flex justify-between text-xs font-medium text-[#7A7368] dark:text-[#A19B91]">
                      <span>Standard Delivery Fee</span>
                      <span className="font-bold text-neutral-900 dark:text-neutral-200">{fmt(restaurant.deliveryFee)}</span>
                    </div>
                  )}
                  {deliveryType === "dine_in" && (
                    <div className="flex justify-between text-xs text-emerald-600 dark:text-emerald-500 font-bold">
                      <span>Dine In — No delivery fee</span>
                      <span>Free</span>
                    </div>
                  )}
                  <div className="flex justify-between font-black text-base pt-3 border-t border-[#EFECE6] dark:border-[#1F1F1C]">
                    <span className="text-neutral-900 dark:text-neutral-200 font-extrabold">Grand Total</span>
                    <span className="text-[var(--brand-primary)]" style={{ color: primary }}>{fmt(orderTotal)}</span>
                  </div>
                </div>
              )}

              {restaurant.minimumOrder > 0 && !meetsMinimum && (
                <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-900/30 rounded-2xl px-4 py-3 mb-4 font-medium leading-relaxed shadow-sm">
                  🍲 Add <span className="font-extrabold">{fmt(restaurant.minimumOrder - subtotal)}</span> more to satisfy the restaurant&apos;s minimum order threshold.
                </div>
              )}

              <button
                disabled={!restaurant.isOpen || !meetsMinimum}
                onClick={openCheckout}
                style={restaurant.isOpen && meetsMinimum ? { backgroundColor: primary } : {}}
                className="w-full text-white font-bold py-4 rounded-2xl transition-all hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-stone-200 dark:disabled:bg-stone-800 disabled:text-stone-400 dark:disabled:text-stone-600 active:scale-[0.99] text-sm uppercase tracking-widest shadow-md shadow-[var(--brand-primary-20)]"
              >
                {!restaurant.isOpen
                  ? "Restaurant is Offline"
                  : !meetsMinimum
                  ? "Browse More Selections"
                  : "Proceed to Secure Checkout"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── SECURE CHECKOUT MODAL (Phase 10C) ────────────────────────────────── */}
      {checkoutOpen && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center animate-fadeIn">
          <div
            className="absolute inset-0 bg-neutral-900/60 dark:bg-black/85 backdrop-blur-xs transition-opacity duration-300"
            onClick={() => setCheckoutOpen(false)}
          />
          <div className="relative bg-white dark:bg-[#141412] w-full md:max-w-xl rounded-t-[32px] md:rounded-[32px] max-h-[92vh] overflow-y-auto shadow-2xl border border-[#EFECE6] dark:border-[#1F1F1C] animate-slideUp transition-colors duration-300">
            <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-[#EFECE6] dark:border-[#1F1F1C] sticky top-0 bg-white dark:bg-[#141412] z-10">
              <div>
                <h2 className="text-lg font-extrabold text-neutral-900 dark:text-neutral-50 tracking-tight leading-none">Pristine Checkout</h2>
                <p className="text-[10px] text-[#7A7368] dark:text-[#A19B91] uppercase font-bold tracking-wider mt-1">Review details and authorize order</p>
              </div>
              <button
                onClick={() => setCheckoutOpen(false)}
                className="w-9 h-9 bg-stone-50 dark:bg-[#1E1E1C] rounded-2xl flex items-center justify-center text-[#7A7368] hover:text-neutral-900 hover:bg-stone-100 dark:hover:bg-stone-900 transition-colors border border-[#EFECE6] dark:border-[#1F1F1C]"
              >
                ✕
              </button>
            </div>

            <div className="px-6 py-6 space-y-6">
              {/* Fulfillment mode selector */}
              {(restaurant.deliveryEnabled || restaurant.pickupEnabled || restaurant.dineInEnabled) && (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-black text-[#7A7368] uppercase tracking-wider">Preferred fulfillment mode</p>
                  <div className={`grid gap-1.5 p-1 bg-stone-50 dark:bg-[#0D0C0B] rounded-2xl border border-[#EFECE6] dark:border-[#1F1F1C] ${
                    [restaurant.deliveryEnabled, restaurant.pickupEnabled, restaurant.dineInEnabled].filter(Boolean).length === 3
                      ? "grid-cols-3"
                      : "grid-cols-2"
                  }`}>
                    {restaurant.deliveryEnabled && (
                      <button
                        onClick={() => setDeliveryType("delivery")}
                        className={`py-3 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${
                          deliveryType === "delivery" ? "bg-white dark:bg-[#141412] shadow-sm" : "text-[#7A7368]"
                        }`}
                        style={deliveryType === "delivery" ? { color: primary } : {}}
                      >
                        Doorstep Delivery
                      </button>
                    )}
                    {restaurant.pickupEnabled && (
                      <button
                        onClick={() => setDeliveryType("pickup")}
                        className={`py-3 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${
                          deliveryType === "pickup" ? "bg-white dark:bg-[#141412] shadow-sm" : "text-[#7A7368]"
                        }`}
                        style={deliveryType === "pickup" ? { color: primary } : {}}
                      >
                        Takeaway Pickup
                      </button>
                    )}
                    {restaurant.dineInEnabled && (
                      <button
                        onClick={() => setDeliveryType("dine_in")}
                        className={`py-3 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${
                          deliveryType === "dine_in" ? "bg-white dark:bg-[#141412] shadow-sm" : "text-[#7A7368]"
                        }`}
                        style={deliveryType === "dine_in" ? { color: primary } : {}}
                      >
                        Dine In
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Contact Information Fields */}
              <div className="space-y-3">
                <p className="text-[10px] font-black text-[#7A7368] uppercase tracking-wider">Contact Information</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Full name *"
                      value={formData.customerName}
                      onChange={(e) => setFormData({ ...formData, customerName: e.target.value })}
                      className="w-full border border-[#EFECE6] dark:border-[#1F1F1C] rounded-2xl px-4.5 py-4 text-sm outline-none focus:ring-2 focus:ring-[var(--brand-primary-20)] text-neutral-900 dark:text-neutral-100 placeholder-[#A19B91] transition-all bg-[#FAF9F5] dark:bg-[#0D0C0B]"
                      onFocus={(e) => { e.currentTarget.style.borderColor = primary; }}
                      onBlur={(e) => { e.currentTarget.style.borderColor = ""; }}
                    />
                  </div>
                  <div className="relative">
                    <input
                      type="tel"
                      placeholder="Phone number *"
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      className="w-full border border-[#EFECE6] dark:border-[#1F1F1C] rounded-2xl px-4.5 py-4 text-sm outline-none focus:ring-2 focus:ring-[var(--brand-primary-20)] text-neutral-900 dark:text-neutral-100 placeholder-[#A19B91] transition-all bg-[#FAF9F5] dark:bg-[#0D0C0B]"
                      onFocus={(e) => { e.currentTarget.style.borderColor = primary; }}
                      onBlur={(e) => { e.currentTarget.style.borderColor = ""; }}
                    />
                  </div>
                </div>
              </div>

              {/* Delivery Address Block */}
              {deliveryType === "delivery" && (
                <div className="space-y-1.5 animate-scaleUp">
                  <p className="text-[10px] font-black text-[#7A7368] uppercase tracking-wider">Delivery Destination</p>
                  <textarea
                    placeholder="Enter your comprehensive delivery address details *"
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    rows={2.5}
                    className="w-full border border-[#EFECE6] dark:border-[#1F1F1C] rounded-2xl px-4.5 py-4 text-sm outline-none focus:ring-2 focus:ring-[var(--brand-primary-20)] text-neutral-900 dark:text-neutral-100 placeholder-[#A19B91] resize-none transition-all bg-[#FAF9F5] dark:bg-[#0D0C0B]"
                    onFocus={(e) => { e.currentTarget.style.borderColor = primary; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = ""; }}
                  />
                </div>
              )}

              {/* Pickup Address Block */}
              {deliveryType === "pickup" && restaurant.address && (
                <div className="rounded-2xl px-4.5 py-4 border animate-scaleUp" style={{ backgroundColor: primary + "0d", borderColor: primary + "26" }}>
                  <p className="text-[10px] font-black uppercase tracking-wider mb-1" style={{ color: primary }}>Outlet Pickup Address</p>
                  <p className="text-xs font-bold text-neutral-800 dark:text-neutral-200 leading-relaxed">{restaurant.address}</p>
                </div>
              )}

              {/* Dine In — Table Number */}
              {deliveryType === "dine_in" && (
                <div className="space-y-2 animate-scaleUp">
                  <p className="text-[10px] font-black text-[#7A7368] uppercase tracking-wider">Table Number (Optional)</p>
                  <input
                    type="text"
                    placeholder="e.g. 5 or Table 5"
                    value={formData.tableNumber}
                    onChange={(e) => setFormData({ ...formData, tableNumber: e.target.value })}
                    className="w-full border border-[#EFECE6] dark:border-[#1F1F1C] rounded-2xl px-4.5 py-4 text-sm outline-none focus:ring-2 focus:ring-[var(--brand-primary-20)] text-neutral-900 dark:text-neutral-100 placeholder-[#A19B91] transition-all bg-[#FAF9F5] dark:bg-[#0D0C0B]"
                    onFocus={(e) => { e.currentTarget.style.borderColor = primary; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = ""; }}
                  />
                  <p className="text-[10px] text-[#7A7368] dark:text-[#A19B91]">Your order will be brought to your table. Staff will be notified of your table number.</p>
                </div>
              )}

              {/* Special Note */}
              <div className="space-y-1.5">
                <p className="text-[10px] font-black text-[#7A7368] uppercase tracking-wider">Dietary instructions / Note (Optional)</p>
                <textarea
                  placeholder="E.g. No onions, cutlery included, gate code details, etc."
                  value={formData.note}
                  onChange={(e) => setFormData({ ...formData, note: e.target.value })}
                  rows={2}
                  className="w-full border border-[#EFECE6] dark:border-[#1F1F1C] rounded-2xl px-4.5 py-4 text-sm outline-none focus:ring-2 focus:ring-[var(--brand-primary-20)] text-neutral-900 dark:text-neutral-100 placeholder-[#A19B91] resize-none transition-all bg-[#FAF9F5] dark:bg-[#0D0C0B]"
                  onFocus={(e) => { e.currentTarget.style.borderColor = primary; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = ""; }}
                />
              </div>

              {/* Secure Order Summary Details */}
              <div className="bg-stone-50 dark:bg-[#0D0C0B] border border-[#EFECE6] dark:border-[#1F1F1C] rounded-2xl p-5">
                <p className="text-[10px] font-black text-[#7A7368] uppercase tracking-wider mb-3.5">Fulfillment summary</p>
                <div className="space-y-2.5 mb-4 max-h-[140px] overflow-y-auto scrollbar-hide">
                  {items.map((item) => (
                    <div key={item.id} className="flex justify-between text-xs font-medium">
                      <span className="text-[#7A7368] dark:text-[#A19B91] font-semibold">{item.quantity}× {item.name}</span>
                      {!restaurant.hidePrices && (
                        <span className="font-extrabold text-neutral-900 dark:text-neutral-100">{fmt(item.quantity * item.price)}</span>
                      )}
                    </div>
                  ))}
                </div>
                {restaurant.hidePrices ? (
                  <div className="border-t border-[#EFECE6] dark:border-[#1F1F1C] pt-3.5">
                    <div className="bg-stone-100/50 dark:bg-stone-900/50 border border-dashed border-stone-200 dark:border-stone-800 rounded-xl p-3 text-center">
                      <p className="text-xs font-black text-neutral-700 dark:text-neutral-300">📖 Catalog Order Mode</p>
                      <p className="text-[10px] text-stone-500 dark:text-stone-400 mt-1 leading-relaxed">
                        {deliveryType === "delivery"
                          ? "Please pay cash or card upon delivery dispatch."
                          : "Please pay table-side or at the counter upon order collection."}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="border-t border-[#EFECE6] dark:border-[#1F1F1C] pt-3.5 space-y-2">
                    <div className="flex justify-between text-xs text-[#7A7368] dark:text-[#A19B91]">
                      <span>Selections Subtotal</span>
                      <span className="font-bold text-neutral-900 dark:text-neutral-200">{fmt(subtotal)}</span>
                    </div>
                    {deliveryType === "delivery" && restaurant.deliveryFee > 0 && (
                      <div className="flex justify-between text-xs text-[#7A7368] dark:text-[#A19B91]">
                        <span>Fulfillment Dispatch Fee</span>
                        <span className="font-bold text-neutral-900 dark:text-neutral-200">{fmt(restaurant.deliveryFee)}</span>
                      </div>
                    )}
                    {(deliveryType === "pickup" || deliveryType === "dine_in") && (
                      <div className="flex justify-between text-xs text-emerald-600 dark:text-emerald-500 font-extrabold">
                        <span>{deliveryType === "dine_in" ? "No delivery fee" : "Pickup Savings"}</span>
                        <span>Free</span>
                      </div>
                    )}
                    <div className="flex justify-between font-black text-base pt-3 border-t border-[#EFECE6] dark:border-[#1F1F1C]">
                      <span className="text-neutral-900 dark:text-neutral-200 font-extrabold">Total Amount Due</span>
                      <span style={{ color: primary }} className="font-black text-lg tracking-tight">{fmt(orderTotal)}</span>
                    </div>
                  </div>
                )}
              </div>

              {orderError && (
                <div className="bg-rose-50 dark:bg-rose-950/20 border border-rose-200/50 dark:border-rose-900/30 text-rose-600 dark:text-rose-400 text-xs md:text-sm font-bold px-4.5 py-4 rounded-2xl leading-relaxed">
                  ⚠️ {orderError}
                </div>
              )}

              {/* Secure payment actions (Phase 10C) */}
              <div className="space-y-2.5 pb-2">
                {restaurant.hidePrices ? (
                  <button
                    onClick={handleCashOrder}
                    disabled={isSubmitting}
                    style={{ backgroundColor: primary }}
                    className="w-full text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-2.5 transition-opacity hover:opacity-95 disabled:opacity-60 active:scale-[0.99] text-sm uppercase tracking-widest shadow-md shadow-[var(--brand-primary-20)]"
                  >
                    <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7m0 0l-7 7m7-7H3" />
                    </svg>
                    {isSubmitting
                      ? "Placing Order safely…"
                      : "Confirm & Place Order"}
                  </button>
                ) : (
                  <>
                    {restaurant.onlinePaymentEnabled && (
                      <button
                        onClick={handleOnlinePayment}
                        disabled={isSubmitting}
                        style={{ backgroundColor: primary }}
                        className="w-full text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-2.5 transition-opacity hover:opacity-95 disabled:opacity-60 active:scale-[0.99] text-sm uppercase tracking-widest shadow-md shadow-[var(--brand-primary-20)]"
                      >
                        <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                        </svg>
                        {isSubmitting ? "Redirecting safely…" : "Authorize Pay Online (Paystack)"}
                      </button>
                    )}
                    <button
                      onClick={handleCashOrder}
                      disabled={isSubmitting}
                      className="w-full bg-stone-50 hover:bg-stone-100 dark:bg-[#1E1E1C] dark:hover:bg-[#2A2A27] text-neutral-800 dark:text-neutral-200 font-bold py-4 rounded-2xl flex items-center justify-center gap-2.5 transition-all border border-[#EFECE6] dark:border-[#1F1F1C] disabled:opacity-60 active:scale-[0.99] text-sm uppercase tracking-widest shadow-xs"
                    >
                      <svg className="w-4.5 h-4.5 text-[#7A7368]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                      {isSubmitting
                        ? "Placing Order safely…"
                        : deliveryType === "pickup"
                        ? "Confirm Pay on Pickup"
                        : deliveryType === "dine_in"
                        ? "Confirm Pay at Table"
                        : "Confirm Pay on Delivery"}
                    </button>
                  </>
                )}
              </div>

              {/* Trust badges (Phase 10C) */}
              <div className="flex justify-center items-center gap-4 text-[10px] font-black uppercase text-[#7A7368] dark:text-[#5C574F] tracking-widest pt-2 border-t border-[#EFECE6] dark:border-[#1F1F1C]">
                <span className="flex items-center gap-1">🔒 256-bit Secure</span>
                <span>•</span>
                <span className="flex items-center gap-1">⚡ Instant dispatch</span>
                <span>•</span>
                <span className="flex items-center gap-1">💬 SMS Update</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── PREORDER SCHEDULE MODAL (Phase 10C) ─────────────────────────────── */}
      {scheduleOpen && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center animate-fadeIn">
          <div
            className="absolute inset-0 bg-neutral-900/60 dark:bg-black/85 backdrop-blur-xs transition-opacity duration-300"
            onClick={() => setScheduleOpen(false)}
          />
          <div className="relative bg-white dark:bg-[#141412] w-full md:max-w-xl rounded-t-[32px] md:rounded-[32px] max-h-[92vh] overflow-y-auto shadow-2xl border border-[#EFECE6] dark:border-[#1F1F1C] animate-slideUp transition-colors duration-300">
            <div className="flex flex-col px-6 pt-6 pb-4 border-b border-[#EFECE6] dark:border-[#1F1F1C] sticky top-0 bg-white dark:bg-[#141412] z-10">
              <div className="flex items-center justify-between mb-1.5">
                <h2 className="text-lg font-extrabold text-neutral-900 dark:text-neutral-50 tracking-tight leading-none">Schedule Future Order</h2>
                <button
                  onClick={() => setScheduleOpen(false)}
                  className="w-9 h-9 bg-stone-50 dark:bg-[#1E1E1C] rounded-2xl flex items-center justify-center text-[#7A7368] hover:text-neutral-900 hover:bg-stone-100 dark:hover:bg-stone-900 transition-colors border border-[#EFECE6] dark:border-[#1F1F1C]"
                >
                  ✕
                </button>
              </div>
              <p className="text-xs text-[#7A7368] dark:text-[#A19B91] font-semibold leading-relaxed">Our kitchen is currently resting. Schedule your preparation for when we are open!</p>
            </div>

            <div className="px-6 py-6 space-y-6">
              {items.length === 0 ? (
                <div className="text-center py-10 bg-stone-50 dark:bg-[#0D0C0B] rounded-3xl border border-[#EFECE6] dark:border-[#1F1F1C] p-6 shadow-sm">
                  <span className="text-3xl">🍲</span>
                  <p className="text-neutral-900 dark:text-neutral-50 font-extrabold text-sm tracking-tight mt-3">Browse menu and add items first</p>
                  <p className="text-xs text-[#7A7368] dark:text-[#A19B91] mt-1.5 mb-5 max-w-xs mx-auto leading-relaxed">Once you add appetizing items to your cart, you can schedule the order delivery time.</p>
                  <button
                    onClick={() => { setScheduleOpen(false); scrollTo("menu"); }}
                    style={{ backgroundColor: primary }}
                    className="text-white font-bold px-6 py-3 rounded-2xl text-xs uppercase tracking-widest active:scale-95 shadow-sm shadow-[var(--brand-primary-20)]"
                  >
                    Browse Selections
                  </button>
                </div>
              ) : (
                <>
                  {/* Delivery / Pickup Toggle */}
                  {(restaurant.deliveryEnabled || restaurant.pickupEnabled) && (
                    <div className="space-y-1.5">
                      <p className="text-[10px] font-black text-[#7A7368] uppercase tracking-wider">Preferred fulfillment mode</p>
                      <div className={`grid gap-1.5 p-1 bg-stone-50 dark:bg-[#0D0C0B] rounded-2xl border border-[#EFECE6] dark:border-[#1F1F1C] ${restaurant.deliveryEnabled && restaurant.pickupEnabled ? "grid-cols-2" : "grid-cols-1"}`}>
                        {restaurant.deliveryEnabled && (
                          <button
                            onClick={() => setDeliveryType("delivery")}
                            className={`py-3 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${
                              deliveryType === "delivery" ? "bg-white dark:bg-[#141412] shadow-sm" : "text-[#7A7368]"
                            }`}
                            style={deliveryType === "delivery" ? { color: primary } : {}}
                          >
                            Doorstep Delivery
                          </button>
                        )}
                        {restaurant.pickupEnabled && (
                          <button
                            onClick={() => setDeliveryType("pickup")}
                            className={`py-3 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${
                              deliveryType === "pickup" ? "bg-white dark:bg-[#141412] shadow-sm" : "text-[#7A7368]"
                            }`}
                            style={deliveryType === "pickup" ? { color: primary } : {}}
                          >
                            Takeaway Pickup
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Schedule Date & Time Selection */}
                  <div className="space-y-3">
                    <p className="text-[10px] font-black text-[#7A7368] uppercase tracking-wider">Fulfillment Schedule Date &amp; Time</p>
                    <div className="grid grid-cols-2 gap-3">
                      <input
                        type="date"
                        value={scheduleDate}
                        onChange={(e) => setScheduleDate(e.target.value)}
                        className="w-full border border-[#EFECE6] dark:border-[#1F1F1C] rounded-2xl px-4 py-3.5 text-sm outline-none text-neutral-900 dark:text-neutral-100 transition-all focus:border-[var(--brand-primary)] bg-[#FAF9F5] dark:bg-[#0D0C0B]"
                      />
                      <input
                        type="time"
                        value={scheduleTime}
                        onChange={(e) => setScheduleTime(e.target.value)}
                        className="w-full border border-[#EFECE6] dark:border-[#1F1F1C] rounded-2xl px-4 py-3.5 text-sm outline-none text-neutral-900 dark:text-neutral-100 transition-all focus:border-[var(--brand-primary)] bg-[#FAF9F5] dark:bg-[#0D0C0B]"
                      />
                    </div>
                  </div>

                  {/* Contact Information Fields */}
                  <div className="space-y-3">
                    <p className="text-[10px] font-black text-[#7A7368] uppercase tracking-wider">Contact Information</p>
                    <input
                      type="text"
                      placeholder="Full name *"
                      value={formData.customerName}
                      onChange={(e) => setFormData({ ...formData, customerName: e.target.value })}
                      className="w-full border border-[#EFECE6] dark:border-[#1F1F1C] rounded-2xl px-4.5 py-4 text-sm outline-none focus:ring-2 focus:ring-[var(--brand-primary-20)] text-neutral-900 dark:text-neutral-100 placeholder-[#A19B91] transition-all bg-[#FAF9F5] dark:bg-[#0D0C0B]"
                      style={{ ["--tw-ring-color" as string]: primary + "40" } as React.CSSProperties}
                      onFocus={(e) => { e.currentTarget.style.borderColor = primary; }}
                      onBlur={(e) => { e.currentTarget.style.borderColor = ""; }}
                    />
                    <input
                      type="tel"
                      placeholder="Phone number *"
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      className="w-full border border-[#EFECE6] dark:border-[#1F1F1C] rounded-2xl px-4.5 py-4 text-sm outline-none focus:ring-2 focus:ring-[var(--brand-primary-20)] text-neutral-900 dark:text-neutral-100 placeholder-[#A19B91] transition-all bg-[#FAF9F5] dark:bg-[#0D0C0B]"
                      onFocus={(e) => { e.currentTarget.style.borderColor = primary; }}
                      onBlur={(e) => { e.currentTarget.style.borderColor = ""; }}
                    />
                  </div>

                  {/* Delivery Address Details */}
                  {deliveryType === "delivery" && (
                    <div className="space-y-1.5">
                      <p className="text-[10px] font-black text-[#7A7368] uppercase tracking-wider">Delivery Destination</p>
                      <textarea
                        placeholder="Enter your full delivery address *"
                        value={formData.address}
                        onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                        rows={2}
                        className="w-full border border-[#EFECE6] dark:border-[#1F1F1C] rounded-2xl px-4.5 py-4 text-sm outline-none focus:ring-2 focus:ring-[var(--brand-primary-20)] text-neutral-900 dark:text-neutral-100 placeholder-[#A19B91] resize-none transition-all bg-[#FAF9F5] dark:bg-[#0D0C0B]"
                        onFocus={(e) => { e.currentTarget.style.borderColor = primary; }}
                        onBlur={(e) => { e.currentTarget.style.borderColor = ""; }}
                      />
                    </div>
                  )}

                  {/* Special Instruction Note */}
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-black text-[#7A7368] uppercase tracking-wider">Dietary instructions / Note (Optional)</p>
                    <textarea
                      placeholder="Special instructions (optional)"
                      value={formData.note}
                      onChange={(e) => setFormData({ ...formData, note: e.target.value })}
                      rows={2}
                      className="w-full border border-[#EFECE6] dark:border-[#1F1F1C] rounded-2xl px-4.5 py-4 text-sm outline-none focus:ring-2 focus:ring-[var(--brand-primary-20)] text-neutral-900 dark:text-neutral-100 placeholder-[#A19B91] resize-none transition-all bg-[#FAF9F5] dark:bg-[#0D0C0B]"
                      onFocus={(e) => { e.currentTarget.style.borderColor = primary; }}
                      onBlur={(e) => { e.currentTarget.style.borderColor = ""; }}
                    />
                  </div>

                  {/* Preorder Billing Summary details */}
                  <div className="bg-stone-50 dark:bg-[#0D0C0B] border border-[#EFECE6] dark:border-[#1F1F1C] rounded-2xl p-5">
                    <p className="text-[10px] font-black text-[#7A7368] uppercase tracking-wider mb-3.5">Fulfillment summary</p>
                    <div className="space-y-2.5 mb-4 max-h-[140px] overflow-y-auto scrollbar-hide">
                      {items.map((item) => (
                        <div key={item.id} className="flex justify-between text-xs font-medium">
                          <span className="text-[#7A7368] dark:text-[#A19B91] font-semibold">{item.quantity}× {item.name}</span>
                          {!restaurant.hidePrices && (
                            <span className="font-extrabold text-neutral-900 dark:text-neutral-100">{fmt(item.quantity * item.price)}</span>
                          )}
                        </div>
                      ))}
                    </div>
                    {restaurant.hidePrices ? (
                      <div className="border-t border-[#EFECE6] dark:border-[#1F1F1C] pt-3.5">
                        <div className="bg-stone-100/50 dark:bg-stone-900/50 border border-dashed border-stone-200 dark:border-stone-800 rounded-xl p-3 text-center">
                          <p className="text-xs font-black text-neutral-700 dark:text-neutral-300">📖 Catalog Order Mode</p>
                          <p className="text-[10px] text-stone-500 dark:text-stone-400 mt-1 leading-relaxed">
                            {deliveryType === "delivery"
                              ? "Please pay cash or card upon preorder dispatch."
                              : "Please pay table-side or at the counter upon order collection."}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="border-t border-[#EFECE6] dark:border-[#1F1F1C] pt-3.5 space-y-2">
                        <div className="flex justify-between text-xs text-[#7A7368] dark:text-[#A19B91]">
                          <span>Selections Subtotal</span>
                          <span>{fmt(subtotal)}</span>
                        </div>
                        {deliveryType === "delivery" && restaurant.deliveryFee > 0 && (
                          <div className="flex justify-between text-xs text-[#7A7368] dark:text-[#A19B91]">
                            <span>Fulfillment Dispatch Fee</span>
                            <span>{fmt(restaurant.deliveryFee)}</span>
                          </div>
                        )}
                        {deliveryType === "dine_in" && (
                          <div className="flex justify-between text-xs text-emerald-600 dark:text-emerald-500 font-bold">
                            <span>Dine In — No delivery fee</span>
                            <span>Free</span>
                          </div>
                        )}
                        <div className="flex justify-between font-black text-base pt-3 border-t border-[#EFECE6] dark:border-[#1F1F1C]">
                          <span className="text-neutral-900 dark:text-neutral-200 font-extrabold">Total Amount Due</span>
                          <span style={{ color: primary }} className="font-black text-lg tracking-tight">{fmt(orderTotal)}</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {restaurant.minimumOrder > 0 && !meetsMinimum && (
                    <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-900/30 rounded-2xl px-4 py-3 mb-4 font-medium leading-relaxed shadow-sm">
                      🍲 Add <span className="font-extrabold">{fmt(restaurant.minimumOrder - subtotal)}</span> more to satisfy the restaurant&apos;s preorder threshold.
                    </div>
                  )}

                  {orderError && (
                    <div className="bg-rose-50 dark:bg-rose-950/20 border border-rose-200/50 dark:border-rose-900/30 text-rose-600 dark:text-rose-400 text-xs md:text-sm font-bold px-4.5 py-4 rounded-2xl leading-relaxed">
                      ⚠️ {orderError}
                    </div>
                  )}

                  <button
                    onClick={handleScheduleSubmit}
                    disabled={isSubmitting || !meetsMinimum}
                    style={meetsMinimum ? { backgroundColor: primary } : {}}
                    className="w-full text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-2.5 transition-all hover:opacity-95 disabled:opacity-60 disabled:bg-stone-200 dark:disabled:bg-stone-850 active:scale-[0.99] text-sm uppercase tracking-widest shadow-md shadow-[var(--brand-primary-20)]"
                  >
                    {isSubmitting ? "Scheduling preorder safely…" : "Confirm Scheduled Preorder"}
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
