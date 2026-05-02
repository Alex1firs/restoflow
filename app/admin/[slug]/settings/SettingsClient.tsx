"use client";

import { useState } from "react";
import ImageUpload from "@/app/components/ImageUpload";

type Props = {
  restaurant: {
    slug: string;
    name: string;
    description: string;
    logo: string;
    coverImage: string;
    phone: string;
    address: string;
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
  });
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  function set(field: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
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
        body: JSON.stringify(form),
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
        <p className="text-gray-500 font-medium mt-1">
          Manage your public page branding and contact info.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Branding */}
        <section className="bg-white border border-gray-200 rounded-2xl p-6">
          <h2 className="text-sm font-black text-gray-900 uppercase tracking-tight mb-5">Branding</h2>

          <div className="space-y-5">
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">
                Restaurant Name
              </label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                required
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 focus:outline-none focus:border-orange-500 transition"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">
                Description
              </label>
              <textarea
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
                rows={3}
                placeholder="A short description shown on your public ordering page"
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 focus:outline-none focus:border-orange-500 transition resize-none"
              />
            </div>

            <ImageUpload
              label="Restaurant Logo"
              value={form.logo}
              onChange={(url) => set("logo", url)}
              storagePath={`restaurants/${restaurant.slug}/logo`}
              aspect="square"
            />

            <ImageUpload
              label="Cover Image"
              value={form.coverImage}
              onChange={(url) => set("coverImage", url)}
              storagePath={`restaurants/${restaurant.slug}/cover`}
              aspect="wide"
            />
          </div>
        </section>

        {/* Contact */}
        <section className="bg-white border border-gray-200 rounded-2xl p-6">
          <h2 className="text-sm font-black text-gray-900 uppercase tracking-tight mb-5">Contact Info</h2>

          <div className="space-y-5">
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">
                Phone Number
              </label>
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
                placeholder="08012345678"
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 focus:outline-none focus:border-orange-500 transition"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">
                Address
              </label>
              <input
                type="text"
                value={form.address}
                onChange={(e) => set("address", e.target.value)}
                placeholder="15 Allen Avenue, Lagos"
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 focus:outline-none focus:border-orange-500 transition"
              />
            </div>
          </div>
        </section>

        {/* Save */}
        <div className="flex items-center gap-4">
          <button
            type="submit"
            disabled={saving}
            className="bg-gray-900 hover:bg-black disabled:opacity-60 text-white font-black text-sm px-8 py-3 rounded-xl transition"
          >
            {saving ? "Saving…" : "Save Changes"}
          </button>

          {status === "success" && (
            <span className="text-sm font-bold text-green-600">Saved successfully.</span>
          )}
          {status === "error" && (
            <span className="text-sm font-bold text-red-500">{errorMsg}</span>
          )}
        </div>
      </form>
    </div>
  );
}
