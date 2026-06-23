"use client";

import { useState } from "react";
import Link from "next/link";
import ImageUpload from "@/app/components/ImageUpload";
import VideoUpload from "@/app/components/VideoUpload";
import AiTextHelper from "@/app/components/AiTextHelper";
import { DAYS, DEFAULT_DAY_HOURS, defaultOpeningHours, type OpeningHours, type DeliveryZone } from "@/lib/restaurant-utils";
import HeroCustomizationSection from "./HeroCustomizationSection";
import { DEFAULT_HERO_SETTINGS, type HeroSettings } from "@/lib/hero-settings";

type AlertPreference = "telegram" | "sms" | "both";

type Props = {
  aiEnabled?: boolean;
  restaurant: {
    slug: string;
    name: string;
    description: string;
    logo: string;
    coverImage: string;
    coverVideo?: string;
    phone: string;
    address: string;
    telegramChatId: string;
    notificationPhone: string;
    deliveryFee: number;
    minimumOrder: number;
    deliveryEnabled: boolean;
    pickupEnabled: boolean;
    openingHours: OpeningHours | null;
    telegramEnabled: boolean;
    alertPreference: AlertPreference;
    paymentConfigured: boolean;
    paymentAccountName: string;
    paymentBankName: string;
    primaryColor: string;
    accentColor: string;
    promoBanner: string;
    rating: number | null;
    ordersToday: number | null;
    deliveryTime: string;
    hidePrices: boolean;
    dineInEnabled: boolean;
    heroSettings: HeroSettings;
    cancellationManagerPinEnabled?: boolean;
    cancellationOwnerApprovalEnabled?: boolean;
    deliveryZones?: DeliveryZone[];
    whatsappNumber?: string;
    showContactSupport?: boolean;
    payOnDeliveryEnabled?: boolean;
  };
  menuItems?: any[];
};

