"use client";

import { useEffect, useRef, useState } from "react";
import { db } from "@/lib/firebase";
import { collection, query, where, onSnapshot, Timestamp } from "firebase/firestore";
import type { SetupChecklist } from "@/lib/setup-checklist";

type OrderStatus = "pending" | "preparing" | "ready" | "completed" | "rejected";

interface Order {
  id: string;
  customerName: string;
  phone: string;
  address: string;
  items: { name: string; price: number; quantity: number }[];
  itemsTotal: number;
  deliveryFee?: number;
  total: number;
  status: OrderStatus;
  paymentMethod: "online" | "cash";
  paymentStatus?: string;
  paymentReference?: string;
  createdAt: Timestamp | null;
  restaurantId: string;
}

interface Props {
  slug: string;
  status?: string;
  rejectionReason?: string;
  setupChecklist?: SetupChecklist;
}

function getLagosStartOfDay(): Date {
  const lagosNow = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Africa/Lagos" })
  );
  lagosNow.setHours(0, 0, 0, 0);
  return lagosNow;
}

function formatCurrency(n: number) {
  return "₦" + n.toLocaleString("en-NG");
}

function formatTime(ts: Timestamp | null): string {
  if (!ts) return "—";
  return ts.toDate().toLocaleTimeString("en-NG", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Lagos",
  });
}

const STATUS_CONFIG: Record<OrderStatus, { label: string; dot: string; badge: string }> = {
  pending:   { label: "Pending",    dot: "bg-orange-500", badge: "bg-orange-100 text-orange-700" },
  preparing: { label: "Preparing",  dot: "bg-blue-500",   badge: "bg-blue-100 text-blue-700" },
  ready:     { label: "Ready",      dot: "bg-green-500",  badge: "bg-green-100 text-green-700" },
  completed: { label: "Completed",  dot: "bg-gray-400",   badge: "bg-gray-100 text-gray-600" },
  rejected:  { label: "Rejected",   dot: "bg-red-500",    badge: "bg-red-100 text-red-700" },
};

const ACTIVE_STATUSES: OrderStatus[] = ["pending", "preparing", "ready"];

const ITEM_ACTION: Record<string, { actionUrl: (slug: string) => string; actionLabel: string; friendlyText: string }> = {
  name: {
    actionUrl: (s) => `/admin/${s}/settings#branding`,
    actionLabel: "Set Name",
    friendlyText: "Your restaurant name is the first thing customers see. Make it clear and memorable.",
  },
  description: {
    actionUrl: (s) => `/admin/${s}/settings#branding`,
    actionLabel: "Add Description",
    friendlyText: "A short description helps customers understand what kind of food you offer and builds trust.",
  },
  phone: {
    actionUrl: (s) => `/admin/${s}/settings#business-info`,
    actionLabel: "Add Phone Number",
    friendlyText: "Your phone number lets customers reach you and shows you're a real, accessible business.",
  },
  address: {
    actionUrl: (s) => `/admin/${s}/settings#business-info`,
    actionLabel: "Add Address",
    friendlyText: "Your address is needed for delivery and helps customers find or verify your location.",
  },
  openingHours: {
    actionUrl: (s) => `/admin/${s}/settings#business-info`,
    actionLabel: "Set Opening Hours",
    friendlyText: "Customers need to know when they can place orders. Set at least one open day.",
  },
  menuItems: {
    actionUrl: (s) => `/admin/${s}/menu`,
    actionLabel: "Add Menu Items",
    friendlyText: "Start with your best-selling meals. Use clear names, fair prices, and good food photos.",
  },
  logo: {
    actionUrl: (s) => `/admin/${s}/settings#branding`,
    actionLabel: "Upload Logo",
    friendlyText: "A logo makes your store look professional and helps customers recognize your brand.",
  },
  coverImage: {
    actionUrl: (s) => `/admin/${s}/settings#branding`,
    actionLabel: "Upload Cover Photo",
    friendlyText: "Your cover photo is your restaurant's first impression. Use an appetizing food or restaurant shot.",
  },
  payment: {
    actionUrl: (s) => `/admin/${s}/payment`,
    actionLabel: "Set Up Payments",
    friendlyText: "Add your bank details so online payments from customers are settled directly to your account.",
  },
};

