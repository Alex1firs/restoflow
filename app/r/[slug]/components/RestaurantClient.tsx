"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useCart } from "./CartContext";
import SEOSections from "./SEOSections";
import LoyaltyCard from "@/app/components/LoyaltyCard";
import { DEFAULT_HERO_SETTINGS, type HeroSettings } from "@/lib/hero-settings";

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
    coverVideo?: string;
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
    heroSettings?: HeroSettings;
    loyaltyEnabled?: boolean;
    deliveryZones?: { id: string; name: string; fee: number }[];
    whatsappNumber?: string;
    showContactSupport?: boolean;
    phone?: string;
    payOnDeliveryEnabled?: boolean;
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

function hexToRgb(hex: string) {
  let clean = hex.replace("#", "");
  if (clean.length === 3) {
    clean = clean.split("").map((c) => c + c).join("");
  }
  const bigint = parseInt(clean, 16) || 0;
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `${r}, ${g}, ${b}`;
}

function formatWhatsAppNumber(phone: string): string {
  const digits = phone.replace(/[^0-9]/g, '');
  if (digits.startsWith('0') && digits.length === 11) {
    return `234${digits.substring(1)}`;
  }
  return digits;
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
  const [selectedDeliveryZoneId, setSelectedDeliveryZoneId] = useState<string>("");
  const [formData, setFormData] = useState({ customerName: "", phone: "", address: "", note: "", tableNumber: initialTable ?? "" });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [trackingToken, setTrackingToken] = useState<string | null>(null);
  const [orderSuccess, setOrderSuccess] = useState(false);
  const [activeTab, setActiveTab] = useState<"menu" | "about" | "faq">("menu");

  const selectTabAndScroll = (tabId: "menu" | "about" | "faq") => {
    setActiveTab(tabId);
    setTimeout(() => {
      scrollTo(tabId);
    }, 50);
  };

  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [visibleSections, setVisibleSections] = useState<Set<string>>(new Set());
  const [promoDismissed, setPromoDismissed] = useState(false);
  const [loyaltyOpen, setLoyaltyOpen] = useState(false);
  const [loyaltyPhone, setLoyaltyPhone] = useState("");
  const [loyaltyLoading, setLoyaltyLoading] = useState(false);
  const [loyaltyProfile, setLoyaltyProfile] = useState<any | null>(null);
  const [loyaltySearched, setLoyaltySearched] = useState(false);
  const [loyaltyError, setLoyaltyError] = useState<string | null>(null);

  const [checkoutZoneSearch, setCheckoutZoneSearch] = useState("");
  const [checkoutZoneOpen, setCheckoutZoneOpen] = useState(false);
  const [scheduleZoneSearch, setScheduleZoneSearch] = useState("");
  const [scheduleZoneOpen, setScheduleZoneOpen] = useState(false);

  const checkoutDropdownRef = useRef<HTMLDivElement>(null);
  const scheduleDropdownRef = useRef<HTMLDivElement>(null);

  const categoryTabsRef = useRef<HTMLDivElement>(null);
  const menuSectionRef = useRef<HTMLElement>(null);
  const aboutSectionRef = useRef<HTMLElement>(null);
  const popularSectionRef = useRef<HTMLElement>(null);
  const faqSectionRef = useRef<HTMLElement>(null);

  const hs = restaurant.heroSettings ?? DEFAULT_HERO_SETTINGS;

  // Dynamic Brand Theme Variables
  const primary = restaurant.primaryColor || "#F26E21"; // premium warm orange accent
  const accent = restaurant.accentColor || primary;
  const rating = restaurant.rating;
  const ordersToday = restaurant.ordersToday;
  const deliveryTime = restaurant.deliveryTime || "20–35 min";

  const categories = [...new Set(menuItems.map((i) => i.category))].filter(Boolean);
  const filteredItems = activeCategory ? menuItems.filter((i) => i.category === activeCategory) : menuItems;
  const subtotal = totalPrice;
  const activeDeliveryZone = restaurant.deliveryZones?.find(z => z.id === selectedDeliveryZoneId);
  const effectiveDeliveryFee = (deliveryType === "pickup" || deliveryType === "dine_in") ? 0 : (activeDeliveryZone ? activeDeliveryZone.fee : restaurant.deliveryFee);
  const orderTotal = subtotal + effectiveDeliveryFee;
  const meetsMinimum = restaurant.hidePrices || restaurant.minimumOrder <= 0 || subtotal >= restaurant.minimumOrder;

  const areas = parseList(seo?.serviceAreas);
  const keywords = parseList(seo?.foodKeywords);
  const popularItems = menuItems.filter((i) => i.available).slice(0, 4);

  const paymentMethods = [
    restaurant.onlinePaymentEnabled ? "Online payment (card/transfer)" : null,
    (restaurant.deliveryEnabled && restaurant.payOnDeliveryEnabled !== false) ? "Cash on delivery" : null,
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
      if (e.key === "Escape") { 
        setCartOpen(false); 
        setCheckoutOpen(false); 
        setLoyaltyOpen(false); 
        setCheckoutZoneOpen(false);
        setScheduleZoneOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Click outside to close searchable location dropdowns
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (checkoutDropdownRef.current && !checkoutDropdownRef.current.contains(e.target as Node)) {
        setCheckoutZoneOpen(false);
      }
      if (scheduleDropdownRef.current && !scheduleDropdownRef.current.contains(e.target as Node)) {
        setScheduleZoneOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  // Google Font preloader for custom visual storefront font pairings
  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=Montserrat:wght@400;700;900&family=Outfit:wght@400;600;800;900&family=Playfair+Display:ital,wght@0,700;0,900;1,700&family=Inter:wght@400;500;700&display=swap";
    document.head.appendChild(link);
    return () => {
      try {
        document.head.removeChild(link);
      } catch {}
    };
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
    document.body.style.overflow = cartOpen || checkoutOpen || scheduleOpen || loyaltyOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [cartOpen, checkoutOpen, scheduleOpen, loyaltyOpen]);


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
  }, [activeTab]);

  const fade = useCallback(
    (id: string) =>
      `transition-all duration-700 ease-out ${
        visibleSections.has(id) ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
      }`,
    [visibleSections]
  );

  const checkLoyaltyBalance = async () => {
    if (!loyaltyPhone.trim()) {
      setLoyaltyError("Please enter your phone number.");
      return;
    }
    setLoyaltyLoading(true);
    setLoyaltyError(null);
    setLoyaltyProfile(null);
    setLoyaltySearched(false);
    try {
      const params = new URLSearchParams({ slug: restaurant.slug, phone: loyaltyPhone.trim() });
      const res = await fetch(`/api/customer/loyalty?${params}`);
      const data = await res.json();
      if (!res.ok || !data.enabled || !data.found) {
        setLoyaltyError("No active loyalty account found. Start earning stamps on your first paid order!");
      } else {
        setLoyaltyProfile(data);
      }
      setLoyaltySearched(true);
    } catch {
      setLoyaltyError("Failed to check balance. Please check your internet connection.");
    } finally {
      setLoyaltyLoading(false);
    }
  };

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
    if (deliveryType === "delivery") {
      if (restaurant.deliveryZones && restaurant.deliveryZones.length > 0 && !selectedDeliveryZoneId) {
        return "Please select a delivery location.";
      }
      if (!formData.address.trim()) return "Please enter your delivery address.";
      if (restaurant.payOnDeliveryEnabled === false && !restaurant.onlinePaymentEnabled) {
        return "Delivery orders are currently unavailable at this store.";
      }
    }
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
    ...(deliveryType === "delivery" && selectedDeliveryZoneId ? { deliveryZoneId: selectedDeliveryZoneId } : {}),
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
          onClick={() => {
            setOrderSuccess(false);
            setOrderId(null);
            setTrackingToken(null);
            setIsScheduledOrder(false);
            setActiveTab("menu");
          }}
          className="text-xs font-bold text-[#7A7368] hover:text-neutral-900 dark:text-[#A19B91] dark:hover:text-white transition-colors py-2 px-4 rounded-full border border-[#EFECE6] dark:border-[#1F1F1C] bg-white dark:bg-[#141412] hover:bg-stone-50"
        >
          Return to Storefront
        </button>
      </div>
    );
  }

  const navSections = [
    { id: "menu", label: hs.navbarMenuTextMenu || "Menu" },
    { id: "about", label: hs.navbarMenuTextInfo || "About" },
    { id: "faq", label: "FAQ" },
  ] as const;

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

      {/* ── HERO ─────────────────────────────────────────────────────────────── */}
      {(() => {
        const getTypographyStyles = () => {
          switch (hs.fontPairing) {
            case "modern-serif":
              return {
                heading: { fontFamily: "'Playfair Display', Georgia, serif", fontWeight: 900 },
                sub: { fontFamily: "'Inter', sans-serif", fontWeight: 400 },
              };
            case "sleek-sans":
              return {
                heading: { fontFamily: "'Outfit', sans-serif", fontWeight: 900 },
                sub: { fontFamily: "'Outfit', sans-serif", fontWeight: 400 },
              };
            case "warm-display":
              return {
                heading: { fontFamily: "'Montserrat', sans-serif", fontWeight: 900 },
                sub: { fontFamily: "'Outfit', sans-serif", fontWeight: 400 },
              };
            default:
              return {
                heading: { fontFamily: "system-ui, sans-serif", fontWeight: 800 },
                sub: { fontFamily: "system-ui, sans-serif", fontWeight: 500 },
              };
          }
        };

        const getOverlayStyle = () => {
          const opacity = (hs.overlayOpacity / 100).toFixed(2);
          const blendMode = hs.overlayBlendMode || "normal";

          const styles: React.CSSProperties = {
            mixBlendMode: blendMode,
          };

          switch (hs.overlayType) {
            case "solid-brand":
              return {
                ...styles,
                background: `rgba(${hexToRgb(primary)}, ${opacity})`,
              };
            case "gradient-brand":
              return {
                ...styles,
                background: `linear-gradient(to top, rgba(${hexToRgb(primary)}, ${opacity}) 0%, rgba(0,0,0,${(hs.overlayOpacity * 0.5 / 100).toFixed(2)}) 80%, rgba(0,0,0,${(hs.overlayOpacity * 0.2 / 100).toFixed(2)}) 100%)`,
              };
            case "custom-solid":
              const customColor = hs.overlayCustomColor || "#000000";
              return {
                ...styles,
                background: `rgba(${hexToRgb(customColor)}, ${opacity})`,
              };
            case "custom-gradient":
              const gradStart = hs.overlayCustomColor || "#000000";
              const gradEnd = hs.overlayGradientColorEnd || "#000000";
              return {
                ...styles,
                background: `linear-gradient(to top, rgba(${hexToRgb(gradStart)}, ${opacity}) 0%, rgba(${hexToRgb(gradEnd)}, ${opacity}) 100%)`,
              };
            case "none":
              return { ...styles, background: "none" };
            default:
              return {
                ...styles,
                background: `linear-gradient(to top, rgba(0,0,0,${opacity}) 0%, rgba(0,0,0,${(hs.overlayOpacity * 0.47 / 100).toFixed(2)}) 50%, rgba(0,0,0,${(hs.overlayOpacity * 0.12 / 100).toFixed(2)}) 100%)`,
              };
          }
        };

        const fonts = getTypographyStyles();
        const oStyle = getOverlayStyle();
        const btnStyleCls = hs.buttonStyle === "pill"
          ? "rounded-full"
          : hs.buttonStyle === "sharp"
          ? "rounded-none"
          : "rounded-xl";

        const isSticky = hs.navbarSticky;
        const isScrolled = scrollY > 50;
        const navbarPosClass = isSticky
          ? "fixed top-0 left-0 right-0 z-[100] transition-all duration-300"
          : "absolute top-0 left-0 right-0 z-20";

        const getNavbarStorefrontStyle = () => {
          const activeBgStyle = isSticky && isScrolled ? hs.navbarBgStyle : (hs.navbarBgStyle === "transparent" ? "transparent" : hs.navbarBgStyle);
          switch (activeBgStyle) {
            case "solid-brand":
              return {
                background: primary,
                color: "#ffffff",
                boxShadow: isScrolled ? "0 4px 20px rgba(0,0,0,0.08)" : "none",
                paddingTop: isScrolled ? "1rem" : "1.25rem",
                paddingBottom: isScrolled ? "1rem" : "1.25rem",
              };
            case "glass-blur":
              return {
                background: isScrolled ? "rgba(255, 255, 255, 0.75)" : "rgba(255, 255, 255, 0.15)",
                backdropFilter: "blur(12px)",
                color: isScrolled ? "#1c1917" : "#ffffff",
                borderBottom: isScrolled ? "1px solid rgba(0, 0, 0, 0.05)" : "1px solid rgba(255, 255, 255, 0.1)",
                boxShadow: isScrolled ? "0 4px 20px rgba(0,0,0,0.05)" : "none",
                paddingTop: isScrolled ? "1rem" : "1.25rem",
                paddingBottom: isScrolled ? "1rem" : "1.25rem",
              };
            case "dark-tint":
              return {
                background: isScrolled ? "rgba(15, 15, 15, 0.85)" : "rgba(0, 0, 0, 0.3)",
                backdropFilter: "blur(8px)",
                color: "#ffffff",
                borderBottom: isScrolled ? "1px solid rgba(255, 255, 255, 0.05)" : "none",
                boxShadow: isScrolled ? "0 4px 20px rgba(0,0,0,0.2)" : "none",
                paddingTop: isScrolled ? "1rem" : "1.25rem",
                paddingBottom: isScrolled ? "1rem" : "1.25rem",
              };
            default: // transparent
              return {
                background: isScrolled
                  ? "rgba(0, 0, 0, 0.6)"
                  : "linear-gradient(to bottom, rgba(0, 0, 0, 0.5), transparent)",
                backdropFilter: isScrolled ? "blur(8px)" : "none",
                color: "#ffffff",
                boxShadow: isScrolled ? "0 4px 20px rgba(0,0,0,0.1)" : "none",
                paddingTop: isScrolled ? "1rem" : "1.25rem",
                paddingBottom: isScrolled ? "1rem" : "1.25rem",
              };
          }
        };

        const navStyle = getNavbarStorefrontStyle();
        const isLightNav = isSticky && isScrolled && hs.navbarBgStyle === "glass-blur";

        return (
          <section
            className={`relative flex flex-col bg-stone-100 dark:bg-stone-900 overflow-hidden ${
              hs.textVerticalPosition === "top" ? "justify-start" : hs.textVerticalPosition === "middle" ? "justify-center" : "justify-end"
            }`}
            style={{ minHeight: `${hs.heroHeight}vh` }}
          >
            {restaurant.coverVideo ? (
              <div
                className="absolute inset-0 z-0 pointer-events-none"
                style={{ transform: `translateY(${scrollY * 0.25}px)` }}
              >
                <video
                  src={restaurant.coverVideo}
                  poster={restaurant.coverImage}
                  autoPlay
                  loop
                  muted
                  playsInline
                  className="w-full h-full object-cover"
                />
                <div
                  className="absolute inset-0"
                  style={oStyle}
                />
              </div>
            ) : restaurant.coverImage ? (
              <div
                className="absolute inset-0 z-0 pointer-events-none"
                style={{ transform: `translateY(${scrollY * 0.25}px)` }}
              >
                <img
                  src={restaurant.coverImage}
                  alt=""
                  className="w-full h-full opacity-90 transition-transform duration-500 scale-100"
                  style={{
                    objectFit: hs.coverObjectFit,
                    objectPosition: `${hs.focalPointX}% ${hs.focalPointY}%`,
                  }}
                />
                <div
                  className="absolute inset-0"
                  style={oStyle}
                />
              </div>
            ) : null}

            {/* Top Navbar */}
            <div
              style={navStyle}
              className={`${navbarPosClass} py-5`}
            >
              <div className="max-w-6xl mx-auto w-full px-6 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {hs.showLogo !== false && restaurant.logo ? (
                    <div
                      className={`overflow-hidden flex-shrink-0 ${isLightNav ? "border border-stone-900/10 shadow-sm bg-white" : "border border-white/20 shadow-md"}`}
                      style={{
                        width: hs.logoWidth,
                        height: hs.logoHeight,
                        borderRadius: hs.logoBorderRadius,
                      }}
                    >
                      <img
                        src={restaurant.logo}
                        alt="logo"
                        className="w-full h-full"
                        style={{
                          objectFit: hs.logoObjectFit,
                          objectPosition: `${hs.logoFocalX}% ${hs.logoFocalY}%`,
                        }}
                      />
                    </div>
                  ) : hs.showLogo !== false ? (
                    <div
                      className={`backdrop-blur-md flex items-center justify-center border flex-shrink-0 ${
                        isLightNav ? "bg-stone-900/10 border-stone-900/10 text-stone-850" : "bg-white/10 border-white/25 text-white"
                      }`}
                      style={{ width: hs.logoWidth, height: hs.logoHeight, borderRadius: hs.logoBorderRadius }}
                    >
                      <span className={`font-extrabold text-sm tracking-tight ${isLightNav ? "text-stone-850" : "text-white"}`}>
                        {restaurant.name.slice(0, 2).toUpperCase()}
                      </span>
                    </div>
                  ) : null}
                </div>

                <div className="hidden md:flex items-center gap-8">
                  {navSections.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => selectTabAndScroll(s.id)}
                      style={{ fontSize: `${hs.navbarFontSize || 11}px` }}
                      className={`font-bold uppercase tracking-widest transition-all hover:scale-105 active:scale-95 ${
                        isLightNav ? "text-stone-600 hover:text-stone-950" : "text-white/80 hover:text-white"
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-3">
                  {restaurant.showContactSupport !== false && (
                    <>
                      {restaurant.phone && (
                        <a
                          href={`tel:${restaurant.phone}`}
                          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border text-[10px] font-black uppercase tracking-wider shadow-sm transition-all hover:scale-105 active:scale-95 ${
                            isLightNav
                              ? "bg-white/80 border-[#EFECE6] text-stone-700 hover:bg-white"
                              : "bg-black/30 border-white/20 text-white hover:bg-black/50"
                          }`}
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
                          <span className="hidden sm:inline">Call Us</span>
                        </a>
                      )}
                      {restaurant.whatsappNumber && (
                        <a
                          href={`https://wa.me/${formatWhatsAppNumber(restaurant.whatsappNumber)}?text=Hi,%20I%20am%20trying%20to%20place%20an%20order%20on%20your%20RestoFlow%20website%20but%20I%20need%20some%20help.`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border text-[10px] font-black uppercase tracking-wider shadow-sm transition-all hover:scale-105 active:scale-95 ${
                            isLightNav
                              ? "bg-green-50 border-green-200 text-green-700 hover:bg-green-100"
                              : "bg-green-500/20 border-green-500/30 text-green-400 hover:bg-green-500/30"
                          }`}
                        >
                          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M12.031 0C5.389 0 0 5.39 0 12.031c0 2.128.552 4.195 1.6 6.02L.153 24l6.096-1.597A11.967 11.967 0 0012.031 24c6.643 0 12.031-5.39 12.031-12.031S18.674 0 12.031 0zM12.031 22A9.97 9.97 0 016.924 20.6l-.366-.217-4.52 1.184 1.2-4.407-.238-.378A9.957 9.957 0 012.062 12.03C2.062 6.53 6.53 2.06 12.031 2.06s9.969 4.47 9.969 9.97-4.468 9.97-9.969 9.97zm5.46-7.466c-.299-.15-1.77-.874-2.045-.975-.274-.1-.475-.15-.674.15-.2.3-.77 1-.945 1.201-.174.202-.349.227-.648.077-.299-.15-1.264-.466-2.408-1.488-.89-.795-1.492-1.778-1.667-2.078-.175-.3 0-.46.149-.611.135-.135.3-.35.45-.525.149-.175.2-.299.299-.5.1-.2.05-.375-.025-.525-.075-.15-.674-1.625-.923-2.225-.244-.588-.493-.508-.674-.518-.175-.01-.375-.01-.574-.01-.2 0-.524.075-.799.375-.275.3-1.048 1.025-1.048 2.5 0 1.475 1.073 2.9 1.223 3.1.15.2 2.115 3.225 5.123 4.525.717.31 1.277.495 1.713.633.72.23 1.375.198 1.892.12.578-.088 1.77-.725 2.02-1.425.25-.7.25-1.3.175-1.425-.075-.125-.275-.2-.575-.35z"/></svg>
                          <span className="hidden sm:inline">WhatsApp</span>
                        </a>
                      )}
                    </>
                  )}
                  {restaurant.loyaltyEnabled && (
                    <button
                      onClick={() => {
                        setLoyaltyOpen(true);
                        setLoyaltyPhone("");
                        setLoyaltyProfile(null);
                        setLoyaltySearched(false);
                        setLoyaltyError(null);
                      }}
                      className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border text-[10px] font-black uppercase tracking-wider shadow-sm transition-all hover:scale-105 active:scale-95 ${
                        isLightNav
                          ? "bg-orange-500/10 border-orange-500/30 text-orange-650 hover:bg-orange-500/20"
                          : "bg-white/10 border-white/20 text-white hover:bg-white/20"
                      }`}
                    >
                      <span>★</span>
                      My Stamps
                    </button>
                  )}
                  {hs.showOpenBadge !== false && (
                    restaurant.isOpen ? (
                      <span className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[10px] font-bold uppercase tracking-wider shadow-sm backdrop-blur-md ${
                        isLightNav
                          ? "bg-emerald-50 border-emerald-250 text-emerald-600"
                          : "bg-emerald-500/20 border-emerald-400/30 text-emerald-400"
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${isLightNav ? "bg-emerald-500 animate-pulse" : "bg-emerald-400 animate-pulse"}`} />
                        Open Now
                      </span>
                    ) : (
                      <span className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[10px] font-bold uppercase tracking-wider shadow-sm backdrop-blur-md ${
                        isLightNav
                          ? "bg-rose-50 border-rose-250 text-rose-600"
                          : "bg-rose-500/20 border-rose-400/30 text-rose-400"
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${isLightNav ? "bg-rose-500" : "bg-rose-400/60"}`} />
                        Closed
                      </span>
                    )
                  )}
                </div>
              </div>
            </div>

            {/* Hero text */}
            <div
              className="relative z-10 max-w-6xl mx-auto w-full px-6 text-white"
              style={{
                paddingBottom: hs.textVerticalPosition === "bottom" ? "3rem" : undefined,
                paddingTop: hs.textVerticalPosition === "top" ? "6rem" : undefined,
                textAlign: hs.textAlign,
              }}
            >
              <div
                className={`space-y-4 ${
                  hs.textAlign === "center" ? "max-w-2xl mx-auto" : hs.textAlign === "right" ? "max-w-2xl ml-auto" : "max-w-2xl"
                }`}
              >
                <h1
                  className="font-black drop-shadow-md animate-fadeIn"
                  style={{
                    ...fonts.heading,
                    fontSize: hs.headingSize,
                    lineHeight: hs.lineHeight / 100,
                    letterSpacing: `${hs.letterSpacing * 0.01}em`,
                  }}
                >
                  {restaurant.name}
                </h1>
                {hs.showSubtitle !== false && restaurant.description && (
                  <p
                    className="text-white/85 drop-shadow-sm font-medium leading-relaxed"
                    style={{
                      ...fonts.sub,
                      fontSize: hs.subtitleSize,
                      lineHeight: hs.lineHeight / 100,
                      letterSpacing: `${hs.letterSpacing * 0.01}em`,
                    }}
                  >
                    {restaurant.description}
                  </p>
                )}

                {/* Cuisine tags */}
                {hs.showTags !== false && keywords.length > 0 && (
                  <div className={`flex flex-wrap gap-1.5 pt-1 ${hs.textAlign === "center" ? "justify-center" : hs.textAlign === "right" ? "justify-end" : ""}`}>
                    {keywords.slice(0, 4).map((k) => (
                      <span key={k} className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-white/15 border border-white/10 backdrop-blur-sm">
                        {k}
                      </span>
                    ))}
                  </div>
                )}

                {/* Metrics */}
                {hs.showTags !== false && (
                  <div className={`grid grid-cols-3 gap-3 pt-4 border-t border-white/15 max-w-md ${hs.textAlign === "center" ? "mx-auto" : hs.textAlign === "right" ? "ml-auto" : ""}`}>
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center flex-shrink-0">
                        <span className="text-sm">⭐</span>
                      </div>
                      <div>
                        <p className="text-[10px] text-white/50 uppercase font-black tracking-wider">Rating</p>
                        <p className="text-xs font-bold text-white">{rating ? rating.toFixed(1) : "4.8"}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center flex-shrink-0">
                        <span className="text-sm">⏱️</span>
                      </div>
                      <div>
                        <p className="text-[10px] text-white/50 uppercase font-black tracking-wider">Speed</p>
                        <p className="text-xs font-bold text-white">{deliveryTime}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center flex-shrink-0">
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
                )}

                {/* Hero Button CTAs */}
                <div
                  className={`flex gap-3 pt-2.5 ${
                    hs.textAlign === "center" ? "justify-center" : hs.textAlign === "right" ? "justify-end" : ""
                  }`}
                >
                  <button
                    onClick={() => selectTabAndScroll("menu")}
                    style={{ backgroundColor: primary }}
                    className={`text-white text-xs font-black uppercase tracking-wider py-3.5 px-6 shadow-md shadow-[var(--brand-primary-10)] active:scale-95 transition-all hover:opacity-95 ${btnStyleCls}`}
                  >
                    {hs.primaryCtaText || "Order Online"}
                  </button>

                  {hs.showSecondaryCta && (
                    <button
                      onClick={() => setScheduleOpen(true)}
                      className={`text-white text-xs font-black uppercase tracking-wider py-3.5 px-6 bg-white/15 border border-white/15 backdrop-blur-md active:scale-[0.97] transition-all hover:bg-white/20 ${btnStyleCls}`}
                    >
                      {hs.secondaryCtaText || "Schedule Preorder"}
                    </button>
                  )}
                </div>

              </div>
            </div>
          </section>
        );
      })()}

      {/* Dynamic CSS styles for B2B partners marquee scroll animation */}
      <style>{`
        @keyframes marqueeStorefront {
          0% { transform: translateX(0%); }
          100% { transform: translateX(-50%); }
        }
        .animate-marquee-storefront {
          display: flex;
          width: max-content;
          animation: marqueeStorefront 30s linear infinite;
        }
        .animate-marquee-storefront:hover {
          animation-play-state: paused;
        }
      `}</style>

      {/* ── B2B Partners Showcase Section (Phase 10H) ────────────────────────── */}
      {hs.showPartnersSection !== false && (
        <div className="bg-white dark:bg-[#0D0C0B] py-4 border-b border-[#EFECE6] dark:border-[#1F1F1C] overflow-hidden">
          <div className="max-w-6xl mx-auto px-6">
            <p className="text-[10px] font-black text-[#A19B91] dark:text-neutral-500 uppercase tracking-widest text-center mb-2.5">
              {hs.partnersSectionTitle || "Our Partners"}
            </p>

            {hs.partnersStyle === "stagnant" ? (
              <div className="flex flex-wrap justify-center items-center gap-3.5 py-1">
                {[
                  { name: "Grills Capitol", icon: "🔥" },
                  { name: "Sweet Treats", icon: "🍰" },
                  { name: "The Noodle Box", icon: "🍜" },
                  { name: "Burger Craft", icon: "🍔" },
                  { name: "Pasta & Co", icon: "🍝" },
                ].map((partner, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center gap-2 text-xs font-extrabold text-[#7A7368] dark:text-[#A19B91] bg-stone-50 dark:bg-[#141412] border border-[#EFECE6] dark:border-[#1F1F1C] px-3.5 py-1.5 rounded-2xl shadow-sm hover:scale-105 active:scale-95 transition-all"
                  >
                    <span className="w-5 h-5 rounded-lg bg-stone-100 dark:bg-stone-900 flex items-center justify-center text-xs shadow-inner">
                      {partner.icon}
                    </span>
                    {partner.name}
                  </span>
                ))}
              </div>
            ) : (
              <div className="relative overflow-hidden w-full h-9 flex items-center">
                {/* Fade overlays for left & right marquee edges */}
                <div className="absolute left-0 top-0 bottom-0 w-16 bg-gradient-to-r from-white dark:from-[#0D0C0B] to-transparent z-10 pointer-events-none" />
                <div className="absolute right-0 top-0 bottom-0 w-16 bg-gradient-to-l from-white dark:from-[#0D0C0B] to-transparent z-10 pointer-events-none" />

                <div className="flex gap-10 whitespace-nowrap animate-marquee-storefront py-1">
                  {[
                    { name: "Grills Capitol", icon: "🔥" },
                    { name: "Sweet Treats", icon: "🍰" },
                    { name: "The Noodle Box", icon: "🍜" },
                    { name: "Burger Craft", icon: "🍔" },
                    { name: "Pasta & Co", icon: "🍝" },
                  ].map((partner, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center gap-2 text-xs font-extrabold text-[#7A7368] dark:text-[#A19B91] bg-stone-50 dark:bg-[#141412] border border-[#EFECE6] dark:border-[#1F1F1C] px-3.5 py-1.5 rounded-2xl shadow-sm cursor-pointer hover:border-[var(--brand-primary)] transition-all"
                    >
                      <span className="w-5 h-5 rounded-lg bg-stone-100 dark:bg-stone-900 flex items-center justify-center text-xs shadow-inner">
                        {partner.icon}
                      </span>
                      {partner.name}
                    </span>
                  ))}
                  {/* Duplicate set for infinite loop scrolling */}
                  {[
                    { name: "Grills Capitol", icon: "🔥" },
                    { name: "Sweet Treats", icon: "🍰" },
                    { name: "The Noodle Box", icon: "🍜" },
                    { name: "Burger Craft", icon: "🍔" },
                    { name: "Pasta & Co", icon: "🍝" },
                  ].map((partner, idx) => (
                    <span
                      key={`dup-${idx}`}
                      className="inline-flex items-center gap-2 text-xs font-extrabold text-[#7A7368] dark:text-[#A19B91] bg-stone-50 dark:bg-[#141412] border border-[#EFECE6] dark:border-[#1F1F1C] px-3.5 py-1.5 rounded-2xl shadow-sm cursor-pointer hover:border-[var(--brand-primary)] transition-all"
                    >
                      <span className="w-5 h-5 rounded-lg bg-stone-100 dark:bg-stone-900 flex items-center justify-center text-xs shadow-inner">
                        {partner.icon}
                      </span>
                      {partner.name}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Promo Banner ─────────────────────────────────────────────────────── */}
      {restaurant.promoBanner && !promoDismissed && (
        <div className="bg-gradient-to-r from-orange-500 to-amber-500 text-white px-6 py-3.5 shadow-sm">
          <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
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
        <div className="max-w-6xl mx-auto px-6 w-full flex items-center justify-between">
          <div className="flex gap-1.5 overflow-x-auto scrollbar-hide py-1">
            {navSections.map((s) => (
              <button
                key={s.id}
                onClick={() => selectTabAndScroll(s.id)}
                style={activeTab === s.id ? { backgroundColor: primary } : {}}
                className={`flex-shrink-0 px-4.5 py-2 rounded-full text-xs font-black uppercase tracking-wider transition-all ${
                  activeTab === s.id
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

      {/* ── MENU EXPERIENCE REDESIGN (Phase 10B) ──────────────────────────────── */}
      {activeTab === "menu" && (
        <>
          <div
            style={{
              background:
                hs.menuBgColorType === "solid"
                  ? hs.menuCustomBgColor || undefined
                  : hs.menuBgColorType === "gradient"
                  ? hs.menuCustomGradient || undefined
                  : undefined,
            }}
            className="w-full transition-all duration-300"
          >
        <section id="menu" ref={menuSectionRef} className="scroll-mt-24 max-w-6xl mx-auto px-6 pt-12 pb-12">
          <div className="mb-8">
            {hs.menuShowHeaderLabel !== false && (
              <div
                className={`mb-1 ${
                  hs.menuCardTextAlign === "center"
                    ? "text-center"
                    : hs.menuCardTextAlign === "right"
                    ? "text-end"
                    : ""
                }`}
              >
                <span
                  style={{
                    fontSize: `${hs.menuLabelSize || 10}px`,
                    color: primary,
                  }}
                  className="font-black uppercase tracking-wider"
                >
                  {hs.menuHeaderLabelText || "Elite Gastronomy"}
                </span>
              </div>
            )}
            
            <div
              className={`${
                hs.menuCardTextAlign === "center"
                  ? "text-center"
                  : hs.menuCardTextAlign === "right"
                  ? "text-end"
                  : ""
              }`}
            >
              <h2
                style={{
                  fontSize: `${hs.menuTitleSize || 30}px`,
                }}
                className="font-extrabold text-neutral-900 dark:text-neutral-50 tracking-tight mt-0.5"
              >
                {hs.menuTitleText || "Explore Culinary Menu"}
              </h2>
            </div>

            {hs.menuShowDescription !== false && (
              <p
                style={{
                  fontSize: `${hs.menuDescriptionSize || 14}px`,
                }}
                className={`text-[#7A7368] dark:text-[#A19B91] mt-2 max-w-xl leading-relaxed ${
                  hs.menuCardTextAlign === "center"
                    ? "mx-auto text-center"
                    : hs.menuCardTextAlign === "right"
                    ? "ml-auto text-end"
                    : ""
                }`}
              >
                {hs.menuDescriptionText || "Explore freshly made signature dishes, snacks, side selections, beverages, and desserts."}
              </p>
            )}
          </div>

          {/* Scrollable menu category pills */}
          <div
            style={{
              backgroundColor:
                hs.menuBgColorType === "solid"
                  ? hs.menuCustomBgColor
                    ? `${hs.menuCustomBgColor}f2`
                    : undefined
                  : undefined,
            }}
            className="sticky top-[58px] z-20 bg-[#FAF9F5]/95 dark:bg-[#0D0C0B]/95 backdrop-blur-md py-3.5 border-b border-[#EFECE6] dark:border-[#1F1F1C] -mx-6 px-6 overflow-x-auto scrollbar-hide transition-all duration-300"
          >
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
                className={`grid gap-6 ${
                  hs.menuColumns === 1
                    ? "grid-cols-1"
                    : hs.menuColumns === 2
                    ? "grid-cols-1 sm:grid-cols-2"
                    : hs.menuColumns === 3
                    ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
                    : hs.menuColumns === 4
                    ? "grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4"
                    : "grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
                } ${fade("menu-grid")}`}
              >
                {filteredItems.map((item, idx) => {
                  const cartItem = items.find((i) => i.id === item.id);
                  const qty = cartItem?.quantity ?? 0;
                  return (
                    <div
                      key={item.id}
                      style={{
                        borderRadius: `${hs.menuCardBorderRadius ?? 16}px`,
                        backgroundColor:
                          hs.menuCardBgStyle === "custom"
                            ? hs.menuCardCustomBgColor || undefined
                            : hs.menuCardBgStyle === "transparent"
                            ? "transparent"
                            : undefined,
                      }}
                      className={`group flex flex-col transition-all duration-300 shadow-[0_4px_25px_rgba(0,0,0,0.01)] border ${
                        hs.menuCardBgStyle === "transparent" ? "bg-transparent border-transparent shadow-none" : "bg-white dark:bg-[#141412] border-[#EFECE6] dark:border-[#1F1F1C]"
                      } ${
                        item.available
                          ? "hover:border-[var(--brand-primary)] dark:hover:border-[var(--brand-primary)] hover:shadow-xl hover:-translate-y-1.5"
                          : "opacity-65"
                      }`}
                    >
                      <div
                        style={{
                          height: `${hs.menuCardImageHeight || 180}px`,
                          borderTopLeftRadius: `${hs.menuCardBorderRadius ?? 16}px`,
                          borderTopRightRadius: `${hs.menuCardBorderRadius ?? 16}px`,
                          backgroundColor:
                            hs.menuCardImageFit === "contain"
                              ? hs.menuCardBgStyle === "custom"
                                ? hs.menuCardCustomBgColor || "#ffffff"
                                : "#ffffff"
                              : undefined,
                        }}
                        className="relative overflow-hidden bg-stone-50 dark:bg-stone-900/60 flex-shrink-0 transition-all duration-300"
                      >
                        {hs.menuShowBadge !== false && idx < 3 && item.available && (
                          <div
                            style={{ backgroundColor: primary }}
                            className="absolute top-3 left-3 z-10 text-white text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg shadow-sm"
                          >
                            {hs.menuBadgeText || "Popular"}
                          </div>
                        )}
                        <img
                          src={getItemImage(item)}
                          alt={item.name}
                          style={{
                            objectFit: hs.menuCardImageFit || "cover",
                          }}
                          className="w-full h-full transition-transform duration-500 group-hover:scale-105"
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
                      <div
                        className={`p-5 flex flex-col flex-1 ${
                          hs.menuCardTextAlign === "center"
                            ? "text-center"
                            : hs.menuCardTextAlign === "right"
                            ? "text-end"
                            : "text-start"
                        }`}
                      >
                        <div
                          className={`flex justify-between items-start gap-2 mb-1.5 ${
                            hs.menuCardTextAlign === "center"
                              ? "flex-col items-center"
                              : hs.menuCardTextAlign === "right"
                              ? "flex-row-reverse"
                              : "flex-row"
                          }`}
                        >
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
    </div>

      {/* ── Chef Specialties Showcase (Phase 10G) ───────────────────────────── */}
      {popularItems.length > 0 && (
        <section id="popular" ref={popularSectionRef} className="scroll-mt-24 border-t border-[#EFECE6] dark:border-[#1F1F1C] bg-white dark:bg-[#141412] transition-colors duration-300">
          <div className="max-w-6xl mx-auto px-6 py-16">
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
    </>
  )}

      {/* ── ABOUT SECTION (Phase 10D) ────────────────────────────────────────── */}
      {activeTab === "about" && (
        <section id="about" ref={aboutSectionRef} className="scroll-mt-24 bg-white dark:bg-[#141412] border-t border-[#EFECE6] dark:border-[#1F1F1C] transition-colors duration-300">
        <div className="max-w-6xl mx-auto px-6 py-16">
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
    )}

      {/* ── FAQ SECTION (Phase 10I) ──────────────────────────────────────────── */}
      {activeTab === "faq" && (
        <section id="faq" ref={faqSectionRef} className="scroll-mt-24 bg-[#FAF9F5] dark:bg-[#0D0C0B] border-t border-[#EFECE6] dark:border-[#1F1F1C] transition-colors duration-300">
        <div className="max-w-6xl mx-auto px-6 py-16">
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
    )}

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
            hidePrices: restaurant.hidePrices,
          }}
          seo={seo}
          menuItems={menuItems}
        />
      )}

      {/* ── FOOTER ────────────────────────────────────────────────────────────── */}
      <footer className="border-t border-[#EFECE6] dark:border-[#1F1F1C] bg-white dark:bg-[#141412] transition-colors duration-300">
        <div className="max-w-6xl mx-auto px-6 py-16">
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
                onClick={() => selectTabAndScroll("menu")}
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
          <div className="max-w-6xl mx-auto flex items-center gap-4">
            {totalItems === 0 ? (
              <div className="flex gap-2 w-full">
                <button
                  onClick={() => scrollTo("menu")}
                  style={{ backgroundColor: primary }}
                  className="flex-1 text-white font-bold py-4.5 rounded-2xl flex items-center justify-center gap-2.5 transition-opacity hover:opacity-95 active:scale-[0.99] shadow-lg shadow-[var(--brand-primary-20)]"
                >
                  <svg className="w-5 h-5 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                  <span className="text-xs md:text-sm font-black uppercase tracking-wider">Browse &amp; Preorder</span>
                </button>
                {restaurant.showContactSupport !== false && restaurant.phone && (
                  <a
                    href={`tel:${restaurant.phone}`}
                    className="flex-1 text-[#7A7368] dark:text-[#A19B91] bg-white dark:bg-[#1E1E1C] border border-[#EFECE6] dark:border-[#1F1F1C] font-bold py-4.5 rounded-2xl flex items-center justify-center gap-2.5 transition-opacity hover:opacity-95 active:scale-[0.99] shadow-sm"
                  >
                    <svg className="w-5 h-5 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
                    <span className="text-xs md:text-sm font-black uppercase tracking-wider">Need Help? Call Us</span>
                  </a>
                )}
                {restaurant.showContactSupport !== false && restaurant.whatsappNumber && (
                  <a
                    href={`https://wa.me/${formatWhatsAppNumber(restaurant.whatsappNumber)}?text=Hi,%20I%20am%20trying%20to%20place%20an%20order%20on%20your%20RestoFlow%20website%20but%20I%20need%20some%20help.`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 text-green-700 dark:text-green-500 bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/30 font-bold py-4.5 rounded-2xl flex items-center justify-center gap-2.5 transition-opacity hover:opacity-95 active:scale-[0.99] shadow-sm"
                  >
                    <svg className="w-5 h-5 animate-pulse" fill="currentColor" viewBox="0 0 24 24"><path d="M12.031 0C5.389 0 0 5.39 0 12.031c0 2.128.552 4.195 1.6 6.02L.153 24l6.096-1.597A11.967 11.967 0 0012.031 24c6.643 0 12.031-5.39 12.031-12.031S18.674 0 12.031 0zM12.031 22A9.97 9.97 0 016.924 20.6l-.366-.217-4.52 1.184 1.2-4.407-.238-.378A9.957 9.957 0 012.062 12.03C2.062 6.53 6.53 2.06 12.031 2.06s9.969 4.47 9.969 9.97-4.468 9.97-9.969 9.97zm5.46-7.466c-.299-.15-1.77-.874-2.045-.975-.274-.1-.475-.15-.674.15-.2.3-.77 1-.945 1.201-.174.202-.349.227-.648.077-.299-.15-1.264-.466-2.408-1.488-.89-.795-1.492-1.778-1.667-2.078-.175-.3 0-.46.149-.611.135-.135.3-.35.45-.525.149-.175.2-.299.299-.5.1-.2.05-.375-.025-.525-.075-.15-.674-1.625-.923-2.225-.244-.588-.493-.508-.674-.518-.175-.01-.375-.01-.574-.01-.2 0-.524.075-.799.375-.275.3-1.048 1.025-1.048 2.5 0 1.475 1.073 2.9 1.223 3.1.15.2 2.115 3.225 5.123 4.525.717.31 1.277.495 1.713.633.72.23 1.375.198 1.892.12.578-.088 1.77-.725 2.02-1.425.25-.7.25-1.3.175-1.425-.075-.125-.275-.2-.575-.35z"/></svg>
                    <span className="text-xs md:text-sm font-black uppercase tracking-wider">WhatsApp Support</span>
                  </a>
                )}
                {restaurant.loyaltyEnabled && (
                  <button
                    onClick={() => {
                      setLoyaltyOpen(true);
                      setLoyaltyPhone("");
                      setLoyaltyProfile(null);
                      setLoyaltySearched(false);
                      setLoyaltyError(null);
                    }}
                    className="px-5 rounded-2xl bg-white dark:bg-[#1E1E1C] border border-[#EFECE6] dark:border-[#1F1F1C] hover:border-orange-500/40 dark:hover:border-orange-500/40 flex items-center justify-center gap-2 text-[#7A7368] dark:text-[#A19B91] hover:text-orange-650 active:scale-95 transition-all shadow-sm"
                  >
                    <span className="text-lg">⭐</span>
                    <span className="hidden sm:inline text-xs font-black uppercase tracking-wider">Loyalty Stamps</span>
                  </button>
                )}
              </div>
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
              {restaurant.showContactSupport !== false && (restaurant.phone || restaurant.whatsappNumber) && (
                <div className="bg-[#FAF9F5] dark:bg-[#1E1E1C] border border-[#EFECE6] dark:border-[#1F1F1C] rounded-2xl p-4 flex items-center justify-between shadow-sm flex-wrap gap-3">
                  <div>
                    <h3 className="text-sm font-black text-neutral-900 dark:text-neutral-50 tracking-tight">Need help placing your order?</h3>
                    <p className="text-xs text-[#7A7368] dark:text-[#A19B91] mt-0.5">Reach out to our support team.</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {restaurant.phone && (
                      <a href={`tel:${restaurant.phone}`} className="bg-white dark:bg-[#0D0C0B] border border-[#EFECE6] dark:border-[#1F1F1C] hover:border-[var(--brand-primary)] text-neutral-900 dark:text-neutral-100 font-bold px-4 py-2 rounded-xl text-xs flex items-center gap-2 transition-all shadow-sm active:scale-95">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
                        Call Now
                      </a>
                    )}
                    {restaurant.whatsappNumber && (
                      <a 
                        href={`https://wa.me/${formatWhatsAppNumber(restaurant.whatsappNumber)}?text=Hi,%20I%20am%20trying%20to%20place%20an%20order%20on%20your%20RestoFlow%20website%20but%20I%20need%20some%20help.`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="bg-[#25D366] hover:bg-[#20bd5a] text-white font-bold px-4 py-2 rounded-xl text-xs flex items-center gap-2 transition-all shadow-sm active:scale-95 border border-transparent"
                      >
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12.031 0C5.389 0 0 5.39 0 12.031c0 2.128.552 4.195 1.6 6.02L.153 24l6.096-1.597A11.967 11.967 0 0012.031 24c6.643 0 12.031-5.39 12.031-12.031S18.674 0 12.031 0zM12.031 22A9.97 9.97 0 016.924 20.6l-.366-.217-4.52 1.184 1.2-4.407-.238-.378A9.957 9.957 0 012.062 12.03C2.062 6.53 6.53 2.06 12.031 2.06s9.969 4.47 9.969 9.97-4.468 9.97-9.969 9.97zm5.46-7.466c-.299-.15-1.77-.874-2.045-.975-.274-.1-.475-.15-.674.15-.2.3-.77 1-.945 1.201-.174.202-.349.227-.648.077-.299-.15-1.264-.466-2.408-1.488-.89-.795-1.492-1.778-1.667-2.078-.175-.3 0-.46.149-.611.135-.135.3-.35.45-.525.149-.175.2-.299.299-.5.1-.2.05-.375-.025-.525-.075-.15-.674-1.625-.923-2.225-.244-.588-.493-.508-.674-.518-.175-.01-.375-.01-.574-.01-.2 0-.524.075-.799.375-.275.3-1.048 1.025-1.048 2.5 0 1.475 1.073 2.9 1.223 3.1.15.2 2.115 3.225 5.123 4.525.717.31 1.277.495 1.713.633.72.23 1.375.198 1.892.12.578-.088 1.77-.725 2.02-1.425.25-.7.25-1.3.175-1.425-.075-.125-.275-.2-.575-.35z"/></svg>
                        WhatsApp
                      </a>
                    )}
                  </div>
                </div>
              )}
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
                <div className="space-y-4 animate-scaleUp">
                  {restaurant.deliveryZones && restaurant.deliveryZones.length > 0 && (
                    <div className="space-y-1.5" ref={checkoutDropdownRef}>
                      <p className="text-[10px] font-black text-[#7A7368] uppercase tracking-wider">Delivery Zone *</p>
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => {
                            setCheckoutZoneOpen(!checkoutZoneOpen);
                            setCheckoutZoneSearch("");
                          }}
                          className="w-full border border-[#EFECE6] dark:border-[#1F1F1C] rounded-2xl px-4.5 py-4 text-sm outline-none text-left flex items-center justify-between transition-all bg-[#FAF9F5] dark:bg-[#0D0C0B]"
                          style={{ borderColor: checkoutZoneOpen ? primary : "" }}
                        >
                          <span className={selectedDeliveryZoneId ? "text-neutral-900 dark:text-neutral-100 font-medium" : "text-[#A19B91]"}>
                            {selectedDeliveryZoneId 
                              ? `${restaurant.deliveryZones.find(z => z.id === selectedDeliveryZoneId)?.name} (${fmt(restaurant.deliveryZones.find(z => z.id === selectedDeliveryZoneId)?.fee || 0)})`
                              : "Search or select your delivery area *"
                            }
                          </span>
                          <span className="text-[#A19B91] transition-transform duration-200" style={{ transform: checkoutZoneOpen ? "rotate(180deg)" : "" }}>
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                          </span>
                        </button>

                        {checkoutZoneOpen && (
                          <div className="absolute left-0 right-0 mt-2 bg-white dark:bg-[#141412] border border-[#EFECE6] dark:border-[#1F1F1C] rounded-2xl shadow-xl z-50 overflow-hidden animate-fadeIn">
                            <div className="p-3 border-b border-[#EFECE6] dark:border-[#1F1F1C]">
                              <div className="relative">
                                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#A19B91]">
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                                </span>
                                <input
                                  type="text"
                                  placeholder="Type to search location..."
                                  value={checkoutZoneSearch}
                                  onChange={(e) => setCheckoutZoneSearch(e.target.value)}
                                  className="w-full bg-[#FAF9F5] dark:bg-[#0D0C0B] border border-[#EFECE6] dark:border-[#1F1F1C] rounded-xl pl-9.5 pr-4 py-2.5 text-xs outline-none text-neutral-900 dark:text-neutral-100 focus:border-[var(--brand-primary)]"
                                  autoFocus
                                />
                              </div>
                            </div>
                            <div className="max-h-60 overflow-y-auto py-1">
                              {(() => {
                                const filtered = restaurant.deliveryZones.filter(z => 
                                  z.name.toLowerCase().includes(checkoutZoneSearch.toLowerCase())
                                );
                                if (filtered.length === 0) {
                                  return (
                                    <div className="px-4 py-6 text-center text-xs text-[#A19B91]">
                                      No delivery locations found.
                                    </div>
                                  );
                                }
                                return filtered.map(z => (
                                  <button
                                    key={z.id}
                                    type="button"
                                    onClick={() => {
                                      setSelectedDeliveryZoneId(z.id);
                                      setCheckoutZoneOpen(false);
                                    }}
                                    className={`w-full text-left px-4.5 py-3 text-xs hover:bg-[#FAF9F5] dark:hover:bg-[#1E1E1C] transition-colors flex items-center justify-between ${z.id === selectedDeliveryZoneId ? "bg-orange-50/50 dark:bg-orange-950/10 font-bold" : ""}`}
                                  >
                                    <span className="text-neutral-950 dark:text-neutral-50">{z.name}</span>
                                    <span className="text-[#7A7368] font-mono">{fmt(z.fee)}</span>
                                  </button>
                                ));
                              })()}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-black text-[#7A7368] uppercase tracking-wider">Delivery Destination *</p>
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
                  !(deliveryType === "delivery" && restaurant.payOnDeliveryEnabled === false) ? (
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
                    <div className="bg-rose-50 dark:bg-rose-950/20 border border-rose-200/50 dark:border-rose-900/30 text-rose-600 dark:text-rose-400 text-xs md:text-sm font-bold px-4.5 py-4 rounded-2xl leading-relaxed text-center">
                      ⚠️ Delivery orders are not available with cash. Please select Pickup or Dine-in.
                    </div>
                  )
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
                    {!(deliveryType === "delivery" && restaurant.payOnDeliveryEnabled === false) ? (
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
                    ) : !restaurant.onlinePaymentEnabled ? (
                      <div className="bg-rose-50 dark:bg-rose-950/20 border border-rose-200/50 dark:border-rose-900/30 text-rose-600 dark:text-rose-400 text-xs md:text-sm font-bold px-4.5 py-4 rounded-2xl leading-relaxed text-center">
                        ⚠️ Delivery orders are not available with cash. Please select Pickup or Dine-in.
                      </div>
                    ) : null}
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
                    <div className="space-y-4">
                      {restaurant.deliveryZones && restaurant.deliveryZones.length > 0 && (
                        <div className="space-y-1.5" ref={scheduleDropdownRef}>
                          <p className="text-[10px] font-black text-[#7A7368] uppercase tracking-wider">Delivery Zone *</p>
                          <div className="relative">
                            <button
                              type="button"
                              onClick={() => {
                                setScheduleZoneOpen(!scheduleZoneOpen);
                                setScheduleZoneSearch("");
                              }}
                              className="w-full border border-[#EFECE6] dark:border-[#1F1F1C] rounded-2xl px-4.5 py-4 text-sm outline-none text-left flex items-center justify-between transition-all bg-[#FAF9F5] dark:bg-[#0D0C0B]"
                              style={{ borderColor: scheduleZoneOpen ? primary : "" }}
                            >
                              <span className={selectedDeliveryZoneId ? "text-neutral-900 dark:text-neutral-100 font-medium" : "text-[#A19B91]"}>
                                {selectedDeliveryZoneId 
                                  ? `${restaurant.deliveryZones.find(z => z.id === selectedDeliveryZoneId)?.name} (${fmt(restaurant.deliveryZones.find(z => z.id === selectedDeliveryZoneId)?.fee || 0)})`
                                  : "Search or select your delivery area *"
                                }
                              </span>
                              <span className="text-[#A19B91] transition-transform duration-200" style={{ transform: scheduleZoneOpen ? "rotate(180deg)" : "" }}>
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                              </span>
                            </button>

                            {scheduleZoneOpen && (
                              <div className="absolute left-0 right-0 mt-2 bg-white dark:bg-[#141412] border border-[#EFECE6] dark:border-[#1F1F1C] rounded-2xl shadow-xl z-50 overflow-hidden animate-fadeIn">
                                <div className="p-3 border-b border-[#EFECE6] dark:border-[#1F1F1C]">
                                  <div className="relative">
                                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#A19B91]">
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                                    </span>
                                    <input
                                      type="text"
                                      placeholder="Type to search location..."
                                      value={scheduleZoneSearch}
                                      onChange={(e) => setScheduleZoneSearch(e.target.value)}
                                      className="w-full bg-[#FAF9F5] dark:bg-[#0D0C0B] border border-[#EFECE6] dark:border-[#1F1F1C] rounded-xl pl-9.5 pr-4 py-2.5 text-xs outline-none text-neutral-900 dark:text-neutral-100 focus:border-[var(--brand-primary)]"
                                      autoFocus
                                    />
                                  </div>
                                </div>
                                <div className="max-h-60 overflow-y-auto py-1">
                                  {(() => {
                                    const filtered = restaurant.deliveryZones.filter(z => 
                                      z.name.toLowerCase().includes(scheduleZoneSearch.toLowerCase())
                                    );
                                    if (filtered.length === 0) {
                                      return (
                                        <div className="px-4 py-6 text-center text-xs text-[#A19B91]">
                                          No delivery locations found.
                                        </div>
                                      );
                                    }
                                    return filtered.map(z => (
                                      <button
                                        key={z.id}
                                        type="button"
                                        onClick={() => {
                                          setSelectedDeliveryZoneId(z.id);
                                          setScheduleZoneOpen(false);
                                        }}
                                        className={`w-full text-left px-4.5 py-3 text-xs hover:bg-[#FAF9F5] dark:hover:bg-[#1E1E1C] transition-colors flex items-center justify-between ${z.id === selectedDeliveryZoneId ? "bg-orange-50/50 dark:bg-orange-950/10 font-bold" : ""}`}
                                      >
                                        <span className="text-neutral-950 dark:text-neutral-50">{z.name}</span>
                                        <span className="text-[#7A7368] font-mono">{fmt(z.fee)}</span>
                                      </button>
                                    ));
                                  })()}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                      <div className="space-y-1.5">
                        <p className="text-[10px] font-black text-[#7A7368] uppercase tracking-wider">Delivery Destination *</p>
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

      {/* ── CUSTOMER LOYALTY LOOKUP MODAL ────────────────────────────────────── */}
      {loyaltyOpen && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center animate-fadeIn">
          <div
            className="absolute inset-0 bg-neutral-900/60 dark:bg-black/85 backdrop-blur-xs transition-opacity duration-300"
            onClick={() => setLoyaltyOpen(false)}
          />
          <div className="relative bg-white dark:bg-[#141412] w-full md:max-w-md rounded-t-[32px] md:rounded-[32px] max-h-[92vh] overflow-y-auto shadow-2xl border border-[#EFECE6] dark:border-[#1F1F1C] animate-slideUp transition-colors duration-300 p-6">
            <div className="flex items-center justify-between pb-4 border-b border-[#EFECE6] dark:border-[#1F1F1C] mb-6">
              <div>
                <h2 className="text-lg font-extrabold text-neutral-900 dark:text-neutral-50 tracking-tight leading-none">Loyalty Program</h2>
                <p className="text-[10px] text-[#7A7368] dark:text-[#A19B91] uppercase font-bold tracking-wider mt-1">Check your stamps &amp; rewards</p>
              </div>
              <button
                onClick={() => setLoyaltyOpen(false)}
                className="w-9 h-9 bg-stone-50 dark:bg-[#1E1E1C] rounded-2xl flex items-center justify-center text-[#7A7368] hover:text-neutral-900 hover:bg-stone-100 dark:hover:bg-stone-900 transition-colors border border-[#EFECE6] dark:border-[#1F1F1C]"
              >
                ✕
              </button>
            </div>

            <div className="space-y-6">
              {/* Lookup Form */}
              {!loyaltyProfile && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-black text-[#7A7368] uppercase tracking-wider mb-2">
                      Enter your phone number
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="tel"
                        value={loyaltyPhone}
                        onChange={(e) => {
                          setLoyaltyPhone(e.target.value);
                          setLoyaltyError(null);
                        }}
                        placeholder="+2348012345678"
                        className="flex-1 border border-[#EFECE6] dark:border-[#1F1F1C] rounded-xl px-4 py-2.5 text-sm outline-none focus:border-orange-500 bg-stone-50 dark:bg-[#0D0C0B]"
                      />
                      <button
                        onClick={checkLoyaltyBalance}
                        disabled={loyaltyLoading || !loyaltyPhone.trim()}
                        style={{ backgroundColor: primary }}
                        className="px-5 py-2.5 text-white font-bold text-sm rounded-xl transition-all hover:opacity-95 active:scale-95 disabled:bg-stone-200 dark:disabled:bg-stone-850"
                      >
                        {loyaltyLoading ? "..." : "Check"}
                      </button>
                    </div>
                  </div>

                  {loyaltyError && (
                    <div className="bg-rose-50 dark:bg-rose-950/20 border border-rose-200/50 dark:border-rose-900/30 text-rose-600 dark:text-rose-400 text-xs font-semibold px-4 py-3 rounded-xl leading-relaxed">
                      {loyaltyError}
                    </div>
                  )}
                </div>
              )}

              {/* Stamp Card Result */}
              {loyaltyProfile && (
                <div className="space-y-4 animate-scaleUp">
                  <LoyaltyCard
                    restaurantSlug={restaurant.slug}
                    phone={loyaltyPhone}
                    restaurantName={restaurant.name}
                    preloaded={{
                      tickGoal: loyaltyProfile.settings.tickGoal,
                      reward: loyaltyProfile.settings.reward,
                      currentTicks: loyaltyProfile.profile.currentTicks,
                      rewardUnlocked: loyaltyProfile.profile.unredeemedRewards > 0,
                      unredeemedRewards: loyaltyProfile.profile.unredeemedRewards,
                    }}
                  />
                  <button
                    onClick={() => {
                      setLoyaltyProfile(null);
                      setLoyaltyPhone("");
                      setLoyaltySearched(false);
                    }}
                    className="w-full py-2.5 bg-stone-50 hover:bg-stone-150 dark:bg-[#1E1E1C] dark:hover:bg-stone-900 text-neutral-800 dark:text-neutral-200 font-bold text-xs rounded-xl transition-colors border border-[#EFECE6] dark:border-[#1F1F1C] uppercase tracking-wider"
                  >
                    Check Another Number
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
