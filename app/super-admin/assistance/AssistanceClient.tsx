"use client";

import { useState } from "react";

type AssistanceRequest = {
  slug: string;
  name: string;
  email: string | null;
  phone: string | null;
  notificationPhone: string | null;
  setupScore: number | null;
  assistanceStatus: string;
  assistanceRequestedAt: string | null;
  assistanceResolvedAt: string | null;
  restaurantStatus: string;
  notes: string | null;
};

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("234")) return digits;
  if (digits.startsWith("0")) return "234" + digits.slice(1);
  return digits;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const RESTAURANT_STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600",
  pending_review: "bg-amber-100 text-amber-700",
  live: "bg-green-100 text-green-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
  suspended: "bg-red-100 text-red-700",
};

const WA_MESSAGE = encodeURIComponent(
  "Hello, this is RestoFlow support. We received your setup assistance request and would like to help you complete your store setup."
);

export default function AssistanceClient({ requests }: { requests: AssistanceRequest[] }) {
  const [filter, setFilter] = useState<"open" | "resolved" | "all">("open");
  const [loadingSlug, setLoadingSlug] = useState<string | null>(null);
  const [confirmSlug, setConfirmSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [localRequests, setLocalRequests] = useState(requests);

  const filtered = localRequests.filter((r) => {
    if (filter === "open") return r.assistanceStatus === "open";
    if (filter === "resolved") return r.assistanceStatus === "resolved";
    return true;
  });

  const openCount = localRequests.filter((r) => r.assistanceStatus === "open").length;

  async function resolve(slug: string) {
    setLoadingSlug(slug);
    setError(null);
    setConfirmSlug(null);
    try {
      const res = await fetch("/api/super-admin/assistance/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        setError(d.error ?? "Failed to resolve request.");
        return;
      }
      setLocalRequests((prev) =>
        prev.map((r) =>
          r.slug === slug
            ? { ...r, assistanceStatus: "resolved", assistanceResolvedAt: new Date().toISOString() }
            : r
        )
      );
      setSuccess("Marked as resolved.");
      setTimeout(() => setSuccess(null), 4000);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoadingSlug(null);
    }
  }

  async function reopen(slug: string) {
    setLoadingSlug(slug);
    setError(null);
    try {
      const res = await fetch("/api/super-admin/assistance/reopen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        setError(d.error ?? "Failed to reopen request.");
        return;
      }
      setLocalRequests((prev) =>
        prev.map((r) =>
          r.slug === slug
            ? { ...r, assistanceStatus: "open", assistanceRequestedAt: new Date().toISOString() }
            : r
        )
      );
      setSuccess("Request reopened.");
      setTimeout(() => setSuccess(null), 4000);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoadingSlug(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-black text-gray-900">Setup Assistance</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {openCount} open {openCount === 1 ? "request" : "requests"}
          </p>
        </div>
        <div className="flex gap-2">
          {(["open", "resolved", "all"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-xs font-bold px-3 py-1.5 rounded-full transition-all ${
                filter === f
                  ? "bg-orange-600 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Alerts */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 text-sm px-4 py-3 rounded-xl">
          {error}
        </div>
      )}
      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 text-sm px-4 py-3 rounded-xl">
          {success}
        </div>
      )}

      {/* Requests */}
      <div className="space-y-4">
        {filtered.map((r) => {
          const contactPhone = r.phone || r.notificationPhone;
          const waPhone = contactPhone ? normalizePhone(contactPhone) : null;
          const isLoading = loadingSlug === r.slug;
          const isConfirming = confirmSlug === r.slug;

          return (
            <div key={r.slug} className="bg-white rounded-2xl border border-gray-100 p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <h3 className="font-black text-gray-900">{r.name}</h3>
                    <span
                      className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                        RESTAURANT_STATUS_COLORS[r.restaurantStatus] ?? "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {r.restaurantStatus.replace(/_/g, " ")}
                    </span>
                    {r.assistanceStatus === "resolved" ? (
                      <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                        Resolved
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                        Open
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-gray-400 font-mono">/{r.slug}</p>

                  {(r.email || contactPhone) && (
                    <div className="mt-2 space-y-0.5">
                      {r.email && <p className="text-sm text-gray-600">{r.email}</p>}
                      {contactPhone && <p className="text-xs text-gray-500">{contactPhone}</p>}
                    </div>
                  )}

                  <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-400">
                    {r.setupScore !== null && (
                      <span>
                        Setup:{" "}
                        <span className="font-bold text-gray-600">{r.setupScore}%</span>
                      </span>
                    )}
                    {r.assistanceRequestedAt && (
                      <span>
                        Requested:{" "}
                        <span className="font-bold text-gray-600">
                          {fmtDate(r.assistanceRequestedAt)}
                        </span>
                      </span>
                    )}
                    {r.assistanceStatus === "resolved" && r.assistanceResolvedAt && (
                      <span>
                        Resolved:{" "}
                        <span className="font-bold text-gray-600">
                          {fmtDate(r.assistanceResolvedAt)}
                        </span>
                      </span>
                    )}
                  </div>

                  {r.notes && (
                    <p className="mt-2 text-xs text-gray-500 italic">{r.notes}</p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex flex-col gap-2 items-end shrink-0">
                  {/* Contact */}
                  <div className="flex gap-2 flex-wrap justify-end">
                    {waPhone && (
                      <a
                        href={`https://wa.me/${waPhone}?text=${WA_MESSAGE}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-bold px-3 py-1.5 bg-green-50 text-green-700 border border-green-200 rounded-lg hover:bg-green-100 transition-colors"
                      >
                        WhatsApp
                      </a>
                    )}
                    {contactPhone && (
                      <a
                        href={`tel:${contactPhone}`}
                        className="text-xs font-bold px-3 py-1.5 bg-gray-50 text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors"
                      >
                        Call
                      </a>
                    )}
                    {r.email && (
                      <a
                        href={`mailto:${r.email}`}
                        className="text-xs font-bold px-3 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors"
                      >
                        Email
                      </a>
                    )}
                  </div>

                  {/* Resolve / Reopen */}
                  <div className="flex gap-2 flex-wrap justify-end">
                    {r.assistanceStatus === "open" && !isConfirming && (
                      <button
                        disabled={isLoading}
                        onClick={() => setConfirmSlug(r.slug)}
                        className="text-xs font-bold px-3 py-1.5 bg-orange-600 text-white rounded-lg hover:bg-orange-500 disabled:opacity-50 transition-colors"
                      >
                        Mark as Resolved
                      </button>
                    )}
                    {r.assistanceStatus === "open" && isConfirming && (
                      <>
                        <button
                          disabled={isLoading}
                          onClick={() => resolve(r.slug)}
                          className="text-xs font-bold px-3 py-1.5 bg-orange-600 text-white rounded-lg hover:bg-orange-500 disabled:opacity-50 transition-colors"
                        >
                          {isLoading ? "Resolving…" : "Confirm Resolve"}
                        </button>
                        <button
                          disabled={isLoading}
                          onClick={() => setConfirmSlug(null)}
                          className="text-xs font-bold px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-50 transition-colors"
                        >
                          Cancel
                        </button>
                      </>
                    )}
                    {r.assistanceStatus === "resolved" && (
                      <button
                        disabled={isLoading}
                        onClick={() => reopen(r.slug)}
                        className="text-xs font-bold px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-50 transition-colors"
                      >
                        {isLoading ? "Reopening…" : "Reopen"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 py-16 text-center">
            <p className="text-gray-400 text-sm font-medium">
              {filter === "open"
                ? "No setup assistance requests at the moment."
                : filter === "resolved"
                ? "No resolved requests."
                : "No assistance requests found."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
