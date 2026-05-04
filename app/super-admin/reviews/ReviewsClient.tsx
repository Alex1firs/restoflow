"use client";

import { useState } from "react";
import type { SetupChecklist } from "@/lib/setup-checklist";

type ReviewRestaurant = {
  slug: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  menuItemCount: number;
  paymentConfigured: boolean;
  customDomain: string | null;
  subscriptionStatus: string;
  setupScore: number;
  checklist: SetupChecklist;
  createdAt: string | null;
  status: string;
};

const SUB_STATUS_COLORS: Record<string, string> = {
  active:    "bg-green-100 text-green-700",
  trialing:  "bg-amber-100 text-amber-700",
  expired:   "bg-red-100 text-red-700",
  suspended: "bg-gray-200 text-gray-600",
};

export default function ReviewsClient({ restaurants }: { restaurants: ReviewRestaurant[] }) {
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejectSlug, setRejectSlug] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [expandedChecklist, setExpandedChecklist] = useState<string | null>(null);

  async function doAction(slug: string, action: string, extra?: Record<string, unknown>) {
    setLoading(`${slug}-${action}`);
    setError(null);
    try {
      const res = await fetch(`/api/super-admin/restaurants/${slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error ?? "Action failed");
      } else {
        window.location.reload();
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(null);
    }
  }

  async function submitReject(slug: string) {
    if (!rejectReason.trim()) {
      setError("Please enter a rejection reason.");
      return;
    }
    await doAction(slug, "reject", { reason: rejectReason });
    setRejectSlug(null);
    setRejectReason("");
  }

  function fmtDate(iso: string | null) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("en-NG", {
      day: "numeric", month: "short", year: "numeric",
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-gray-900">Pending Reviews</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {restaurants.length === 0
              ? "No restaurants awaiting review."
              : `${restaurants.length} restaurant${restaurants.length !== 1 ? "s" : ""} awaiting approval`}
          </p>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 text-sm px-4 py-3 rounded-xl">
          {error}
        </div>
      )}

      {restaurants.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 py-24 text-center">
          <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="font-bold text-gray-700">All clear</p>
          <p className="text-sm text-gray-400 mt-1">No pending review requests.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {restaurants.map((r) => (
            <div key={r.slug} className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              {/* Card header */}
              <div className="p-6 space-y-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-black text-gray-900">{r.name}</h2>
                    <p className="text-xs text-gray-400 font-medium mt-0.5">/{r.slug}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Setup score badge */}
                    <div className="flex items-center gap-1.5">
                      <div className={`text-xs font-black px-2.5 py-1 rounded-full ${
                        r.setupScore >= 80 ? "bg-green-100 text-green-700" :
                        r.setupScore >= 50 ? "bg-amber-100 text-amber-700" :
                        "bg-red-100 text-red-600"
                      }`}>
                        Score {r.setupScore}/100
                      </div>
                    </div>
                    <span className="text-[10px] font-black uppercase px-3 py-1 rounded-full bg-blue-100 text-blue-700 tracking-widest">
                      Pending Review
                    </span>
                  </div>
                </div>

                {/* Score progress bar */}
                <div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        r.setupScore >= 80 ? "bg-green-500" :
                        r.setupScore >= 50 ? "bg-amber-400" : "bg-red-400"
                      }`}
                      style={{ width: `${r.setupScore}%` }}
                    />
                  </div>
                </div>

                {/* Details grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                  <Detail label="Email"   value={r.email   || "—"} />
                  <Detail label="Phone"   value={r.phone   || "—"} />
                  <Detail label="Address" value={r.address || "—"} />
                  <Detail label="Menu items" value={String(r.menuItemCount)} />
                  <Detail
                    label="Payment"
                    value={r.paymentConfigured ? "Configured" : "Not set up"}
                    valueClass={r.paymentConfigured ? "text-green-600" : "text-red-500"}
                  />
                  <Detail
                    label="Custom domain"
                    value={r.customDomain || "None"}
                    valueClass={r.customDomain ? "text-green-600" : "text-gray-400"}
                  />
                  <div>
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-1">Subscription</p>
                    <span className={`text-[10px] font-bold uppercase px-2 py-1 rounded-full ${SUB_STATUS_COLORS[r.subscriptionStatus] ?? "bg-gray-100 text-gray-600"}`}>
                      {r.subscriptionStatus}
                    </span>
                  </div>
                  <Detail label="Submitted" value={fmtDate(r.createdAt)} />
                </div>

                {/* Reject reason form */}
                {rejectSlug === r.slug && (
                  <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-3">
                    <p className="text-sm font-bold text-red-800">Rejection reason</p>
                    <textarea
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      placeholder="Explain why this restaurant is being rejected…"
                      rows={3}
                      className="w-full border border-red-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-red-400 resize-none bg-white"
                    />
                    <div className="flex gap-2">
                      <button
                        disabled={!!loading}
                        onClick={() => submitReject(r.slug)}
                        className="text-sm font-bold px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-500 disabled:opacity-50 transition-colors"
                      >
                        {loading === `${r.slug}-reject` ? "Rejecting…" : "Confirm rejection"}
                      </button>
                      <button
                        onClick={() => { setRejectSlug(null); setRejectReason(""); setError(null); }}
                        className="text-sm font-bold px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex flex-wrap gap-2 pt-1 border-t border-gray-100">
                  <a
                    href={`/admin/${r.slug}/preview`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-bold px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl transition-colors"
                  >
                    Preview ↗
                  </a>
                  <button
                    disabled={!!loading}
                    onClick={() => doAction(r.slug, "approve")}
                    className="text-sm font-bold px-4 py-2 bg-green-600 text-white rounded-xl hover:bg-green-500 disabled:opacity-50 transition-colors"
                  >
                    {loading === `${r.slug}-approve` ? "Approving…" : "Approve"}
                  </button>
                  {rejectSlug !== r.slug && (
                    <button
                      disabled={!!loading}
                      onClick={() => { setRejectSlug(r.slug); setError(null); }}
                      className="text-sm font-bold px-4 py-2 bg-red-100 text-red-700 hover:bg-red-200 rounded-xl disabled:opacity-50 transition-colors"
                    >
                      Reject
                    </button>
                  )}
                  <button
                    disabled={!!loading}
                    onClick={() => doAction(r.slug, "suspendRestaurant")}
                    className="text-sm font-bold px-4 py-2 bg-gray-700 text-white hover:bg-gray-600 rounded-xl disabled:opacity-50 transition-colors"
                  >
                    {loading === `${r.slug}-suspendRestaurant` ? "Suspending…" : "Suspend"}
                  </button>
                  <button
                    onClick={() => setExpandedChecklist(expandedChecklist === r.slug ? null : r.slug)}
                    className="ml-auto text-sm font-bold px-4 py-2 bg-gray-50 hover:bg-gray-100 text-gray-500 rounded-xl transition-colors"
                  >
                    {expandedChecklist === r.slug ? "Hide checklist" : "View checklist"}
                  </button>
                </div>
              </div>

              {/* Expandable checklist */}
              {expandedChecklist === r.slug && (
                <div className="border-t border-gray-100 bg-gray-50 px-6 py-4">
                  <p className="text-xs font-black text-gray-400 uppercase tracking-widest mb-3">Setup checklist</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {r.checklist.items.map((item) => (
                      <div
                        key={item.key}
                        className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border text-xs font-bold ${
                          item.passed
                            ? "bg-white border-gray-100 text-gray-600"
                            : item.required
                            ? "bg-red-50 border-red-200 text-red-700"
                            : "bg-white border-gray-100 text-gray-400"
                        }`}
                      >
                        <div className={`shrink-0 w-4 h-4 rounded-full flex items-center justify-center ${
                          item.passed ? "bg-green-100" : item.required ? "bg-red-100" : "bg-gray-100"
                        }`}>
                          {item.passed ? (
                            <svg className="w-2.5 h-2.5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          ) : (
                            <svg className={`w-2.5 h-2.5 ${item.required ? "text-red-500" : "text-gray-400"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          )}
                        </div>
                        <span className="flex-1 truncate">{item.label}</span>
                        <span className={`shrink-0 ${item.passed ? "text-green-600" : "text-gray-300"}`}>
                          +{item.points}
                        </span>
                        {item.required && !item.passed && (
                          <span className="shrink-0 text-[9px] font-black text-red-500 uppercase tracking-wide">req</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Detail({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div>
      <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-sm font-medium text-gray-700 break-words ${valueClass ?? ""}`}>{value}</p>
    </div>
  );
}
