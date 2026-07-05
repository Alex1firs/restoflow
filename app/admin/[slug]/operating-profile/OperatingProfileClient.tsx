"use client";

import { useEffect, useState } from "react";
import { Sliders, Store, User, Bot, Brain, RotateCcw, Loader2, Check } from "lucide-react";

/**
 * Restaurant Operating Profile editor.
 *
 * A restaurant-scoped operating profile that influences AI reasoning (Assistant,
 * Recommendations, Purchasing, Voice) without changing any engine. Owner-editable,
 * versioned, audited. Learned patterns are transparent and resettable.
 */

type Learned = { id: string; statement: string; type: string; active: boolean; source: string };
type Profile = {
  business: { pricingPhilosophy: string | null; maxPriceIncreaseNaira: number | null; preferPromotionsOverPriceIncrease: boolean; preferredSuppliers: string[]; openingHours: string | null; staffingPhilosophy: string | null; preparationStyle: string | null };
  owner: { language: string; primaryInterface: string; responseStyle: string; notificationChannel: string };
  ai: { confidenceThreshold: number; automationLevel: string; escalationRules: string | null; reminderFrequency: string };
  learned: Learned[];
  version: number;
};

export default function OperatingProfileClient() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingSection, setSavingSection] = useState<string | null>(null);
  const [savedSection, setSavedSection] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/admin/ai/profile`);
        if (res.ok) setProfile(((await res.json()) as { profile: Profile }).profile);
      } catch {
        /* leave empty */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function save(section: "business" | "owner" | "ai", patch: Record<string, unknown>) {
    setSavingSection(section);
    setError("");
    try {
      const res = await fetch(`/api/admin/ai/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [section]: patch }),
      });
      if (!res.ok) {
        setError("Couldn't save. Please try again.");
        return;
      }
      setProfile(((await res.json()) as { profile: Profile }).profile);
      setSavedSection(section);
      setTimeout(() => setSavedSection((s) => (s === section ? null : s)), 1500);
    } catch {
      setError("Network error.");
    } finally {
      setSavingSection(null);
    }
  }

  async function resetLearned() {
    setSavingSection("learned");
    try {
      const res = await fetch(`/api/admin/ai/profile`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "reset_learned" }) });
      if (res.ok) setProfile(((await res.json()) as { profile: Profile }).profile);
    } finally {
      setSavingSection(null);
    }
  }

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-10">
        <div className="h-4 bg-gray-100 rounded w-1/3 animate-pulse" />
      </div>
    );
  }
  if (!profile) return <div className="max-w-2xl mx-auto px-4 py-10 text-sm text-gray-500">Couldn&apos;t load the operating profile.</div>;

  const p = profile;
  const SavedBadge = ({ section }: { section: string }) =>
    savedSection === section ? <span className="inline-flex items-center gap-1 text-[11px] font-black text-green-600"><Check className="w-3 h-3" /> Saved</span> : null;

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 sm:py-10 space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-2xl bg-orange-100 flex items-center justify-center">
          <Sliders className="w-5 h-5 text-orange-600" />
        </div>
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-gray-900 leading-tight">Operating Profile</h1>
          <p className="text-xs sm:text-sm text-gray-500 font-medium">Preferences that shape every AI decision. Version {p.version}.</p>
        </div>
      </div>

      {/* Business Preferences */}
      <Section icon={<Store className="w-4 h-4 text-blue-600" />} title="Business Preferences" busy={savingSection === "business"} saved={<SavedBadge section="business" />}>
        <Field label="Max recommended price increase (₦)">
          <input
            type="number"
            defaultValue={p.business.maxPriceIncreaseNaira ?? ""}
            onBlur={(e) => save("business", { maxPriceIncreaseNaira: e.target.value === "" ? null : Number(e.target.value) })}
            placeholder="No cap"
            className="input"
          />
        </Field>
        <Toggle label="Prefer promotions over price increases" checked={p.business.preferPromotionsOverPriceIncrease} onChange={(v) => save("business", { preferPromotionsOverPriceIncrease: v })} />
        <Field label="Preferred supplier">
          <input type="text" defaultValue={p.business.preferredSuppliers[0] ?? ""} onBlur={(e) => save("business", { preferredSuppliers: e.target.value ? [e.target.value] : [] })} placeholder="e.g. FreshMart" className="input" />
        </Field>
        <Field label="Opening hours">
          <input type="text" defaultValue={p.business.openingHours ?? ""} onBlur={(e) => save("business", { openingHours: e.target.value || null })} placeholder="e.g. 9am–10pm" className="input" />
        </Field>
      </Section>

      {/* Owner Preferences */}
      <Section icon={<User className="w-4 h-4 text-purple-600" />} title="Owner Preferences" busy={savingSection === "owner"} saved={<SavedBadge section="owner" />}>
        <Field label="Response style">
          <select defaultValue={p.owner.responseStyle} onChange={(e) => save("owner", { responseStyle: e.target.value })} className="input">
            <option value="detailed">Detailed</option>
            <option value="concise">Concise</option>
          </select>
        </Field>
        <Field label="Primary interface">
          <select defaultValue={p.owner.primaryInterface} onChange={(e) => save("owner", { primaryInterface: e.target.value })} className="input">
            <option value="voice">Voice</option>
            <option value="dashboard">Dashboard</option>
          </select>
        </Field>
        <Field label="Notification channel">
          <select defaultValue={p.owner.notificationChannel} onChange={(e) => save("owner", { notificationChannel: e.target.value })} className="input">
            <option value="in_app">In-app</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="push">Push</option>
          </select>
        </Field>
      </Section>

      {/* AI Preferences */}
      <Section icon={<Bot className="w-4 h-4 text-indigo-600" />} title="AI Preferences" busy={savingSection === "ai"} saved={<SavedBadge section="ai" />}>
        <Field label={`Confidence threshold (${Math.round(p.ai.confidenceThreshold * 100)}%)`}>
          <input type="range" min={0} max={0.95} step={0.05} defaultValue={p.ai.confidenceThreshold} onMouseUp={(e) => save("ai", { confidenceThreshold: Number((e.target as HTMLInputElement).value) })} onTouchEnd={(e) => save("ai", { confidenceThreshold: Number((e.target as HTMLInputElement).value) })} className="w-full" />
        </Field>
        <Field label="Automation level">
          <select defaultValue={p.ai.automationLevel} onChange={(e) => save("ai", { automationLevel: e.target.value })} className="input">
            <option value="manual">Manual</option>
            <option value="assisted">Assisted</option>
            <option value="auto">Auto</option>
          </select>
        </Field>
        <Field label="Reminder frequency">
          <select defaultValue={p.ai.reminderFrequency} onChange={(e) => save("ai", { reminderFrequency: e.target.value })} className="input">
            <option value="off">Off</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </select>
        </Field>
      </Section>

      {/* Learned Preferences */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        <div className="flex items-center justify-between mb-3">
          <span className="inline-flex items-center gap-2 text-sm font-black text-gray-900">
            <span className="w-7 h-7 rounded-xl bg-amber-50 flex items-center justify-center"><Brain className="w-4 h-4 text-amber-600" /></span>
            Learned Preferences
          </span>
          {p.learned.length > 0 && (
            <button type="button" onClick={resetLearned} disabled={savingSection === "learned"} className="inline-flex items-center gap-1 text-[11px] font-black text-gray-500 hover:text-red-600 disabled:opacity-40">
              <RotateCcw className="w-3.5 h-3.5" /> Reset
            </button>
          )}
        </div>
        {p.learned.length === 0 ? (
          <p className="text-sm text-gray-500">Nothing learned yet. As you accept and dismiss recommendations, patterns appear here — always transparent and resettable.</p>
        ) : (
          <ul className="space-y-2">
            {p.learned.map((l) => (
              <li key={l.id} className="flex items-center gap-2 text-sm">
                <span className={`w-1.5 h-1.5 rounded-full ${l.active ? "bg-amber-500" : "bg-gray-300"}`} />
                <span className={l.active ? "text-gray-800" : "text-gray-400"}>{l.statement}</span>
                {!l.active && <span className="text-[10px] text-gray-400">(learning…)</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && <p className="text-xs text-red-500 font-bold">{error}</p>}

      <style jsx>{`
        :global(.input) {
          width: 100%;
          border: 1px solid #e5e7eb;
          border-radius: 0.75rem;
          padding: 0.5rem 0.75rem;
          font-size: 0.875rem;
          color: #111827;
          background: white;
        }
        :global(.input:focus) {
          outline: none;
          border-color: #fb923c;
        }
      `}</style>
    </div>
  );
}

function Section({ icon, title, busy, saved, children }: { icon: React.ReactNode; title: string; busy: boolean; saved: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="inline-flex items-center gap-2 text-sm font-black text-gray-900">
          <span className="w-7 h-7 rounded-xl bg-gray-50 flex items-center justify-center">{icon}</span>
          {title}
        </span>
        {busy ? <Loader2 className="w-4 h-4 text-gray-300 animate-spin" /> : saved}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-bold text-gray-600">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs font-bold text-gray-600">{label}</span>
      <button type="button" onClick={() => onChange(!checked)} className={`relative w-10 h-5 rounded-full transition-colors ${checked ? "bg-orange-500" : "bg-gray-200"}`} aria-pressed={checked}>
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${checked ? "translate-x-5" : "translate-x-0.5"}`} />
      </button>
    </div>
  );
}