export default function DashboardClient({ slug, status = "draft", rejectionReason, setupChecklist }: Props) {
  const [allOrders, setAllOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [isRequestingHelp, setIsRequestingHelp] = useState(false);
  const [helpRequestSent, setHelpRequestSent] = useState(false);
  const [helpAlreadyOpen, setHelpAlreadyOpen] = useState(false);
  const [helpRequestError, setHelpRequestError] = useState<string | null>(null);
  const startOfDayRef = useRef(getLagosStartOfDay());

  useEffect(() => {
    startOfDayRef.current = getLagosStartOfDay();

    const q = query(
      collection(db, "orders"),
      where("restaurantId", "==", slug)
    );

    const unsub = onSnapshot(q, (snap) => {
      const orders = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Order));
      setAllOrders(orders);
      setLoading(false);
    });

    return unsub;
  }, [slug]);

  const todayOrders = allOrders.filter((o) => {
    if (!o.createdAt) return false;
    return o.createdAt.toDate() >= startOfDayRef.current;
  });

  const activeOrders = allOrders.filter((o) => ACTIVE_STATUSES.includes(o.status));

  const todayRevenue = todayOrders
    .filter((o) => o.status !== "rejected")
    .reduce((sum, o) => sum + o.total, 0);

  const todayOnline = todayOrders.filter(
    (o) => o.paymentMethod === "online" && o.status !== "rejected"
  ).length;

  const todayCash = todayOrders.filter(
    (o) => o.paymentMethod === "cash" && o.status !== "rejected"
  ).length;

  const todayOnlineRevenue = todayOrders
    .filter((o) => o.paymentMethod === "online" && o.status !== "rejected")
    .reduce((sum, o) => sum + o.total, 0);

  const todayCashRevenue = todayOrders
    .filter((o) => o.paymentMethod === "cash" && o.status !== "rejected")
    .reduce((sum, o) => sum + o.total, 0);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-6 h-6 rounded-full border-2 border-orange-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  const submitForReview = async () => {
    if (setupChecklist && !setupChecklist.canSubmit) return;
    setIsSubmittingReview(true);
    setSubmitError(null);
    try {
      const res = await fetch(`/api/admin/restaurants/${slug}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "pending_review" }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "Failed to submit");
      }
      setSubmitSuccess(true);
      setTimeout(() => window.location.reload(), 3500);
    } catch (e: unknown) {
      setSubmitError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setIsSubmittingReview(false);
    }
  };

  const requestSetupHelp = async () => {
    setIsRequestingHelp(true);
    setHelpRequestError(null);
    try {
      const res = await fetch("/api/admin/restaurants/assistance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setupScore: setupChecklist?.score ?? null }),
      });
      if (res.status === 409) {
        setHelpAlreadyOpen(true);
        return;
      }
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error ?? "Failed to send request");
      }
      setHelpRequestSent(true);
      setTimeout(() => setHelpRequestSent(false), 8000);
    } catch (e: unknown) {
      setHelpRequestError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setIsRequestingHelp(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-20 md:pb-0">

      {/* Submit success toast */}
      {submitSuccess && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-full max-w-sm px-4 pointer-events-none">
          <div className="bg-white border border-green-200 shadow-2xl rounded-2xl px-5 py-4 flex items-start gap-3 pointer-events-auto">
            <div className="shrink-0 w-9 h-9 bg-green-100 rounded-full flex items-center justify-center">
              <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-black text-gray-900">Submitted for review</p>
              <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
                Your restaurant has been sent to the RestoFlow team. We&apos;ll notify you once it is approved.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Help request success toast */}
      {helpRequestSent && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-full max-w-sm px-4 pointer-events-none">
          <div className="bg-white border border-blue-200 shadow-2xl rounded-2xl px-5 py-4 flex items-start gap-3 pointer-events-auto">
            <div className="shrink-0 w-9 h-9 bg-blue-100 rounded-full flex items-center justify-center">
              <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-black text-gray-900">Help request sent</p>
              <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
                Setup assistance requested. Our team will reach out to help you complete your store.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto px-4 py-8 space-y-8">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-black text-gray-900 tracking-tight">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {new Date().toLocaleDateString("en-NG", {
              weekday: "long", year: "numeric", month: "long", day: "numeric",
              timeZone: "Africa/Lagos",
            })}
          </p>
        </div>

        {/* ── Mobile quick actions (hidden md+) ──────────────────────────── */}
        <div className="grid grid-cols-3 gap-3 md:hidden">
          {[
            { label: "Orders",     href: `/admin/${slug}/orders`,  emoji: "📋", bg: "bg-orange-50",  text: "text-orange-700", border: "border-orange-100" },
            { label: "POS",        href: `/admin/${slug}/pos`,     emoji: "🛒", bg: "bg-blue-50",    text: "text-blue-700",   border: "border-blue-100" },
            { label: "Kitchen",    href: `/admin/${slug}/kitchen`, emoji: "👨‍🍳", bg: "bg-green-50",   text: "text-green-700",  border: "border-green-100" },
            { label: "Open Bills", href: `/admin/${slug}/pos`,     emoji: "📑", bg: "bg-teal-50",    text: "text-teal-700",   border: "border-teal-100" },
            { label: "Menu",       href: `/admin/${slug}/menu`,    emoji: "🍽️", bg: "bg-purple-50",  text: "text-purple-700", border: "border-purple-100" },
            { label: "Reports",    href: `/admin/${slug}/reports`, emoji: "📊", bg: "bg-gray-50",    text: "text-gray-700",   border: "border-gray-200" },
          ].map(({ label, href, emoji, bg, text, border }) => (
            <a
              key={label}
              href={href}
              className={`flex flex-col items-center justify-center gap-2 py-4 rounded-2xl border ${bg} ${border} ${text} font-bold text-xs transition-all active:scale-95`}
            >
              <span className="text-2xl">{emoji}</span>
              {label}
            </a>
          ))}
        </div>

        {/* ── Pending / Suspended: simple info banner ── */}
        {(status === "pending_review" || status === "suspended") && (
          <div className={`rounded-2xl border p-5 ${
            status === "suspended" ? "bg-red-50 border-red-200" : "bg-blue-50 border-blue-200"
          }`}>
            <h3 className={`font-black text-lg ${status === "suspended" ? "text-red-800" : "text-blue-800"}`}>
              {status === "pending_review" ? "Pending Review" : "Account Suspended"}
            </h3>
            <p className={`text-sm mt-1 font-medium ${status === "suspended" ? "text-red-600" : "text-blue-600"}`}>
              {status === "pending_review"
                ? "Your restaurant has been submitted and is waiting for administrator approval."
                : "Your restaurant has been suspended. Please contact support."}
            </p>
          </div>
        )}

        {/* ── Store Launch Assistant — shown when draft or rejected ── */}
        {setupChecklist && (status === "draft" || status === "rejected") && (
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">

            {/* Header */}
            <div className="px-6 pt-6 pb-5 border-b border-gray-100">
              {status === "rejected" && (
                <div className="mb-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-start gap-3">
                  <svg className="w-4 h-4 text-red-500 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div>
                    <p className="text-xs font-black text-red-700">Your last submission was rejected</p>
                    <p className="text-xs text-red-600 mt-0.5">{rejectionReason || "Please review your setup and resubmit."}</p>
                  </div>
                </div>
              )}

              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <h3 className="text-xl font-black text-gray-900">Launch Your Store</h3>
                  <p className="text-sm text-gray-500 font-medium mt-1">
                    Complete the steps below to open your store to customers.
                  </p>

                  {/* Progress percentage */}
                  <div className="mt-4">
                    <p className={`text-sm font-black mb-2 ${
                      setupChecklist.score >= 80 ? "text-green-700" :
                      setupChecklist.score >= 50 ? "text-orange-600" : "text-gray-800"
                    }`}>
                      Your store is {setupChecklist.score}% ready.
                    </p>
                    <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden max-w-xs">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          setupChecklist.score >= 80 ? "bg-green-500" :
                          setupChecklist.score >= 50 ? "bg-orange-400" : "bg-red-400"
                        }`}
                        style={{ width: `${setupChecklist.score}%` }}
                      />
                    </div>
                    {!setupChecklist.canSubmit && (
                      <p className="text-xs text-gray-500 mt-1.5">
                        Complete all required steps to submit for review.
                      </p>
                    )}
                  </div>
                </div>

                <div className="shrink-0 flex flex-wrap gap-2 items-start">
                  <a
                    href={`/admin/${slug}/setup`}
                    className="bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded-xl text-sm font-bold transition-colors inline-flex items-center gap-1.5"
                  >
                    Continue Setup
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                    </svg>
                  </a>
                  <a
                    href={`/r/${slug}`}
                    target="_blank"
                    className="bg-white border border-gray-200 text-gray-700 px-4 py-2 rounded-xl text-sm font-bold hover:bg-gray-50 transition-colors"
                  >
                    Preview Store
                  </a>
                  <button
                    onClick={submitForReview}
                    disabled={isSubmittingReview || !setupChecklist.canSubmit}
                    className="bg-gray-900 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-gray-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {isSubmittingReview ? "Submitting…" : status === "rejected" ? "Resubmit for Review" : "Submit for Review"}
                  </button>
                </div>
              </div>

              {submitError && (
                <div className="mt-3 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
                  <p className="text-xs font-black text-red-700">Could not submit: {submitError}</p>
                </div>
              )}
            </div>

            <div className="p-5 space-y-5">

              {/* Next recommended step */}
              {(() => {
                const nextStep =
                  setupChecklist.items.find((i) => !i.passed && i.required) ??
                  setupChecklist.items.find((i) => !i.passed);
                if (!nextStep) return null;
                const config = ITEM_ACTION[nextStep.key];
                if (!config) return null;
                return (
                  <div className="bg-orange-50 border border-orange-200 rounded-2xl p-5">
                    <p className="text-[11px] font-black text-orange-500 uppercase tracking-widest mb-2">Next Recommended Step</p>
                    <p className="text-sm font-black text-gray-900 mb-1">{nextStep.label}</p>
                    <p className="text-xs text-gray-600 leading-relaxed mb-3">{config.friendlyText}</p>
                    <a
                      href={config.actionUrl(slug)}
                      className="inline-flex items-center gap-2 bg-orange-600 hover:bg-orange-700 text-white text-xs font-black px-4 py-2.5 rounded-xl transition-colors"
                    >
                      {config.actionLabel}
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                      </svg>
                    </a>
                  </div>
                );
              })()}

              {/* All setup steps */}
              <div>
                <p className="text-[11px] font-black text-gray-400 uppercase tracking-widest mb-3">All Setup Steps</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {setupChecklist.items.map((item) => {
                    const config = ITEM_ACTION[item.key];
                    return (
                      <div
                        key={item.key}
                        className={`flex items-start gap-3 p-4 rounded-2xl border ${
                          item.passed
                            ? "bg-gray-50 border-gray-100"
                            : item.required
                            ? "bg-white border-orange-100"
                            : "bg-white border-gray-100"
                        }`}
                      >
                        <div className={`mt-0.5 shrink-0 w-5 h-5 rounded-full flex items-center justify-center ${
                          item.passed ? "bg-green-100" : item.required ? "bg-orange-50 border border-orange-200" : "bg-gray-100"
                        }`}>
                          {item.passed ? (
                            <svg className="w-3 h-3 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                            </svg>
                          ) : (
                            <svg className={`w-2.5 h-2.5 ${item.required ? "text-orange-400" : "text-gray-300"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                            </svg>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className={`text-xs font-bold ${item.passed ? "text-gray-400 line-through" : "text-gray-900"}`}>
                              {item.label}
                            </p>
                            {item.required && !item.passed && (
                              <span className="text-[10px] font-black text-orange-600 bg-orange-50 border border-orange-100 px-1.5 py-0.5 rounded uppercase tracking-wide">Required</span>
                            )}
                          </div>
                          {!item.passed && config && (
                            <>
                              <p className="text-[11px] text-gray-500 mt-0.5 leading-snug">{config.friendlyText}</p>
                              <a
                                href={config.actionUrl(slug)}
                                className="mt-2 inline-flex items-center gap-1 text-xs font-black text-orange-600 hover:text-orange-700 transition-colors"
                              >
                                {config.actionLabel}
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                                </svg>
                              </a>
                            </>
                          )}
                        </div>
                        <span className={`ml-auto shrink-0 text-[10px] font-black ${item.passed ? "text-green-500" : "text-gray-200"}`}>
                          +{item.points}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Request Setup Help */}
              <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-black text-gray-900">Need help setting up?</p>
                  <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
                    {helpAlreadyOpen
                      ? "Setup assistance has already been requested. Our team will reach out soon."
                      : "Our team can walk you through completing your store. Click below to request a setup call."}
                  </p>
                </div>
                {!helpAlreadyOpen && (
                  <button
                    type="button"
                    onClick={requestSetupHelp}
                    disabled={isRequestingHelp || helpRequestSent}
                    className="shrink-0 bg-white border border-gray-300 hover:border-gray-400 text-gray-700 text-xs font-black px-5 py-2.5 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isRequestingHelp ? "Sending…" : helpRequestSent ? "Request Sent ✓" : "Request Setup Help"}
                  </button>
                )}
                {helpAlreadyOpen && (
                  <span className="shrink-0 text-xs font-black text-blue-600 bg-blue-50 border border-blue-100 px-4 py-2.5 rounded-xl">
                    Request open ✓
                  </span>
                )}
                {helpRequestError && (
                  <p className="text-xs font-bold text-red-500 sm:text-right">{helpRequestError}</p>
                )}
              </div>

            </div>
          </div>
        )}

        {/* Stats grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Today's Orders"
            value={String(todayOrders.filter((o) => o.status !== "rejected").length)}
            sub={`${todayOrders.filter((o) => o.status === "rejected").length} rejected`}
            accent="orange"
          />
          <StatCard
            label="Today's Revenue"
            value={formatCurrency(todayRevenue)}
            sub="excl. rejected"
            accent="green"
          />
          <StatCard
            label="Online Paid"
            value={String(todayOnline)}
            sub={formatCurrency(todayOnlineRevenue)}
            accent="blue"
          />
          <StatCard
            label="Cash Orders"
            value={String(todayCash)}
            sub={formatCurrency(todayCashRevenue)}
            accent="gray"
          />
        </div>

        {/* Active orders */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-black text-gray-900 tracking-tight">
              Active Orders
              {activeOrders.length > 0 && (
                <span className="ml-2 text-sm font-bold text-orange-600 bg-orange-100 px-2 py-0.5 rounded-full">
                  {activeOrders.length}
                </span>
              )}
            </h2>
            <a
              href={`/admin/${slug}/orders`}
              className="text-xs font-bold text-orange-600 hover:underline"
            >
              Manage orders →
            </a>
          </div>

          {activeOrders.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center">
              <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                    d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </div>
              <p className="text-gray-500 font-medium text-sm">No active orders right now</p>
              <p className="text-gray-400 text-xs mt-1">New orders will appear here instantly</p>
            </div>
          ) : (
            <div className="space-y-3">
              {activeOrders
                .sort((a, b) => {
                  const statusOrder = { pending: 0, preparing: 1, ready: 2 };
                  return (statusOrder[a.status as keyof typeof statusOrder] ?? 9) -
                    (statusOrder[b.status as keyof typeof statusOrder] ?? 9);
                })
                .map((order) => {
                  const cfg = STATUS_CONFIG[order.status];
                  return (
                    <div
                      key={order.id}
                      className="bg-white rounded-2xl border border-gray-100 p-5 flex flex-col sm:flex-row sm:items-center gap-4"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full ${cfg.badge}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                            {cfg.label}
                          </span>
                          <span className="text-xs text-gray-400 font-medium">
                            {formatTime(order.createdAt)}
                          </span>
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                            order.paymentMethod === "online"
                              ? "bg-blue-50 text-blue-600"
                              : "bg-gray-100 text-gray-500"
                          }`}>
                            {order.paymentMethod === "online" ? "Online" : "Cash"}
                          </span>
                        </div>
                        <p className="font-bold text-gray-900 text-sm">{order.customerName}</p>
                        <p className="text-xs text-gray-500 truncate">{order.address}</p>
                        <p className="text-xs text-gray-400 mt-1">
                          {order.items.map((i) => `${i.name} ×${i.quantity}`).join(", ")}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-lg font-black text-gray-900">{formatCurrency(order.total)}</p>
                        <p className="text-xs text-gray-400">{order.items.length} item{order.items.length !== 1 ? "s" : ""}</p>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>

        {/* Today's order history */}
        {todayOrders.length > 0 && (
          <div>
            <h2 className="text-lg font-black text-gray-900 tracking-tight mb-4">Today&apos;s History</h2>
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left text-xs font-bold text-gray-400 uppercase tracking-wide px-5 py-3">Customer</th>
                    <th className="text-left text-xs font-bold text-gray-400 uppercase tracking-wide px-3 py-3 hidden sm:table-cell">Time</th>
                    <th className="text-left text-xs font-bold text-gray-400 uppercase tracking-wide px-3 py-3 hidden md:table-cell">Payment</th>
                    <th className="text-left text-xs font-bold text-gray-400 uppercase tracking-wide px-3 py-3">Status</th>
                    <th className="text-right text-xs font-bold text-gray-400 uppercase tracking-wide px-5 py-3">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {todayOrders
                    .sort((a, b) => {
                      const at = a.createdAt?.toDate().getTime() ?? 0;
                      const bt = b.createdAt?.toDate().getTime() ?? 0;
                      return bt - at;
                    })
                    .map((order) => {
                      const cfg = STATUS_CONFIG[order.status];
                      return (
                        <tr key={order.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-5 py-3 font-medium text-gray-900">{order.customerName}</td>
                          <td className="px-3 py-3 text-gray-500 hidden sm:table-cell">{formatTime(order.createdAt)}</td>
                          <td className="px-3 py-3 hidden md:table-cell">
                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                              order.paymentMethod === "online"
                                ? "bg-blue-50 text-blue-600"
                                : "bg-gray-100 text-gray-500"
                            }`}>
                              {order.paymentMethod === "online" ? "Online" : "Cash"}
                            </span>
                          </td>
                          <td className="px-3 py-3">
                            <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full ${cfg.badge}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                              {cfg.label}
                            </span>
                          </td>
                          <td className="px-5 py-3 text-right font-bold text-gray-900">{formatCurrency(order.total)}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent: "orange" | "green" | "blue" | "gray";
}) {
  const accentMap = {
    orange: "bg-orange-50 text-orange-600",
    green:  "bg-green-50 text-green-600",
    blue:   "bg-blue-50 text-blue-600",
    gray:   "bg-gray-100 text-gray-500",
  };
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5">
      <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">{label}</p>
      <p className={`text-2xl font-black tracking-tight ${accentMap[accent].split(" ")[1]}`}>
        {value}
      </p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}
