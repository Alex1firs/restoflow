"use client";

import { useState } from "react";
import ImageUpload from "@/app/components/ImageUpload";
import { DAYS, DEFAULT_DAY_HOURS, defaultOpeningHours, type OpeningHours } from "@/lib/restaurant-utils";

type Props = {
  restaurant: {
    slug: string;
    name: string;
    description: string;
    logo: string;
    coverImage: string;
    phone: string;
    address: string;
    notificationPhone: string;
    deliveryFee: number;
    minimumOrder: number;
    openingHours: OpeningHours | null;
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
    notificationPhone: restaurant.notificationPhone,
    deliveryFee: restaurant.deliveryFee,
    minimumOrder: restaurant.minimumOrder,
  });

  const [openingHours, setOpeningHours] = useState<OpeningHours>(
    restaurant.openingHours ?? defaultOpeningHours()
  );

  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  function setField<K extends keyof typeof form>(field: K, value: typeof form[K]) {
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
      <div className="mb-8">
        <h1 className="text-3xl font-black text-gray-900">Restaurant Settings</h1>
        <p className="text-gray-500 font-medium mt-1">Branding, operations, and hours.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">

        {/* Branding */}
        <Section title="Branding">
          <Field label="Restaurant Name">
            <input
              type="text"
              value={form.name}
              onChange={(e) => setField("name", e.target.value)}
              required
              className={inputCls}
            />
          </Field>
          <Field label="Description">
            <textarea
              value={form.description}
              onChange={(e) => setField("description", e.target.value)}
              rows={3}
              placeholder="A short description shown on your public ordering page"
              className={`${inputCls} resize-none`}
            />
          </Field>
          <ImageUpload
            label="Restaurant Logo"
            value={form.logo}
            onChange={(url) => setField("logo", url)}
            storagePath={`restaurants/${restaurant.slug}/logo`}
            aspect="square"
          />
          <ImageUpload
            label="Cover Image"
            value={form.coverImage}
            onChange={(url) => setField("coverImage", url)}
            storagePath={`restaurants/${restaurant.slug}/cover`}
            aspect="wide"
          />
        </Section>

        {/* Contact */}
        <Section title="Contact Info">
          <Field label="Public Phone Number">
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => setField("phone", e.target.value)}
              placeholder="08012345678"
              className={inputCls}
            />
          </Field>
          <Field label="Address">
            <input
              type="text"
              value={form.address}
              onChange={(e) => setField("address", e.target.value)}
              placeholder="15 Allen Avenue, Lagos"
              className={inputCls}
            />
          </Field>
        </Section>

        {/* Operations */}
        <Section title="Operations">
          <div className="grid grid-cols-2 gap-4">
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
              <p className="text-xs text-gray-400 mt-1">Set to 0 for free delivery</p>
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
              <p className="text-xs text-gray-400 mt-1">Set to 0 for no minimum</p>
            </Field>
          </div>
        </Section>

        {/* Opening Hours */}
        <Section title="Opening Hours">
          <p className="text-xs text-gray-400 mb-4">All times are in Nigeria time (WAT, UTC+1).</p>
          <div className="space-y-3">
            {DAYS.map((day) => {
              const h = openingHours[day.key] ?? DEFAULT_DAY_HOURS;
              return (
                <div key={day.key} className="flex items-center gap-3 flex-wrap sm:flex-nowrap">
                  <span className="w-24 text-sm font-bold text-gray-700 flex-shrink-0">{day.label}</span>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <div
                      onClick={() => setDayHours(day.key, { open: !h.open })}
                      className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer ${h.open ? "bg-orange-500" : "bg-gray-200"}`}
                    >
                      <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${h.open ? "translate-x-4" : "translate-x-0.5"}`} />
                    </div>
                    <span className="text-xs font-bold text-gray-500">{h.open ? "Open" : "Closed"}</span>
                  </label>
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
        </Section>

        {/* Notifications */}
        <Section title="Notifications">
          <Field label="SMS Alert Number">
            <input
              type="tel"
              value={form.notificationPhone}
              onChange={(e) => setField("notificationPhone", e.target.value)}
              placeholder="08012345678"
              className={inputCls}
            />
            <p className="text-xs text-gray-400 mt-1">
              Receive an SMS when a new order arrives. Requires TERMII_API_KEY in your environment.
            </p>
          </Field>
        </Section>

        {/* Save */}
        <div className="flex items-center gap-4 pb-4">
          <button
            type="submit"
            disabled={saving}
            className="bg-gray-900 hover:bg-black disabled:opacity-60 text-white font-black text-sm px-8 py-3 rounded-xl transition"
          >
            {saving ? "Saving…" : "Save Changes"}
          </button>
          {status === "success" && <span className="text-sm font-bold text-green-600">Saved successfully.</span>}
          {status === "error" && <span className="text-sm font-bold text-red-500">{errorMsg}</span>}
        </div>
      </form>
    </div>
  );
}

const inputCls = "w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 focus:outline-none focus:border-orange-500 transition";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-gray-200 rounded-2xl p-6">
      <h2 className="text-sm font-black text-gray-900 uppercase tracking-tight mb-5">{title}</h2>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">{label}</label>
      {children}
    </div>
  );
}
