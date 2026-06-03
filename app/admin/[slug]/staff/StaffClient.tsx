"use client";

import { useState, useEffect, useCallback } from "react";

type StaffMember = {
  uid: string;
  email: string;
  displayName: string;
  role: string;
  disabled: boolean;
  pinSet?: boolean;
  createdAt: string | null;
};

const ROLE_COLORS: Record<string, string> = {
  owner: "bg-orange-100 text-orange-700",
  manager: "bg-blue-100 text-blue-700",
  staff: "bg-gray-100 text-gray-600",
};

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  manager: "Manager",
  staff: "Staff",
};

export default function StaffClient({ slug }: { slug: string }) {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newStaff, setNewStaff] = useState({ email: "", displayName: "", role: "staff" });
  const [inviteResult, setInviteResult] = useState<{ email: string } | null>(null);

  const [activeTab, setActiveTab] = useState<"staff" | "waiters">("staff");
  const [waiters, setWaiters] = useState<{ id: string; name: string; createdAt: string | null }[]>([]);
  const [waitersLoading, setWaitersLoading] = useState(false);
  const [newWaiterName, setNewWaiterName] = useState("");
  const [showCreateWaiter, setShowCreateWaiter] = useState(false);

  // PIN settings state
  const [selectedStaffForPin, setSelectedStaffForPin] = useState<StaffMember | null>(null);
  const [pinInputValue, setPinInputValue] = useState("");
  const [pinInputError, setPinInputError] = useState<string | null>(null);
  const [pinSubmitting, setPinSubmitting] = useState(false);

  async function handleSetPin() {
    if (!selectedStaffForPin) return;
    if (!/^\d{4}$/.test(pinInputValue)) {
      setPinInputError("PIN must be exactly 4 digits");
      return;
    }
    setPinSubmitting(true);
    setPinInputError(null);
    try {
      const res = await fetch(`/api/admin/staff/${selectedStaffForPin.uid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: pinInputValue }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPinInputError(data.error ?? "Failed to update PIN");
        return;
      }
      setSelectedStaffForPin(null);
      setPinInputValue("");
      fetchStaff();
    } catch {
      setPinInputError("Network error. Please try again.");
    } finally {
      setPinSubmitting(false);
    }
  }

  const fetchStaff = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/staff");
      if (res.ok) setStaff((await res.json()).staff);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchWaiters = useCallback(async () => {
    setWaitersLoading(true);
    try {
      const res = await fetch("/api/admin/waiters");
      if (res.ok) setWaiters((await res.json()).waiters);
    } finally {
      setWaitersLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "staff") {
      fetchStaff();
    } else {
      fetchWaiters();
    }
  }, [activeTab, fetchStaff, fetchWaiters]);

  async function createStaff() {
    if (!newStaff.email.trim()) { setError("Email is required"); return; }
    setActionLoading("create");
    setError(null);
    try {
      const res = await fetch("/api/admin/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newStaff),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Failed to create"); return; }
      setInviteResult({ email: newStaff.email });
      setNewStaff({ email: "", displayName: "", role: "staff" });
      setShowCreate(false);
      fetchStaff();
    } finally {
      setActionLoading(null);
    }
  }

  async function updateStaff(uid: string, update: { disabled?: boolean; role?: string }) {
    const key = `${uid}-${Object.keys(update)[0]}`;
    setActionLoading(key);
    setError(null);
    try {
      const res = await fetch(`/api/admin/staff/${uid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });
      if (!res.ok) { const d = await res.json(); setError(d.error ?? "Failed"); return; }
      fetchStaff();
    } finally {
      setActionLoading(null);
    }
  }

  async function deleteStaff(uid: string) {
    if (!confirm("Delete this staff account? This cannot be undone.")) return;
    setActionLoading(`${uid}-delete`);
    setError(null);
    try {
      const res = await fetch(`/api/admin/staff/${uid}`, { method: "DELETE" });
      if (!res.ok) { const d = await res.json(); setError(d.error ?? "Failed"); return; }
      fetchStaff();
    } finally {
      setActionLoading(null);
    }
  }

  async function createWaiter() {
    if (!newWaiterName.trim()) { setError("Waiter name is required"); return; }
    setActionLoading("create-waiter");
    setError(null);
    try {
      const res = await fetch("/api/admin/waiters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newWaiterName }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Failed to create waiter"); return; }
      setNewWaiterName("");
      setShowCreateWaiter(false);
      fetchWaiters();
    } finally {
      setActionLoading(null);
    }
  }

  async function deleteWaiter(id: string) {
    if (!confirm("Delete this waiter? This cannot be undone.")) return;
    setActionLoading(`${id}-delete-waiter`);
    setError(null);
    try {
      const res = await fetch(`/api/admin/waiters?id=${id}`, { method: "DELETE" });
      if (!res.ok) { const d = await res.json(); setError(d.error ?? "Failed"); return; }
      fetchWaiters();
    } finally {
      setActionLoading(null);
    }
  }

  function fmtDate(iso: string | null) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-gray-900">
            {activeTab === "staff" ? "Staff Management" : "Waiter Management"}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {activeTab === "staff"
              ? "Manage who can access your restaurant admin."
              : "Manage waiters for attributing orders at the POS."}
          </p>
        </div>
        {activeTab === "staff" ? (
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="bg-orange-600 text-white font-bold px-4 py-2.5 rounded-xl hover:bg-orange-500 transition-colors text-sm"
          >
            + Add Staff
          </button>
        ) : (
          <button
            onClick={() => setShowCreateWaiter(!showCreateWaiter)}
            className="bg-orange-600 text-white font-bold px-4 py-2.5 rounded-xl hover:bg-orange-500 transition-colors text-sm"
          >
            + Add Waiter
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-100 gap-6">
        <button
          onClick={() => { setActiveTab("staff"); setError(null); }}
          className={`pb-3 text-sm font-bold border-b-2 transition-all ${
            activeTab === "staff"
              ? "border-orange-600 text-orange-600 font-extrabold"
              : "border-transparent text-gray-400 hover:text-gray-600"
          }`}
        >
          Staff Members
        </button>
        <button
          onClick={() => { setActiveTab("waiters"); setError(null); }}
          className={`pb-3 text-sm font-bold border-b-2 transition-all ${
            activeTab === "waiters"
              ? "border-orange-600 text-orange-600 font-extrabold"
              : "border-transparent text-gray-400 hover:text-gray-600"
          }`}
        >
          Waiters
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 text-sm px-4 py-3 rounded-xl">{error}</div>
      )}

      {inviteResult && (
        <div className="bg-green-50 border border-green-200 rounded-2xl p-5">
          <p className="font-bold text-green-800 mb-1">Staff account created for {inviteResult.email}</p>
          <p className="text-sm text-green-700">A password setup email has been sent to {inviteResult.email}. They can use it to set their password and log in.</p>
          <button onClick={() => setInviteResult(null)} className="text-xs text-green-600 mt-3 hover:underline">Dismiss</button>
        </div>
      )}

      {activeTab === "staff" && showCreate && (
        <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
          <h2 className="font-black text-gray-800">Create Staff Account</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Email *</label>
              <input
                type="email"
                value={newStaff.email}
                onChange={(e) => setNewStaff({ ...newStaff, email: e.target.value })}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-500"
                placeholder="staff@email.com"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Display Name</label>
              <input
                type="text"
                value={newStaff.displayName}
                onChange={(e) => setNewStaff({ ...newStaff, displayName: e.target.value })}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-500"
                placeholder="John Doe"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Role</label>
              <select
                value={newStaff.role}
                onChange={(e) => setNewStaff({ ...newStaff, role: e.target.value })}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-500 bg-white"
              >
                <option value="staff">Staff (Orders only)</option>
                <option value="manager">Manager (Orders, Menu, Reports)</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              disabled={actionLoading === "create"}
              onClick={createStaff}
              className="px-4 py-2 bg-orange-600 text-white font-bold text-sm rounded-xl hover:bg-orange-500 disabled:opacity-50"
            >
              {actionLoading === "create" ? "Creating…" : "Create Account"}
            </button>
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 bg-gray-100 font-bold text-sm rounded-xl hover:bg-gray-200">
              Cancel
            </button>
          </div>
        </div>
      )}

      {activeTab === "waiters" && showCreateWaiter && (
        <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
          <h2 className="font-black text-gray-800">Add Waiter Profile</h2>
          <div className="max-w-md">
            <label className="block text-xs font-bold text-gray-500 mb-1">Waiter Full Name *</label>
            <input
              type="text"
              value={newWaiterName}
              onChange={(e) => setNewWaiterName(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-500"
              placeholder="e.g. Michael O."
            />
          </div>
          <div className="flex gap-2">
            <button
              disabled={actionLoading === "create-waiter"}
              onClick={createWaiter}
              className="px-4 py-2 bg-orange-600 text-white font-bold text-sm rounded-xl hover:bg-orange-500 disabled:opacity-50"
            >
              {actionLoading === "create-waiter" ? "Adding…" : "Add Waiter"}
            </button>
            <button onClick={() => setShowCreateWaiter(false)} className="px-4 py-2 bg-gray-100 font-bold text-sm rounded-xl hover:bg-gray-200">
              Cancel
            </button>
          </div>
        </div>
      )}

      {activeTab === "staff" ? (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          {loading ? (
            <div className="py-16 text-center text-gray-400 text-sm">Loading staff…</div>
          ) : (
            <>
              <div className="hidden md:block">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      {["Member", "Role", "Status", "POS PIN", "Added", "Actions"].map((h) => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-widest">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {staff.map((s) => (
                      <tr key={s.uid} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <p className="font-bold text-gray-900">{s.displayName || s.email}</p>
                          {s.displayName && <p className="text-xs text-gray-400">{s.email}</p>}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-bold uppercase px-2 py-1 rounded-full ${ROLE_COLORS[s.role] ?? "bg-gray-100 text-gray-600"}`}>
                            {ROLE_LABELS[s.role] ?? s.role}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-bold uppercase px-2 py-1 rounded-full ${s.disabled ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>
                            {s.disabled ? "Disabled" : "Active"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-bold px-2 py-1 rounded-full ${s.pinSet ? "bg-green-100 text-green-700 animate-fade-in" : "bg-yellow-100 text-yellow-800 animate-fade-in"}`}>
                            {s.pinSet ? "Configured" : "Not Set"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{fmtDate(s.createdAt)}</td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1.5 flex-wrap items-center">
                            <button
                              onClick={() => { setSelectedStaffForPin(s); setPinInputValue(""); setPinInputError(null); }}
                              className="text-xs font-bold px-2.5 py-1 bg-orange-100 text-orange-700 rounded-lg hover:bg-orange-200 transition-colors"
                            >
                              Set PIN
                            </button>
                            {s.role !== "owner" && (
                              <>
                                <select
                                  value={s.role}
                                  disabled={!!actionLoading}
                                  onChange={(e) => updateStaff(s.uid, { role: e.target.value })}
                                  className="border border-gray-200 rounded-lg px-2 py-1 text-xs bg-white outline-none"
                                >
                                  <option value="staff">Staff</option>
                                  <option value="manager">Manager</option>
                                </select>
                                <button
                                  disabled={!!actionLoading}
                                  onClick={() => updateStaff(s.uid, { disabled: !s.disabled })}
                                  className={`text-xs font-bold px-2 py-1 rounded-lg transition-colors disabled:opacity-50 ${s.disabled ? "bg-green-100 text-green-700 hover:bg-green-200" : "bg-amber-100 text-amber-700 hover:bg-amber-200"}`}
                                >
                                  {s.disabled ? "Enable" : "Disable"}
                                </button>
                                <button
                                  disabled={!!actionLoading}
                                  onClick={() => deleteStaff(s.uid)}
                                  className="text-xs font-bold px-2 py-1 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 disabled:opacity-50"
                                >
                                  Delete
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="md:hidden divide-y divide-gray-50">
                {staff.map((s) => (
                  <div key={s.uid} className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-gray-900">{s.displayName || s.email}</p>
                        {s.displayName && <p className="text-xs text-gray-400 truncate">{s.email}</p>}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                        <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded-full ${ROLE_COLORS[s.role] ?? "bg-gray-100 text-gray-600"}`}>
                          {ROLE_LABELS[s.role] ?? s.role}
                        </span>
                        <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded-full ${s.disabled ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>
                          {s.disabled ? "Disabled" : "Active"}
                        </span>
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${s.pinSet ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-800"}`}>
                          PIN: {s.pinSet ? "✓" : "✗"}
                        </span>
                      </div>
                    </div>
                    <p className="text-xs text-gray-400">Added: {fmtDate(s.createdAt)}</p>
                    <div className="flex flex-wrap gap-2 items-center">
                      <button
                        onClick={() => { setSelectedStaffForPin(s); setPinInputValue(""); setPinInputError(null); }}
                        className="text-xs font-bold px-3 py-1.5 bg-orange-100 text-orange-700 rounded-lg hover:bg-orange-200 transition-colors"
                      >
                        Set PIN
                      </button>
                      {s.role !== "owner" && (
                        <>
                          <select
                            value={s.role}
                            disabled={!!actionLoading}
                            onChange={(e) => updateStaff(s.uid, { role: e.target.value })}
                            className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white outline-none"
                          >
                            <option value="staff">Staff</option>
                            <option value="manager">Manager</option>
                          </select>
                          <button
                            disabled={!!actionLoading}
                            onClick={() => updateStaff(s.uid, { disabled: !s.disabled })}
                            className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 ${s.disabled ? "bg-green-100 text-green-700 hover:bg-green-200" : "bg-amber-100 text-amber-700 hover:bg-amber-200"}`}
                          >
                            {s.disabled ? "Enable" : "Disable"}
                          </button>
                          <button
                            disabled={!!actionLoading}
                            onClick={() => deleteStaff(s.uid)}
                            className="text-xs font-bold px-3 py-1.5 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 disabled:opacity-50"
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
          {!loading && staff.length === 0 && (
            <div className="py-16 text-center text-gray-400 text-sm">No staff members yet. Add your first one above.</div>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          {waitersLoading ? (
            <div className="py-16 text-center text-gray-400 text-sm">Loading waiters…</div>
          ) : (
            <>
              <div className="hidden md:block">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      {["Waiter Name", "Added On", "Actions"].map((h) => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-widest">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {waiters.map((w) => (
                      <tr key={w.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-bold text-gray-900">{w.name}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{fmtDate(w.createdAt)}</td>
                        <td className="px-4 py-3">
                          <button
                            disabled={actionLoading === `${w.id}-delete-waiter`}
                            onClick={() => deleteWaiter(w.id)}
                            className="text-xs font-bold px-2 py-1 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 disabled:opacity-50"
                          >
                            {actionLoading === `${w.id}-delete-waiter` ? "Deleting…" : "Delete"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="md:hidden divide-y divide-gray-50">
                {waiters.map((w) => (
                  <div key={w.id} className="p-4 flex items-center justify-between gap-4">
                    <div>
                      <p className="font-bold text-gray-900">{w.name}</p>
                      <p className="text-xs text-gray-400 mt-0.5">Added: {fmtDate(w.createdAt)}</p>
                    </div>
                    <button
                      disabled={actionLoading === `${w.id}-delete-waiter`}
                      onClick={() => deleteWaiter(w.id)}
                      className="text-xs font-bold px-3 py-1.5 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 disabled:opacity-50 shrink-0"
                    >
                      {actionLoading === `${w.id}-delete-waiter` ? "Deleting…" : "Delete"}
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
          {!waitersLoading && waiters.length === 0 && (
            <div className="py-16 text-center text-gray-400 text-sm">No waiters registered yet. Add your first one above.</div>
          )}
        </div>
      )}

      <div className="bg-gray-50 rounded-2xl border border-gray-100 p-5">
        <h3 className="font-bold text-gray-700 mb-3 text-sm">Role Permissions</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-gray-600">
          <div>
            <p className="font-black text-orange-600 mb-2">Owner</p>
            <ul className="space-y-1">
              {["Full access", "Manage staff", "Payment settings", "Subscription billing", "All reports"].map((f) => (
                <li key={f} className="flex items-center gap-1.5"><span className="text-green-500">✓</span>{f}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="font-black text-blue-600 mb-2">Manager</p>
            <ul className="space-y-1">
              {["Dashboard & orders", "Manage menu", "View reports", "Export data"].map((f) => (
                <li key={f} className="flex items-center gap-1.5"><span className="text-green-500">✓</span>{f}</li>
              ))}
              {["Payment settings", "Billing", "Staff management"].map((f) => (
                <li key={f} className="flex items-center gap-1.5"><span className="text-red-400">✗</span>{f}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="font-black text-gray-600 mb-2">Staff</p>
            <ul className="space-y-1">
              {["Dashboard", "View & update orders"].map((f) => (
                <li key={f} className="flex items-center gap-1.5"><span className="text-green-500">✓</span>{f}</li>
              ))}
              {["Menu editing", "Reports", "Settings", "Payments"].map((f) => (
                <li key={f} className="flex items-center gap-1.5"><span className="text-red-400">✗</span>{f}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Set/Change PIN Modal overlay */}
      {selectedStaffForPin && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm border border-gray-100 shadow-2xl space-y-4">
            <div>
              <h3 className="text-lg font-black text-gray-900">Set POS PIN Code</h3>
              <p className="text-xs text-gray-400 mt-1">
                Configure a secure 4-digit PIN for <strong>{selectedStaffForPin.displayName || selectedStaffForPin.email}</strong>.
              </p>
            </div>

            {pinInputError && (
              <div className="bg-red-50 border border-red-200 text-red-600 text-xs px-3.5 py-2.5 rounded-xl font-bold">
                {pinInputError}
              </div>
            )}

            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide">
                4-Digit Passcode
              </label>
              <input
                type="password"
                pattern="\d*"
                maxLength={4}
                value={pinInputValue}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, "");
                  if (val.length <= 4) setPinInputValue(val);
                }}
                placeholder="••••"
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-lg text-center tracking-widest outline-none focus:border-orange-500 font-bold font-mono"
              />
            </div>

            <div className="flex gap-2.5 pt-2">
              <button
                disabled={pinSubmitting}
                onClick={handleSetPin}
                className="flex-1 bg-orange-600 hover:bg-orange-500 text-white font-bold text-sm py-3 rounded-xl disabled:opacity-50 transition-colors"
              >
                {pinSubmitting ? "Saving..." : "Save PIN"}
              </button>
              <button
                disabled={pinSubmitting}
                onClick={() => setSelectedStaffForPin(null)}
                className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-sm py-3 rounded-xl transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
