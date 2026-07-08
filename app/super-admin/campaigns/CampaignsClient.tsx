"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Campaign, CampaignEntryPoint, CampaignStatus } from "@/lib/campaigns/types";

const STATUS_STYLES: Record<CampaignStatus, string> = {
  draft: "bg-gray-100 text-gray-600",
  active: "bg-emerald-100 text-emerald-700",
  ended: "bg-stone-200 text-stone-600",
};

function toDateInput(ms: number | null): string {
  if (ms == null) return "";
  const d = new Date(ms);
  // yyyy-mm-dd for <input type="date">
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fromDateInput(v: string): number | null {
  if (!v) return null;
  const ms = new Date(`${v}T00:00:00`).getTime();
  return Number.isFinite(ms) ? ms : null;
}

const BLANK = {
  id: undefined as string | undefined,
  name: "",
  description: "",
  status: "draft" as CampaignStatus,
  threshold: 5,
  prize: "",
  startAt: "",
  endAt: "",
  entryPoints: ["landing", "discover"] as CampaignEntryPoint[],
};

export default function CampaignsClient({ initialCampaigns }: { initialCampaigns: Campaign[] }) {
  const router = useRouter();
  const [form, setForm] = useState({ ...BLANK });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  function editCampaign(c: Campaign) {
    setForm({
      id: c.id, name: c.name, description: c.description, status: c.status,
      threshold: c.rule.threshold, prize: c.prize,
      startAt: toDateInput(c.startAtMs), endAt: toDateInput(c.endAtMs),
      entryPoints: c.entryPoints.length ? c.entryPoints : ["landing", "discover"],
    });
    setShowForm(true);
    setError(null);
  }
  function newCampaign() { setForm({ ...BLANK }); setShowForm(true); setError(null); }

  function toggleEntry(ep: CampaignEntryPoint) {
    setForm((f) => ({
      ...f,
      entryPoints: f.entryPoints.includes(ep) ? f.entryPoints.filter((x) => x !== ep) : [...f.entryPoints, ep],
    }));
  }

  async function save() {
    if (!form.name.trim()) { setError("Campaign name is required."); return; }
    setSaving(true); setError(null);
    try {
      const res = await fetch("/api/super-admin/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: form.id, name: form.name, description: form.description, status: form.status,
          threshold: Number(form.threshold), prize: form.prize,
          startAtMs: fromDateInput(form.startAt), endAtMs: fromDateInput(form.endAt),
          entryPoints: form.entryPoints,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Could not save campaign."); return; }
      setShowForm(false);
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-gray-900">Campaigns</h1>
          <p className="text-sm text-gray-500 mt-0.5">Promotions that reward customers for repeat orders via discovery.</p>
        </div>
        <button onClick={newCampaign} className="bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold px-4 py-2.5 rounded-xl transition-colors">
          + New campaign
        </button>
      </div>

      {/* Tagging-not-live notice (Slice 2) */}
      <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 mb-6 text-xs text-blue-700 font-medium">
        Participant counts populate once order tagging is enabled (a later slice). Campaigns you create now are ready to attribute orders when that ships.
      </div>

      {showForm && (
        <div className="bg-white border border-gray-200 rounded-2xl p-5 mb-6 shadow-sm">
          <h2 className="font-black text-gray-900 mb-4">{form.id ? "Edit campaign" : "New campaign"}</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <label className="text-sm font-medium text-gray-700 sm:col-span-2">
              Name
              <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Order 5 times, win an electric cooker" className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </label>
            <label className="text-sm font-medium text-gray-700 sm:col-span-2">
              Description
              <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={2} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </label>
            <label className="text-sm font-medium text-gray-700">
              Qualifying orders (threshold)
              <input type="number" min={1} value={form.threshold} onChange={(e) => setForm((f) => ({ ...f, threshold: Number(e.target.value) }))} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </label>
            <label className="text-sm font-medium text-gray-700">
              Prize
              <input value={form.prize} onChange={(e) => setForm((f) => ({ ...f, prize: e.target.value }))} placeholder="Electric cooker" className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </label>
            <label className="text-sm font-medium text-gray-700">
              Starts
              <input type="date" value={form.startAt} onChange={(e) => setForm((f) => ({ ...f, startAt: e.target.value }))} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </label>
            <label className="text-sm font-medium text-gray-700">
              Ends
              <input type="date" value={form.endAt} onChange={(e) => setForm((f) => ({ ...f, endAt: e.target.value }))} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </label>
            <label className="text-sm font-medium text-gray-700">
              Status
              <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as CampaignStatus }))} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="ended">Ended</option>
              </select>
            </label>
            <div className="text-sm font-medium text-gray-700">
              Entry points
              <div className="mt-2 flex gap-4">
                {(["landing", "discover"] as CampaignEntryPoint[]).map((ep) => (
                  <label key={ep} className="inline-flex items-center gap-1.5 font-normal">
                    <input type="checkbox" checked={form.entryPoints.includes(ep)} onChange={() => toggleEntry(ep)} /> {ep}
                  </label>
                ))}
              </div>
            </div>
          </div>
          {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
          <div className="flex gap-2 mt-5">
            <button onClick={save} disabled={saving} className="bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white text-sm font-bold px-4 py-2 rounded-lg">
              {saving ? "Saving…" : "Save campaign"}
            </button>
            <button onClick={() => setShowForm(false)} className="text-gray-600 text-sm font-bold px-4 py-2 rounded-lg hover:bg-gray-100">Cancel</button>
          </div>
        </div>
      )}

      {initialCampaigns.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm">No campaigns yet. Create your first promotion above.</div>
      ) : (
        <div className="space-y-3">
          {initialCampaigns.map((c) => (
            <div key={c.id} className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full ${STATUS_STYLES[c.status]}`}>{c.status}</span>
                  <h3 className="font-bold text-gray-900 truncate">{c.name}</h3>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Order {c.rule.threshold}× → {c.prize || "prize"} · {c.entryPoints.join(", ") || "no entry points"}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Link href={`/super-admin/campaigns/${c.id}`} className="text-sm font-bold text-orange-600 hover:underline">Participants</Link>
                <button onClick={() => editCampaign(c)} className="text-sm font-bold text-gray-600 hover:bg-gray-100 px-3 py-1.5 rounded-lg">Edit</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
