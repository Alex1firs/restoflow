"use client";

import { useState, useEffect, useCallback } from "react";

type StaffMember = {
  uid: string;
  email: string;
  displayName: string;
  role: string;
  disabled: boolean;
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
  const [inviteResult, setInviteResult] = useState<{ resetLink: string; email: string } | null>(null);

  const fetchStaff = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/staff");
      if (res.ok) setStaff((await res.json()).staff);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStaff(); }, [fetchStaff]);

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
      setInviteResult({ resetLink: data.resetLink, email: newStaff.email });
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

  function fmtDate(iso: string | null) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-gray-900">Staff Management</h1>
          <p className="text-sm text-gray-500 mt-1">Manage who can access your restaurant admin.</p>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="bg-orange-600 text-white font-bold px-4 py-2.5 rounded-xl hover:bg-orange-500 transition-colors text-sm"
        >
          + Add Staff
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 text-sm px-4 py-3 rounded-xl">{error}</div>
      )}

      {inviteResult && (
        <div className="bg-green-50 border border-green-200 rounded-2xl p-5">
          <p className="font-bold text-green-800 mb-1">Staff account created for {inviteResult.email}</p>
          <p className="text-sm text-green-700 mb-3">Share this password reset link with the staff member so they can set their password:</p>
          <div className="bg-white rounded-xl border border-green-200 p-3 flex items-center justify-between gap-3">
            <p className="font-mono text-xs text-gray-700 break-all">{inviteResult.resetLink}</p>
            <button
              onClick={() => { navigator.clipboard.writeText(inviteResult.resetLink); }}
              className="flex-shrink-0 text-xs font-bold px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-500"
            >
              Copy
            </button>
          </div>
          <button onClick={() => setInviteResult(null)} className="text-xs text-green-600 mt-2 hover:underline">Dismiss</button>
        </div>
      )}

      {showCreate && (
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

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-gray-400 text-sm">Loading staff…</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                {["Member", "Role", "Status", "Added", "Actions"].map((h) => (
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
                    <span className={`text-[10px] font-bold uppercase px-2 py-1 rounded-full ${ROLE_COLORS[s.role] ?? "bg-gray-100 text-gray-600"}`}>
                      {ROLE_LABELS[s.role] ?? s.role}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] font-bold uppercase px-2 py-1 rounded-full ${s.disabled ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>
                      {s.disabled ? "Disabled" : "Active"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{fmtDate(s.createdAt)}</td>
                  <td className="px-4 py-3">
                    {s.role === "owner" ? (
                      <span className="text-xs text-gray-400">—</span>
                    ) : (
                      <div className="flex gap-1.5 flex-wrap">
                        {s.role !== "owner" && (
                          <select
                            value={s.role}
                            disabled={!!actionLoading}
                            onChange={(e) => updateStaff(s.uid, { role: e.target.value })}
                            className="border border-gray-200 rounded-lg px-2 py-1 text-xs bg-white outline-none"
                          >
                            <option value="staff">Staff</option>
                            <option value="manager">Manager</option>
                          </select>
                        )}
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
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!loading && staff.length === 0 && (
          <div className="py-16 text-center text-gray-400 text-sm">No staff members yet. Add your first one above.</div>
        )}
      </div>

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
    </div>
  );
}
