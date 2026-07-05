"use client";

import { useEffect, useState } from "react";
import {
  Lightbulb, RefreshCw, Check, X, TrendingUp, Users, PackageCheck, Layers, Megaphone, Heart, HelpCircle, AlertTriangle, type LucideIcon,
} from "lucide-react";

/**
 * Recommendations card — shows the deterministic, actionable recommendations and
 * lets owners/managers accept or dismiss them. Loads the cached set via GET; if
 * empty, generates once (deterministic, no LLM). Accept/dismiss = PATCH.
 */

type RecType = "price_increase" | "promote_item" | "staffing" | "bundle" | "reenable_item" | "loyalty";

type Explanation = { what: string; why: string[]; ifIgnored: string; confidenceLevel: string };
type Rec = {
  id: string;
  type: RecType;
  title: string;
  rationale: string;
  expectedImpact: string;
  confidenceLevel: string;
  status: string;
  explanation?: Explanation;
};

const ICONS: Record<RecType, LucideIcon> = {
  price_increase: TrendingUp,
  promote_item: Megaphone,
  staffing: Users,
  bundle: Layers,
  reenable_item: PackageCheck,
  loyalty: Heart,
};

export default function RecommendationsCard({ role }: { role?: string }) {
  const canManage = role === "owner" || role === "manager";
  const [recs, setRecs] = useState<Rec[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [actioning, setActioning] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");

  function toggleWhy(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/admin/ai/recommendations`);
        if (!active) return;
        if (res.ok) {
          const body = (await res.json()) as { recommendations: Rec[] };
          if (body.recommendations.length > 0 || !canManage) {
            setRecs(body.recommendations);
            setLoading(false);
            return;
          }
          // Empty and we can manage → generate once (deterministic, cheap).
          const gen = await fetch(`/api/admin/ai/recommendations`, { method: "POST" });
          if (active && gen.ok) {
            const g = (await gen.json()) as { recommendations: Rec[] };
            setRecs(g.recommendations);
          }
        }
      } catch {
        /* leave empty */
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/ai/recommendations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
      if (res.status === 429) {
        setError("Please wait a moment before refreshing again.");
        return;
      }
      if (!res.ok) {
        setError("Couldn't refresh recommendations.");
        return;
      }
      const body = (await res.json()) as { recommendations: Rec[] };
      setRecs(body.recommendations);
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(rec: Rec, status: "accepted" | "dismissed") {
    setActioning(rec.id);
    try {
      const res = await fetch(`/api/admin/ai/recommendations/${encodeURIComponent(rec.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        setError("Couldn't update. Please try again.");
        return;
      }
      if (status === "dismissed") {
        setRecs((rs) => rs.filter((r) => r.id !== rec.id));
      } else {
        setRecs((rs) => rs.map((r) => (r.id === rec.id ? { ...r, status } : r)));
      }
    } catch {
      setError("Network error.");
    } finally {
      setActioning(null);
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center">
            <Lightbulb className="w-4 h-4 text-blue-600" />
          </span>
          <h2 className="text-sm font-black text-gray-900 leading-tight">Recommendations</h2>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={refresh}
            disabled={busy}
            className="inline-flex items-center gap-1 text-[11px] font-black text-blue-600 hover:text-blue-700 disabled:opacity-40 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${busy ? "animate-spin" : ""}`} />
            Refresh
          </button>
        )}
      </div>

      {loading ? (
        <div className="space-y-2 animate-pulse">
          <div className="h-3 bg-gray-100 rounded w-full" />
          <div className="h-3 bg-gray-100 rounded w-4/5" />
        </div>
      ) : recs.length === 0 ? (
        <p className="text-sm text-gray-500">No recommendations right now — your numbers look steady. Check back after more activity.</p>
      ) : (
        <ul className="space-y-3">
          {recs.map((r) => {
            const Icon = ICONS[r.type] ?? Lightbulb;
            const accepted = r.status === "accepted";
            return (
              <li key={r.id} className={`rounded-xl border p-3 ${accepted ? "border-green-200 bg-green-50/40" : "border-gray-100"}`}>
                <div className="flex items-start gap-2.5">
                  <span className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Icon className="w-3.5 h-3.5 text-blue-600" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-black text-gray-900">{r.title}</p>
                    <p className="text-xs text-gray-600 mt-0.5">{r.rationale}</p>
                    <p className="text-[11px] text-gray-400 mt-1">
                      Expected impact: {r.expectedImpact} · Confidence: {r.confidenceLevel}
                    </p>

                    {r.explanation && (
                      <>
                        <button
                          type="button"
                          onClick={() => toggleWhy(r.id)}
                          className="inline-flex items-center gap-1 text-[11px] font-black text-blue-600 hover:text-blue-700 mt-1.5"
                        >
                          <HelpCircle className="w-3 h-3" /> {expanded.has(r.id) ? "Hide details" : "Why?"}
                        </button>
                        {expanded.has(r.id) && (
                          <div className="mt-1.5 rounded-lg bg-gray-50 border border-gray-100 p-2.5 space-y-1.5">
                            <div>
                              <p className="text-[10px] font-black text-gray-400 uppercase tracking-wide">Why</p>
                              <ul className="mt-0.5 space-y-0.5">
                                {r.explanation.why.map((w, i) => (
                                  <li key={i} className="text-[11px] text-gray-600 leading-snug">• {w}</li>
                                ))}
                              </ul>
                            </div>
                            <div className="flex items-start gap-1.5">
                              <AlertTriangle className="w-3 h-3 text-amber-500 flex-shrink-0 mt-0.5" />
                              <p className="text-[11px] text-amber-700 font-bold leading-snug">{r.explanation.ifIgnored}</p>
                            </div>
                          </div>
                        )}
                      </>
                    )}

                    {canManage && (
                      <div className="flex items-center gap-2 mt-2">
                        {accepted ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-black text-green-700">
                            <Check className="w-3.5 h-3.5" /> Accepted
                          </span>
                        ) : (
                          <button
                            type="button"
                            disabled={actioning === r.id}
                            onClick={() => setStatus(r, "accepted")}
                            className="inline-flex items-center gap-1 text-[11px] font-black text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 px-2.5 py-1 rounded-lg transition-colors"
                          >
                            <Check className="w-3 h-3" /> Accept
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={actioning === r.id}
                          onClick={() => setStatus(r, "dismissed")}
                          className="inline-flex items-center gap-1 text-[11px] font-black text-gray-500 hover:text-gray-700 disabled:opacity-40 transition-colors"
                        >
                          <X className="w-3 h-3" /> Dismiss
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {error && <p className="text-xs text-red-500 font-bold mt-3">{error}</p>}
    </div>
  );
}
