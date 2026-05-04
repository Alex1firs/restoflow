"use client";

import { useState, useEffect } from "react";

type SEOFields = {
  seoTitle: string;
  seoDescription: string;
  serviceAreas: string;
  foodKeywords: string;
  googleBusinessUrl: string;
  instagramUrl: string;
  tiktokUrl: string;
};

const EMPTY: SEOFields = {
  seoTitle: "", seoDescription: "", serviceAreas: "",
  foodKeywords: "", googleBusinessUrl: "", instagramUrl: "", tiktokUrl: "",
};

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={copy} className="text-xs font-bold px-3 py-1.5 rounded-lg border border-gray-200 text-gray-500 hover:text-orange-600 hover:border-orange-200 hover:bg-orange-50 transition-colors">
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

function GuideStep({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4">
      <div className="w-7 h-7 rounded-full bg-orange-600 text-white text-xs font-black flex items-center justify-center flex-shrink-0 mt-0.5">{n}</div>
      <div>
        <p className="font-black text-gray-800 text-sm">{title}</p>
        <div className="text-sm text-gray-500 mt-1">{children}</div>
      </div>
    </div>
  );
}

export default function SEOClient({
  slug,
  restaurantName,
  appUrl,
  customDomain,
}: {
  slug: string;
  restaurantName: string;
  appUrl: string;
  customDomain: string;
}) {
  const [fields, setFields] = useState<SEOFields>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const publicUrl = customDomain ? `https://${customDomain}` : `${appUrl}/r/${slug}`;
  const sitemapUrl = `${appUrl}/sitemap.xml`;

  useEffect(() => {
    fetch("/api/admin/seo")
      .then((r) => r.ok ? r.json() : EMPTY)
      .then((d) => setFields({ ...EMPTY, ...d }))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/seo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      if (!res.ok) { const d = await res.json(); setError(d.error ?? "Failed to save"); return; }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  };

  const set = (k: keyof SEOFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setFields((f) => ({ ...f, [k]: e.target.value }));

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12 space-y-4">
        {[1, 2, 3].map((i) => <div key={i} className="h-32 bg-white rounded-2xl border border-gray-100 animate-pulse" />)}
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">

      <div>
        <h1 className="text-2xl font-black text-gray-900">SEO & Google</h1>
        <p className="text-sm text-gray-500 mt-1">Help customers find your restaurant on Google.</p>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm font-medium px-4 py-3 rounded-xl">{error}</div>}

      {/* SEO Fields */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-5">
        <h2 className="font-black text-gray-900">Search Appearance</h2>

        <div>
          <label className="block text-xs font-black text-gray-500 uppercase tracking-wide mb-1.5">
            Page Title <span className="text-gray-300 font-normal normal-case">(shown in Google results)</span>
          </label>
          <input
            value={fields.seoTitle}
            onChange={set("seoTitle")}
            placeholder={`${restaurantName} — Food Delivery in Lagos`}
            maxLength={70}
            className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-orange-500"
          />
          <p className="text-xs text-gray-400 mt-1">{fields.seoTitle.length}/70 characters</p>
        </div>

        <div>
          <label className="block text-xs font-black text-gray-500 uppercase tracking-wide mb-1.5">
            Description <span className="text-gray-300 font-normal normal-case">(shown under title in Google)</span>
          </label>
          <textarea
            value={fields.seoDescription}
            onChange={set("seoDescription")}
            placeholder={`Order delicious meals from ${restaurantName}. Fast delivery, online payment, and fresh food.`}
            maxLength={160}
            rows={3}
            className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-orange-500 resize-none"
          />
          <p className="text-xs text-gray-400 mt-1">{fields.seoDescription.length}/160 characters</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-black text-gray-500 uppercase tracking-wide mb-1.5">Service Areas</label>
            <input
              value={fields.serviceAreas}
              onChange={set("serviceAreas")}
              placeholder="Lekki, Ajah, Victoria Island"
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-orange-500"
            />
            <p className="text-xs text-gray-400 mt-1">Comma-separated areas you deliver to</p>
          </div>
          <div>
            <label className="block text-xs font-black text-gray-500 uppercase tracking-wide mb-1.5">Food Categories</label>
            <input
              value={fields.foodKeywords}
              onChange={set("foodKeywords")}
              placeholder="Nigerian food, Grills, Burgers"
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-orange-500"
            />
            <p className="text-xs text-gray-400 mt-1">Types of food you serve</p>
          </div>
        </div>
      </div>

      {/* Social & Business Links */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
        <h2 className="font-black text-gray-900">Business & Social Links</h2>

        {[
          { key: "googleBusinessUrl" as const, label: "Google Business Profile", placeholder: "https://g.page/your-restaurant" },
          { key: "instagramUrl" as const, label: "Instagram", placeholder: "https://instagram.com/yourrestaurant" },
          { key: "tiktokUrl" as const, label: "TikTok", placeholder: "https://tiktok.com/@yourrestaurant" },
        ].map(({ key, label, placeholder }) => (
          <div key={key}>
            <label className="block text-xs font-black text-gray-500 uppercase tracking-wide mb-1.5">{label}</label>
            <input
              type="url"
              value={fields[key]}
              onChange={set(key)}
              placeholder={placeholder}
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-orange-500"
            />
          </div>
        ))}
      </div>

      <button
        onClick={save}
        disabled={saving}
        className="w-full py-3 bg-gray-900 hover:bg-gray-700 disabled:bg-gray-300 text-white font-black text-sm rounded-xl transition-colors"
      >
        {saving ? "Saving..." : saved ? "Saved!" : "Save SEO Settings"}
      </button>

      {/* Google Setup Guide */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6">
        <h2 className="font-black text-gray-900 mb-1">Get on Google — Step by Step</h2>
        <p className="text-sm text-gray-500 mb-6">Follow these steps to rank for local food searches.</p>

        <div className="space-y-6">
          <GuideStep n={1} title="Copy your restaurant website link">
            <div className="mt-2 flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2.5 border border-gray-100">
              <span className="font-mono text-xs text-gray-700 flex-1 truncate">{publicUrl}</span>
              <CopyButton value={publicUrl} />
            </div>
            <p className="mt-1.5">Share this link anywhere — WhatsApp, Instagram bio, flyers.</p>
          </GuideStep>

          <GuideStep n={2} title="Add your website to Google Business Profile">
            <p>Open your Google Business Profile and paste your website link in the <strong>Website</strong> field. This tells Google your restaurant has an online presence.</p>
            {fields.googleBusinessUrl ? (
              <a href={fields.googleBusinessUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-xs font-bold text-orange-600 hover:underline">
                Open your Google Business Profile →
              </a>
            ) : (
              <p className="mt-1.5 text-xs text-gray-400">Add your Google Business Profile link above to see the shortcut here.</p>
            )}
          </GuideStep>

          <GuideStep n={3} title="Submit your sitemap to Google Search Console">
            <p>Google Search Console tells Google which pages to index. Submit your sitemap so Google can find all your restaurant pages.</p>
            <div className="mt-2 flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2.5 border border-gray-100">
              <span className="font-mono text-xs text-gray-700 flex-1">{sitemapUrl}</span>
              <CopyButton value={sitemapUrl} />
            </div>
            <ol className="mt-2 space-y-1 text-xs text-gray-500 list-decimal list-inside">
              <li>Go to <a href="https://search.google.com/search-console" target="_blank" rel="noopener noreferrer" className="text-orange-600 font-bold hover:underline">search.google.com/search-console</a></li>
              <li>Add your website URL</li>
              <li>Click Sitemaps → paste the URL above → Submit</li>
            </ol>
          </GuideStep>

          <GuideStep n={4} title="Share your link on Instagram and WhatsApp">
            <p>Post your ordering link on your Instagram bio and send it to your WhatsApp contacts. Every click helps Google understand your site is real and active.</p>
            <div className="mt-2 flex gap-2">
              <a
                href={`https://wa.me/?text=${encodeURIComponent(`Order from ${restaurantName} here: ${publicUrl}`)}`}
                target="_blank" rel="noopener noreferrer"
                className="text-xs font-bold px-3 py-2 bg-green-50 border border-green-200 text-green-700 rounded-lg hover:bg-green-100 transition-colors"
              >
                Share on WhatsApp
              </a>
              <CopyButton value={`Order from ${restaurantName}: ${publicUrl}`} />
            </div>
          </GuideStep>
        </div>
      </div>

      {/* What Google sees */}
      <div className="bg-gray-50 rounded-2xl border border-gray-100 p-6">
        <h2 className="font-black text-gray-700 text-sm mb-3">Preview — What Google shows</h2>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-blue-700 text-base font-medium leading-tight">
            {fields.seoTitle || `${restaurantName} — Order Food Online`}
          </p>
          <p className="text-green-700 text-xs mt-0.5">{publicUrl}</p>
          <p className="text-gray-600 text-sm mt-1 leading-relaxed">
            {fields.seoDescription || `Order from ${restaurantName} online. Fast delivery and fresh food.`}
          </p>
        </div>
      </div>
    </div>
  );
}
