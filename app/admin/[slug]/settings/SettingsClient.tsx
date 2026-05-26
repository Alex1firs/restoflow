"use client";

import { useState } from "react";
import Link from "next/link";
import ImageUpload from "@/app/components/ImageUpload";
import { DAYS, DEFAULT_DAY_HOURS, defaultOpeningHours, type OpeningHours } from "@/lib/restaurant-utils";

type AlertPreference = "whatsapp" | "sms" | "both";

type Props = {
  restaurant: {
    slug: string;
    name: string;
    description: string;
    logo: string;
    coverImage: string;
    phone: string;
    address: string;
    whatsappPhone: string;
    notificationPhone: string;
    deliveryFee: number;
    minimumOrder: number;
    deliveryEnabled: boolean;
    pickupEnabled: boolean;
    openingHours: OpeningHours | null;
    whatsappEnabled: boolean;
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
  };
};

export default function SettingsClient({ restaurant }: Props) {
  const [form, setForm] = useState({
    name: restaurant.name,
    description: restaurant.description,
    logo: restaurant.logo,
    coverImage: restaurant.coverImage,
    phone: restaurant.phone,
    address: restaurant.address,
    whatsappPhone: restaurant.whatsappPhone,
    notificationPhone: restaurant.notificationPhone,
    deliveryFee: restaurant.deliveryFee,
    minimumOrder: restaurant.minimumOrder,
    deliveryEnabled: restaurant.deliveryEnabled,
    pickupEnabled: restaurant.pickupEnabled,
    whatsappEnabled: restaurant.whatsappEnabled,
    alertPreference: restaurant.alertPreference as AlertPreference,
    primaryColor: restaurant.primaryColor || "#ea580c",
    accentColor: restaurant.accentColor || "#f97316",
    promoBanner: restaurant.promoBanner || "",
    rating: restaurant.rating || "",
    ordersToday: restaurant.ordersToday || "",
    deliveryTime: restaurant.deliveryTime || "20–35 min",
    hidePrices: restaurant.hidePrices,
    dineInEnabled: restaurant.dineInEnabled,
  });

  const [openingHours, setOpeningHours] = useState<OpeningHours>(
    restaurant.openingHours ?? defaultOpeningHours()
  );

  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [testError, setTestError] = useState("");

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

  async function handleWhatsAppTest() {
    if (!form.whatsappPhone.trim()) {
      setTestStatus("error");
      setTestError("Enter a WhatsApp number first.");
      return;
    }
    setTestStatus("testing");
    setTestError("");
    try {
      const res = await fetch("/api/admin/whatsapp/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ whatsappPhone: form.whatsappPhone }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTestStatus("error");
        setTestError(data.error ?? "Test failed.");
      } else {
        setField("whatsappEnabled", true);
        if (data.normalizedPhone) setField("whatsappPhone", data.normalizedPhone);
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
        body: JSON.stringify({ ...form, openingHours }),
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
    <div className="max-w-3xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-black text-gray-900">Store Settings</h1>
        <p className="text-gray-500 font-medium mt-1">Control how your store looks and operates.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">

        {/* ── SECTION 1: BRANDING ─────────────────────────────────── */}
        <Section title="Branding" hint="This is what customers see on your ordering page">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
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

        {/* ── SECTION 1.5: CONVERSION FEATURES ────────────────────── */}
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
        <Section title="Business Information" hint="Helps customers find and trust you">
          <Field label="Address">
            <input
              type="text"
              value={form.address}
              onChange={(e) => setField("address", e.target.value)}
              placeholder="15 Allen Avenue, Lagos"
              className={inputCls}
            />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
            <Field label="WhatsApp Number">
              <input
                type="tel"
                value={form.whatsappPhone}
                onChange={(e) => { setField("whatsappPhone", e.target.value); setTestStatus("idle"); }}
                placeholder="2348012345678"
                className={inputCls}
              />
              <p className="text-xs text-gray-400 mt-1">For order alerts & customer contact</p>
            </Field>
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
              {(["whatsapp", "sms", "both"] as AlertPreference[]).map((pref) => {
                const labels: Record<AlertPreference, string> = {
                  whatsapp: "WhatsApp",
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

          {/* WhatsApp */}
          {(form.alertPreference === "whatsapp" || form.alertPreference === "both") && (
            <div className="border border-gray-100 rounded-2xl p-5 space-y-4 bg-gray-50">
              <div className="flex items-center gap-2">
                <svg viewBox="0 0 24 24" className="w-5 h-5 text-green-600 fill-current flex-shrink-0">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                </svg>
                <span className="text-sm font-black text-gray-800">WhatsApp Alerts</span>
                {form.whatsappEnabled && (
                  <span className="text-xs font-bold bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Active</span>
                )}
              </div>

              <Field label="WhatsApp Number">
                <input
                  type="tel"
                  value={form.whatsappPhone}
                  onChange={(e) => { setField("whatsappPhone", e.target.value); setTestStatus("idle"); }}
                  placeholder="2348012345678 or 08012345678"
                  className={inputCls}
                />
                <p className="text-xs text-gray-400 mt-1">
                  Nigerian local (08012345678) is auto-converted.
                </p>
              </Field>

              <div className="flex items-center gap-3 flex-wrap">
                <button
                  type="button"
                  onClick={handleWhatsAppTest}
                  disabled={testStatus === "testing" || !form.whatsappPhone.trim()}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-black text-xs uppercase tracking-widest transition-all"
                >
                  {testStatus === "testing" ? (
                    <><span className="w-3.5 h-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />Sending…</>
                  ) : "Send Test Message"}
                </button>
                {testStatus === "success" && (
                  <span className="text-sm font-bold text-green-600 flex items-center gap-1.5">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                    Test sent — alerts enabled!
                  </span>
                )}
                {testStatus === "error" && (
                  <span className="text-sm font-bold text-red-500">{testError}</span>
                )}
              </div>

              <label className="flex items-center gap-3 cursor-pointer w-fit">
                <div
                  onClick={() => setField("whatsappEnabled", !form.whatsappEnabled)}
                  className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer ${form.whatsappEnabled ? "bg-green-500" : "bg-gray-200"}`}
                >
                  <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.whatsappEnabled ? "translate-x-4" : "translate-x-0.5"}`} />
                </div>
                <span className="text-sm font-bold text-gray-700">Enable WhatsApp alerts</span>
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
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
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
