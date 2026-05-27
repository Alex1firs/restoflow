"use client";

import { useState } from "react";
import type { Plan } from "@/lib/plans";

export default function PlansClient({ plans }: { plans: Plan[] }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<Plan>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newPlan, setNewPlan] = useState({ id: "", name: "", monthlyPrice: 0, setupFee: 0, features: "" });

  async function savePlan(planId: string, data: Partial<Plan>) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/super-admin/plans/${planId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error ?? "Failed to save");
      } else {
        setSuccess(`Plan "${planId}" updated.`);
        setEditing(null);
        setTimeout(() => setSuccess(null), 3000);
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function createPlan() {
    if (!newPlan.id || !newPlan.name) { setError("ID and name are required"); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/super-admin/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...newPlan,
          features: newPlan.features.split("\n").map((f) => f.trim()).filter(Boolean),
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error ?? "Failed to create");
      } else {
        setSuccess("Plan created — refresh to see changes.");
        setShowCreate(false);
        setNewPlan({ id: "", name: "", monthlyPrice: 0, setupFee: 0, features: "" });
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-black text-gray-900">Plans</h1>
        <button onClick={() => setShowCreate(!showCreate)} className="text-sm font-bold px-4 py-2 bg-orange-600 text-white rounded-xl hover:bg-orange-500 transition-colors">
          + Create Plan
        </button>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-600 text-sm px-4 py-3 rounded-xl">{error}</div>}
      {success && <div className="bg-green-50 border border-green-200 text-green-700 text-sm px-4 py-3 rounded-xl">{success}</div>}

      {showCreate && (
        <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
          <h2 className="font-black text-gray-800">New Plan</h2>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-xs font-bold text-gray-500 mb-1">Plan ID (slug)</label><input value={newPlan.id} onChange={(e) => setNewPlan({ ...newPlan, id: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-orange-500" placeholder="e.g. enterprise" /></div>
            <div><label className="block text-xs font-bold text-gray-500 mb-1">Display Name</label><input value={newPlan.name} onChange={(e) => setNewPlan({ ...newPlan, name: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-orange-500" placeholder="e.g. Enterprise" /></div>
            <div><label className="block text-xs font-bold text-gray-500 mb-1">Monthly Price (₦)</label><input type="number" value={newPlan.monthlyPrice} onChange={(e) => setNewPlan({ ...newPlan, monthlyPrice: Number(e.target.value) })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-orange-500" /></div>
            <div><label className="block text-xs font-bold text-gray-500 mb-1">Setup Fee (₦)</label><input type="number" value={newPlan.setupFee} onChange={(e) => setNewPlan({ ...newPlan, setupFee: Number(e.target.value) })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-orange-500" /></div>
          </div>
          <div><label className="block text-xs font-bold text-gray-500 mb-1">Features (one per line)</label><textarea value={newPlan.features} onChange={(e) => setNewPlan({ ...newPlan, features: e.target.value })} rows={4} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-orange-500 resize-none" /></div>
          <div className="flex gap-2">
            <button disabled={loading} onClick={createPlan} className="px-4 py-2 bg-orange-600 text-white font-bold text-sm rounded-xl hover:bg-orange-500 disabled:opacity-50">Create</button>
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 bg-gray-100 text-gray-700 font-bold text-sm rounded-xl hover:bg-gray-200">Cancel</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {plans.map((plan) => (
          <div key={plan.id} className={`bg-white rounded-2xl border p-6 ${plan.popular ? "border-orange-300 shadow-md" : "border-gray-100"}`}>
            {plan.popular && <span className="text-xs font-black uppercase bg-orange-600 text-white px-2 py-0.5 rounded-full mb-3 inline-block">Popular</span>}
            {editing === plan.id ? (
              <div className="space-y-3">
                <div><label className="text-xs font-bold text-gray-500">Name</label><input defaultValue={plan.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm mt-1 outline-none" /></div>
                <div><label className="text-xs font-bold text-gray-500">Monthly Price (₦)</label><input type="number" defaultValue={plan.monthlyPrice} onChange={(e) => setForm({ ...form, monthlyPrice: Number(e.target.value) })} className="w-full border rounded-lg px-3 py-2 text-sm mt-1 outline-none" /></div>
                <div><label className="text-xs font-bold text-gray-500">Setup Fee (₦)</label><input type="number" defaultValue={plan.setupFee} onChange={(e) => setForm({ ...form, setupFee: Number(e.target.value) })} className="w-full border rounded-lg px-3 py-2 text-sm mt-1 outline-none" /></div>
                <div className="flex gap-2 mt-2">
                  <button disabled={loading} onClick={() => savePlan(plan.id, form)} className="flex-1 py-2 bg-orange-600 text-white font-bold text-sm rounded-xl hover:bg-orange-500 disabled:opacity-50">Save</button>
                  <button onClick={() => { setEditing(null); setForm({}); }} className="flex-1 py-2 bg-gray-100 font-bold text-sm rounded-xl">Cancel</button>
                </div>
              </div>
            ) : (
              <>
                <h3 className="text-lg font-black text-gray-900 mb-1">{plan.name}</h3>
                <p className="text-2xl font-black text-orange-600 mb-1">₦{plan.monthlyPrice.toLocaleString("en-NG")}<span className="text-sm font-normal text-gray-400">/mo</span></p>
                <p className="text-xs text-gray-400 mb-4">Setup fee: ₦{plan.setupFee.toLocaleString("en-NG")}</p>
                <ul className="space-y-1.5 mb-5">
                  {plan.features.map((f) => (
                    <li key={f} className="text-xs text-gray-600 flex items-center gap-1.5">
                      <span className="text-green-500 font-bold">✓</span> {f}
                    </li>
                  ))}
                </ul>
                <button onClick={() => { setEditing(plan.id); setForm({}); }} className="w-full py-2 border border-gray-200 font-bold text-sm rounded-xl hover:border-orange-300 hover:text-orange-600 transition-colors">
                  Edit Plan
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