export default function SettingsClient({ restaurant, aiEnabled = false, menuItems = [] }: Props) {
  const [form, setForm] = useState({
    name: restaurant.name,
    description: restaurant.description,
    logo: restaurant.logo,
    coverImage: restaurant.coverImage,
    coverVideo: restaurant.coverVideo || "",
    phone: restaurant.phone,
    address: restaurant.address,
    telegramChatId: restaurant.telegramChatId,
    notificationPhone: restaurant.notificationPhone,
    deliveryFee: restaurant.deliveryFee,
    minimumOrder: restaurant.minimumOrder,
    deliveryEnabled: restaurant.deliveryEnabled,
    pickupEnabled: restaurant.pickupEnabled,
    telegramEnabled: restaurant.telegramEnabled,
    alertPreference: restaurant.alertPreference as AlertPreference,
    primaryColor: restaurant.primaryColor || "#ea580c",
    accentColor: restaurant.accentColor || "#f97316",
    promoBanner: restaurant.promoBanner || "",
    rating: restaurant.rating || "",
    ordersToday: restaurant.ordersToday || "",
    deliveryTime: restaurant.deliveryTime || "20–35 min",
    hidePrices: restaurant.hidePrices,
    dineInEnabled: restaurant.dineInEnabled,
    cancellationManagerPinEnabled: restaurant.cancellationManagerPinEnabled !== false,
    cancellationOwnerApprovalEnabled: restaurant.cancellationOwnerApprovalEnabled !== false,
    deliveryZones: restaurant.deliveryZones ?? [],
    whatsappNumber: restaurant.whatsappNumber ?? "",
    showContactSupport: restaurant.showContactSupport !== false,
    payOnDeliveryEnabled: restaurant.payOnDeliveryEnabled !== false,
  });

  const [openingHours, setOpeningHours] = useState<OpeningHours>(
    restaurant.openingHours ?? defaultOpeningHours()
  );

  const [heroSettings, setHeroSettings] = useState<HeroSettings>(
    restaurant.heroSettings ?? DEFAULT_HERO_SETTINGS
  );

  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [testError, setTestError] = useState("");
  const [fallbackUsed, setFallbackUsed] = useState(false);

  function setField<K extends keyof typeof form>(field: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [field]: value }));
    setStatus("idle");
  }

  function setDayHours(dayKey: string, patch: Partial<{ open: boolean; from: string; to: string }>) {
    setOpeningHours((prev) => ({
      ...prev,
      [dayKey]: { ...(prev[dayKey] ?? DEFAULT_DAY_HOURS), ...patch },
    }));
    setStatus("idle");
  }

  async function handleTelegramTest() {
    if (!form.telegramChatId.trim()) {
      setTestStatus("error");
      setTestError("Enter a Telegram Chat ID first.");
      return;
    }
    setTestStatus("testing");
    setTestError("");
    try {
      const res = await fetch("/api/admin/telegram/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telegramChatId: form.telegramChatId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTestStatus("error");
        setTestError(data.error ?? "Test failed.");
      } else {
        setField("telegramEnabled", true);
        setTestStatus("success");
      }
    } catch {
      setTestStatus("error");
      setTestError("Network error. Please try again.");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setStatus("idle");
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, openingHours, heroSettings }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error ?? "Failed to save.");
        setStatus("error");
      } else {
        setStatus("success");
        setTimeout(() => setStatus("idle"), 3000);
      }
    } catch {
      setErrorMsg("Network error. Please try again.");
      setStatus("error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8" style={{ colorScheme: "light" }}>
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-black text-gray-900">Store Settings</h1>
        <p className="text-gray-500 font-medium mt-1">Control how your store looks and operates.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">

        {/* ── SECTION 1: BRANDING ─────────────────────────────────── */}
        <Section title="Branding" hint="This is what customers see on your ordering page" id="branding">
          {/* Contextual help */}
          <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 flex items-start gap-3">
            <svg className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-xs text-blue-700 font-medium leading-relaxed">
              Your logo and cover photo help customers recognize your restaurant. A professional look builds trust and encourages more orders.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            <ImageUpload
              label="Logo"
              value={form.logo}
              onChange={(url) => { setField("logo", url); setStatus("idle"); }}
              storagePath={`restaurants/${restaurant.slug}/logo`}
              aspect="square"
            />
            <ImageUpload
              label="Cover Image"
              value={form.coverImage}
              onChange={(url) => { setField("coverImage", url); setStatus("idle"); }}
              storagePath={`restaurants/${restaurant.slug}/cover`}
              aspect="wide"
            />
            <VideoUpload
              label="Cover Video"
              value={form.coverVideo}
              onChange={(url) => { setField("coverVideo", url); setStatus("idle"); }}
              storagePath={`restaurants/${restaurant.slug}/cover_video`}
            />
          </div>
          <Field label="Restaurant Name">
            <input
              type="text"
              value={form.name}
              onChange={(e) => setField("name", e.target.value)}
              required
              placeholder="e.g. Grills Capitol"
              className={inputCls}
            />
          </Field>
          <Field label="Short Description">
            <textarea
              value={form.description}
              onChange={(e) => setField("description", e.target.value)}
              rows={2}
              placeholder="Fast & delicious meals in Lagos"
              className={`${inputCls} resize-none`}
            />
            <p className="text-xs text-gray-400 mt-1">Shown below your name on the ordering page</p>
            {aiEnabled && (
              <AiTextHelper
                triggerLabel={form.description ? "Improve with AI" : "Generate with AI"}
                endpoint="/api/admin/ai/restaurant-description"
                payload={() => ({
                  restaurantName: form.name,
                  existingDescription: form.description || undefined,
                  action: form.description ? "improve" : "generate",
                })}
                onAccept={(text) => setField("description", text)}
              />
            )}
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Primary Color">
              <input
                type="color"
                value={form.primaryColor}
                onChange={(e) => setField("primaryColor", e.target.value)}
                className="w-full h-12 rounded-xl cursor-pointer border border-gray-200"
              />
            </Field>
            <Field label="Accent Color">
              <input
                type="color"
                value={form.accentColor}
                onChange={(e) => setField("accentColor", e.target.value)}
                className="w-full h-12 rounded-xl cursor-pointer border border-gray-200"
              />
            </Field>
          </div>
        </Section>

        {/* ── SECTION 1.5: HERO CUSTOMIZATION ─────────────────────── */}
        <Section title="Hero Customization" hint="Full control over your storefront's hero section">
          <HeroCustomizationSection
            settings={heroSettings}
            onChange={(s) => { setHeroSettings(s); setStatus("idle"); }}
            logoUrl={form.logo}
            coverUrl={form.coverImage}
            coverVideoUrl={form.coverVideo}
            restaurantName={form.name}
            description={form.description}
            primaryColor={form.primaryColor}
            accentColor={form.accentColor}
            slug={restaurant.slug}
            saving={saving}
            menuItems={menuItems}
            onSave={async () => {
              setSaving(true);
              setStatus("idle");
              try {
                const res = await fetch("/api/admin/settings", {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ ...form, openingHours, heroSettings }),
                });
                const data = await res.json();
                if (!res.ok) {
                  setErrorMsg(data.error ?? "Failed to save.");
                  setStatus("error");
                  throw new Error(data.error ?? "Failed to save.");
                } else {
                  setStatus("success");
                  setTimeout(() => setStatus("idle"), 3000);
                }
              } catch (err) {
                setErrorMsg("Network error. Please try again.");
                setStatus("error");
                throw err;
              } finally {
                setSaving(false);
              }
            }}
          />
        </Section>

        {/* ── SECTION 1.6: CONVERSION FEATURES ────────────────────── */}
        <Section title="Conversion Features" hint="Engage customers and build trust">
          <Field label="Promo Banner">
            <input
              type="text"
              value={form.promoBanner}
              onChange={(e) => setField("promoBanner", e.target.value)}
              placeholder="e.g. Free delivery on your first order!"
              className={inputCls}
            />
            <p className="text-xs text-gray-400 mt-1">Appears at the top of the ordering page if set</p>
            {aiEnabled && (
              <AiTextHelper
                triggerLabel="Generate welcome text with AI"
                endpoint="/api/admin/ai/welcome-text"
                payload={() => ({
                  restaurantName: form.name,
                  description: form.description || undefined,
                })}
                onAccept={(text) => setField("promoBanner", text)}
              />
            )}
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field label="Display Rating">
              <input
                type="number"
                step="0.1"
                min="1"
                max="5"
                value={form.rating}
                onChange={(e) => setField("rating", e.target.value ? Number(e.target.value) : "")}
                placeholder="e.g. 4.8"
                className={inputCls}
              />
              <p className="text-xs text-gray-400 mt-1">Leave empty to hide</p>
            </Field>
            <Field label="Orders Today">
              <input
                type="number"
                min="0"
                value={form.ordersToday}
                onChange={(e) => setField("ordersToday", e.target.value ? Number(e.target.value) : "")}
                placeholder="e.g. 120"
                className={inputCls}
              />
              <p className="text-xs text-gray-400 mt-1">Leave empty to hide</p>
            </Field>
            <Field label="Est. Delivery Time">
              <input
                type="text"
                value={form.deliveryTime}
                onChange={(e) => setField("deliveryTime", e.target.value)}
                placeholder="e.g. 20–35 min"
                className={inputCls}
              />
            </Field>
          </div>
        </Section>

        {/* ── SECTION 2: BUSINESS INFORMATION ─────────────────────── */}
        <Section title="Business Information" hint="Helps customers find and trust you" id="business-info">
          {/* Contextual help */}
          <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 flex items-start gap-3">
            <svg className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-xs text-blue-700 font-medium leading-relaxed">
              Your address and phone number help customers find you and place delivery orders. Set your opening hours so customers know when they can order.
            </p>
          </div>
          <Field label="Address">
            <input
              type="text"
              value={form.address}
              onChange={(e) => setField("address", e.target.value)}
              placeholder="15 Allen Avenue, Lagos"
              className={inputCls}
            />
          </Field>
          <Field label="Phone Number">
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => setField("phone", e.target.value)}
              placeholder="08012345678"
              className={inputCls}
            />
            <p className="text-xs text-gray-400 mt-1">Shown publicly on your store page</p>
          </Field>
          <Field label="WhatsApp Support Number">
            <input
              type="tel"
              value={form.whatsappNumber}
              onChange={(e) => setField("whatsappNumber", e.target.value)}
              placeholder="08012345678"
              className={inputCls}
            />
            <p className="text-xs text-gray-400 mt-1">If provided, we will show a &quot;Chat on WhatsApp&quot; button for customer support.</p>
          </Field>
          <div className="pt-2">
            <div className="flex items-center justify-between gap-4 bg-gray-50 border border-gray-100 p-4 rounded-xl">
              <div>
                <p className="text-sm font-bold text-gray-900">Enable Customer Support Links</p>
                <p className="text-xs text-gray-500 mt-0.5">Show the &quot;Call Us&quot; and &quot;WhatsApp Support&quot; buttons on your storefront.</p>
              </div>
              <div
                onClick={() => setField("showContactSupport", !form.showContactSupport)}
                className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer shrink-0 ${form.showContactSupport ? "bg-orange-500" : "bg-gray-200"}`}
              >
                <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${form.showContactSupport ? "translate-x-5.5" : "translate-x-0.5"}`} />
              </div>
            </div>
          </div>

          {/* Opening Hours */}
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">
              Opening Hours <span className="font-normal normal-case text-gray-400">(Nigeria Time, WAT)</span>
            </label>
            <div className="space-y-2.5">
              {DAYS.map((day) => {
                const h = openingHours[day.key] ?? DEFAULT_DAY_HOURS;
                return (
                  <div key={day.key} className="flex items-center gap-3 flex-wrap sm:flex-nowrap">
                    <span className="w-24 text-sm font-bold text-gray-700 flex-shrink-0">{day.label}</span>
                    <div
                      onClick={() => setDayHours(day.key, { open: !h.open })}
                      className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer flex-shrink-0 ${h.open ? "bg-orange-500" : "bg-gray-200"}`}
                    >
                      <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${h.open ? "translate-x-4" : "translate-x-0.5"}`} />
                    </div>
                    <span className="text-xs font-bold text-gray-400 w-12 flex-shrink-0">{h.open ? "Open" : "Closed"}</span>
                    <input
                      type="time"
                      value={h.from}
                      disabled={!h.open}
                      onChange={(e) => setDayHours(day.key, { from: e.target.value })}
                      className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:border-orange-500 disabled:opacity-40 disabled:bg-gray-50"
                    />
                    <span className="text-xs text-gray-400">to</span>
                    <input
                      type="time"
                      value={h.to}
                      disabled={!h.open}
                      onChange={(e) => setDayHours(day.key, { to: e.target.value })}
                      className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:border-orange-500 disabled:opacity-40 disabled:bg-gray-50"
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </Section>

        {/* ── SECTION 3: ORDER SETTINGS ────────────────────────────── */}
        <Section title="Order Settings" hint="Control how customers can place orders">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Toggle
              label="Delivery"
              description="Customers order to their address"
              enabled={form.deliveryEnabled}
              onToggle={() => setField("deliveryEnabled", !form.deliveryEnabled)}
            />
            <Toggle
              label="Pickup"
              description="Customers collect from your location"
              enabled={form.pickupEnabled}
              onToggle={() => setField("pickupEnabled", !form.pickupEnabled)}
            />
            <Toggle
              label="Dine In"
              description="Customers order from their table via QR code"
              enabled={form.dineInEnabled}
              onToggle={() => setField("dineInEnabled", !form.dineInEnabled)}
            />
            <Toggle
              label="Pay on Delivery"
              description="Customers can pay cash upon receiving delivery"
              enabled={form.payOnDeliveryEnabled}
              onToggle={() => setField("payOnDeliveryEnabled", !form.payOnDeliveryEnabled)}
            />
          </div>

          <div className="border-t border-gray-100 my-4 pt-4">
            <Toggle
              label="Hide Prices (Catalog Mode)"
              description="Hide prices on your public menu. Customers can still place Dine-in or Pay-on-Delivery orders without seeing price totals."
              enabled={form.hidePrices}
              onToggle={() => setField("hidePrices", !form.hidePrices)}
            />
          </div>

          {form.deliveryEnabled && (
            <div className="grid grid-cols-2 gap-4 pt-2">
              <Field label="Delivery Fee (₦)">
                <input
                  type="number"
                  min="0"
                  step="50"
                  value={form.deliveryFee}
                  onChange={(e) => setField("deliveryFee", Number(e.target.value))}
                  placeholder="0"
                  className={inputCls}
                />
                <p className="text-xs text-gray-400 mt-1">Set 0 for free delivery</p>
              </Field>
              <Field label="Minimum Order (₦)">
                <input
                  type="number"
                  min="0"
                  step="100"
                  value={form.minimumOrder}
                  onChange={(e) => setField("minimumOrder", Number(e.target.value))}
                  placeholder="0"
                  className={inputCls}
                />
                <p className="text-xs text-gray-400 mt-1">Set 0 for no minimum</p>
              </Field>
            </div>
          )}

          {form.deliveryEnabled && (
            <div className="border border-gray-100 rounded-2xl p-5 space-y-4 bg-gray-50/50 mt-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-sm font-bold text-gray-900">Delivery Zones</h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Define custom delivery areas and fees. If empty, the default fee above will apply.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setField("deliveryZones", [
                      ...form.deliveryZones,
                      { id: crypto.randomUUID(), name: "", fee: form.deliveryFee },
                    ])
                  }
                  className="px-3 py-1.5 bg-gray-900 text-white text-xs font-bold rounded-lg hover:bg-black transition-colors shrink-0"
                >
                  Add Zone
                </button>
              </div>

              {form.deliveryZones.length > 0 && (
                <div className="space-y-3 pt-2">
                  {form.deliveryZones.map((zone, i) => (
                    <div key={zone.id} className="flex items-start gap-3">
                      <div className="flex-1">
                        <input
                          type="text"
                          value={zone.name}
                          onChange={(e) => {
                            const newZones = [...form.deliveryZones];
                            newZones[i].name = e.target.value;
                            setField("deliveryZones", newZones);
                          }}
                          placeholder="Zone Name (e.g. Lekki Phase 1)"
                          className={`${inputCls} py-2`}
                        />
                      </div>
                      <div className="w-32 shrink-0 relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-medium">₦</span>
                        <input
                          type="number"
                          min="0"
                          step="50"
                          value={zone.fee}
                          onChange={(e) => {
                            const newZones = [...form.deliveryZones];
                            newZones[i].fee = Number(e.target.value);
                            setField("deliveryZones", newZones);
                          }}
                          placeholder="0"
                          className={`${inputCls} py-2 pl-7`}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const newZones = form.deliveryZones.filter((_, idx) => idx !== i);
                          setField("deliveryZones", newZones);
                        }}
                        className="p-2.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors shrink-0"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </Section>
  
        {/* ── SECTION 3.5: SECURITY & VOIDING SETTINGS ────────────── */}
        <Section title="Security & Voiding Settings" hint="Control how POS orders are voided or cancelled">
          <div className="bg-orange-50 border border-orange-100 rounded-xl px-4 py-3 flex items-start gap-3">
            <svg className="w-4 h-4 text-orange-500 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <p className="text-xs text-orange-850 font-medium leading-relaxed">
              Define how cashiers cancel or void orders. Enabling at least one option prevents staff from cancelling orders without authorization.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Toggle
              label="Manager PIN Override"
              description="Require a Manager/Owner PIN to cancel orders locally on the POS"
              enabled={form.cancellationManagerPinEnabled}
              onToggle={() => setField("cancellationManagerPinEnabled", !form.cancellationManagerPinEnabled)}
            />
            <Toggle
              label="Owner Approval Request"
              description="Send a remote notification requesting the owner's dashboard approval before voiding"
              enabled={form.cancellationOwnerApprovalEnabled}
              onToggle={() => setField("cancellationOwnerApprovalEnabled", !form.cancellationOwnerApprovalEnabled)}
            />
          </div>
        </Section>

        {/* ── SECTION 4: PAYMENTS ──────────────────────────────────── */}
        <Section title="Payments" hint="Bank account for receiving online orders">
          {restaurant.paymentConfigured ? (
            <div className="flex items-start gap-4 bg-green-50 border border-green-100 rounded-2xl p-4">
              <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-green-800 text-sm">Receiving online payments</p>
                <p className="text-green-600 text-xs mt-0.5">
                  {restaurant.paymentAccountName && restaurant.paymentBankName
                    ? `${restaurant.paymentAccountName} · ${restaurant.paymentBankName}`
                    : "Bank account connected"}
                </p>
              </div>
              <Link
                href={`/admin/${restaurant.slug}/payment`}
                className="text-xs font-black text-green-700 hover:text-green-900 bg-green-100 hover:bg-green-200 px-3 py-1.5 rounded-xl transition flex-shrink-0"
              >
                Update
              </Link>
            </div>
          ) : (
            <div className="flex items-start gap-4 bg-amber-50 border border-amber-100 rounded-2xl p-4">
              <div className="w-8 h-8 bg-amber-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                <svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-amber-800 text-sm">Not configured</p>
                <p className="text-amber-600 text-xs mt-0.5">Add your bank account to accept online payments.</p>
              </div>
              <Link
                href={`/admin/${restaurant.slug}/payment`}
                className="text-xs font-black text-amber-700 hover:text-amber-900 bg-amber-100 hover:bg-amber-200 px-3 py-1.5 rounded-xl transition flex-shrink-0"
              >
                Set up
              </Link>
            </div>
          )}
        </Section>

        {/* ── SECTION 5: NOTIFICATIONS ─────────────────────────────── */}
        <Section title="Notifications" hint="Get alerted when a new order arrives">
          {/* Preference */}
          <Field label="Alert Preference">
            <div className="flex gap-2 flex-wrap">
              {(["telegram", "sms", "both"] as AlertPreference[]).map((pref) => {
                const labels: Record<AlertPreference, string> = {
                  telegram: "Telegram",
                  sms: "SMS",
                  both: "Both",
                };
                const active = form.alertPreference === pref;
                return (
                  <button
                    key={pref}
                    type="button"
                    onClick={() => { setField("alertPreference", pref); setStatus("idle"); }}
                    className={`px-4 py-2 rounded-xl text-sm font-bold border transition-all ${
                      active
                        ? "bg-gray-900 text-white border-gray-900"
                        : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
                    }`}
                  >
                    {labels[pref]}
                  </button>
                );
              })}
            </div>
          </Field>

          {/* Telegram */}
          {(form.alertPreference === "telegram" || form.alertPreference === "both") && (
            <div className="border border-gray-100 rounded-2xl p-5 space-y-4 bg-gray-50/50">
              <div className="flex items-center gap-2">
                <svg viewBox="0 0 24 24" className="w-5 h-5 text-sky-500 fill-current flex-shrink-0">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15.82-.67 3.85-.94 5.34-.11.63-.35.84-.57.86-.49.04-.86-.33-1.33-.64-.74-.48-1.16-.78-1.88-1.25-.83-.54-.29-.84.18-1.33.12-.13 2.25-2.06 2.29-2.23.01-.02.01-.1-.04-.15-.05-.05-.12-.03-.17-.02-.07.02-1.22.78-3.44 2.28-.32.22-.62.33-.89.32-.3-.01-.88-.17-1.31-.31-.53-.17-.95-.26-.91-.55.02-.15.22-.3.6-.47 2.34-1.02 3.9-1.69 4.68-2.01.78-.32 1.62-.46 1.82-.46.04 0 .15 0 .22.06.06.05.08.12.09.18.01.07.01.21-.01.31z" />
                </svg>
                <span className="text-sm font-black text-gray-800">Telegram Alerts</span>
                {form.telegramEnabled && (
                  <span className="text-xs font-bold bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Active</span>
                )}
              </div>

              <div className="bg-orange-50 border border-orange-100 rounded-xl p-3.5 text-xs text-orange-850 space-y-1.5 leading-relaxed">
                <div className="font-bold flex items-center gap-1.5 text-orange-950">
                  <span>💡</span> How to link Telegram Alerts:
                </div>
                <ol className="list-decimal pl-4 space-y-1 text-orange-900">
                  <li>Open Telegram and search for <a href="https://t.me/RestoFlowAlertBot" target="_blank" rel="noopener noreferrer" className="font-bold underline hover:text-orange-950">@RestoFlowAlertBot</a>.</li>
                  <li>Click <strong>Start</strong> or send the message <code>/start</code>.</li>
                  <li>The bot will immediately reply with your numeric <strong>Chat ID</strong>.</li>
                  <li>Copy that number and paste it in the field below, then click &quot;Verify &amp; Link Bot&quot;.</li>
                </ol>
              </div>

              <Field label="Telegram Chat ID">
                <input
                  type="text"
                  value={form.telegramChatId}
                  onChange={(e) => { setField("telegramChatId", e.target.value); setTestStatus("idle"); }}
                  placeholder="e.g. 573829104"
                  className={inputCls}
                />
                <p className="text-xs text-gray-400 mt-1">
                  Your unique Telegram identifier (usually 9 to 10 digits).
                </p>
              </Field>

              <div className="flex items-center gap-3 flex-wrap">
                <button
                  type="button"
                  onClick={handleTelegramTest}
                  disabled={testStatus === "testing" || !form.telegramChatId.trim()}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gray-900 hover:bg-black disabled:opacity-50 text-white font-black text-xs uppercase tracking-widest transition-all"
                >
                  {testStatus === "testing" ? (
                    <><span className="w-3.5 h-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />Connecting…</>
                  ) : "Verify & Link Bot"}
                </button>
                {testStatus === "success" && (
                  <span className="text-sm font-bold text-green-600 flex items-center gap-1.5">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                    Bot linked successfully! Alerts enabled.
                  </span>
                )}
                {testStatus === "error" && (
                  <span className="text-sm font-bold text-red-500">{testError}</span>
                )}
              </div>

              <label className="flex items-center gap-3 cursor-pointer w-fit pt-2">
                <div
                  onClick={() => setField("telegramEnabled", !form.telegramEnabled)}
                  className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer ${form.telegramEnabled ? "bg-green-500" : "bg-gray-200"}`}
                >
                  <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.telegramEnabled ? "translate-x-4" : "translate-x-0.5"}`} />
                </div>
                <span className="text-sm font-bold text-gray-700">Enable Telegram Alerts</span>
              </label>
            </div>
          )}

          {/* SMS */}
          {(form.alertPreference === "sms" || form.alertPreference === "both") && (
            <Field label="SMS Alert Number">
              <input
                type="tel"
                value={form.notificationPhone}
                onChange={(e) => setField("notificationPhone", e.target.value)}
                placeholder="08012345678"
                className={inputCls}
              />
              <p className="text-xs text-gray-400 mt-1">
                You&apos;ll receive an SMS when a new order arrives.
              </p>
            </Field>
          )}
        </Section>

        {/* ── SAVE BUTTON ──────────────────────────────────────────── */}
        <div className="flex items-center gap-4 pb-8">
          <button
            type="submit"
            disabled={saving}
            className="bg-gray-900 hover:bg-black disabled:opacity-60 text-white font-black text-sm px-8 py-3.5 rounded-xl transition active:scale-95"
          >
            {saving ? "Saving…" : "Save Changes"}
          </button>
          {status === "success" && (
            <span className="text-sm font-bold text-green-600 flex items-center gap-1.5">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
              Changes saved!
            </span>
          )}
          {status === "error" && (
            <span className="text-sm font-bold text-red-500">{errorMsg}</span>
          )}
        </div>
      </form>
    </div>
  );
}

const inputCls =
  "w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 focus:outline-none focus:border-orange-500 transition bg-white";

function Section({
  title,
  hint,
  id,
  children,
}: {
  title: string;
  hint?: string;
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm scroll-mt-6">
      <div className="mb-5">
        <h2 className="text-sm font-black text-gray-900 uppercase tracking-tight">{title}</h2>
        {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
      </div>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}

function Toggle({
  label,
  description,
  enabled,
  onToggle,
}: {
  label: string;
  description: string;
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex items-start gap-3 p-4 rounded-2xl border-2 text-left transition-all w-full ${
        enabled
          ? "border-orange-400 bg-orange-50"
          : "border-gray-100 bg-gray-50 hover:border-gray-200"
      }`}
    >
      <div
        className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 mt-0.5 ${
          enabled ? "bg-orange-500" : "bg-gray-300"
        }`}
      >
        <div
          className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
            enabled ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </div>
      <div>
        <p className={`text-sm font-black ${enabled ? "text-orange-700" : "text-gray-500"}`}>
          {label}
        </p>
        <p className="text-xs text-gray-400 mt-0.5">{description}</p>
      </div>
    </button>
  );
}
