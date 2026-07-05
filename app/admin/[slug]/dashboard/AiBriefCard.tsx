"use client";

import { useEffect, useState } from "react";
import { Sparkles, RefreshCw, AlertTriangle, TrendingUp, Lightbulb, Info } from "lucide-react";

/**
 * Daily AI Brief card. Loads TODAY's cached brief instantly via GET (no LLM on the
 * request path). Owners/managers can manually refresh (POST → same generation
 * pipeline, de-duplicated server-side).
 */

type Brief = {
  summary: string;
  highlights: string[];
  recommendations: { title: string; action: string; confidenceLevel: string }[];
  anomalies: { title: string; reason: string; severity: string }[];
  metrics: {
    revenue: number;
    orders: number;
    averageOrderValue: number;
    revenueChangePct: number | null;
    topItem: string | null;
  };
  timeWindow: { label: string };
  generatedAt: string;
  modelUsed: string | null;
  mode: "ai" | "deterministic";
  degraded: boolean;
  confidenceLevel: string;
};

function naira(n: number) {
  return `₦${Math.round(n).toLocaleString("en-NG")}`;
}

function timeAgo(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

export default function AiBriefCard({ role }: { role?: string }) {
  const canRefresh = role === "owner" || role === "manager";
  const [brief, setBrief] = useState<Brief | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/admin/ai/brief`);
        if (!active) return;
        if (res.ok) {
          const body = (await res.json()) as { brief: Brief | null };
          setBrief(body.brief);
        }
      } catch {
        /* leave empty state */
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/ai/brief`, { method: "POST" });
      if (res.status === 409) {
        setError("A brief is already being generated. Try again shortly.");
        return;
      }
      if (!res.ok) {
        setError("Couldn't generate the brief. Please try again.");
        return;
      }
      const body = (await res.json()) as { brief: Brief };
      setBrief(body.brief);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-xl bg-orange-100 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-orange-600" />
          </span>
          <div>
            <h2 className="text-sm font-black text-gray-900 leading-tight">Morning Brief</h2>
            {brief && (
              <p className="text-[11px] text-gray-400 font-medium">
                {brief.timeWindow.label} · {timeAgo(brief.generatedAt)}
                {brief.mode === "deterministic" ? " · data summary" : ""}
              </p>
            )}
          </div>
        </div>
        {canRefresh && (
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing}
            className="inline-flex items-center gap-1 text-[11px] font-black text-orange-600 hover:text-orange-700 disabled:opacity-40 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
            {brief ? "Refresh" : "Generate"}
          </button>
        )}
      </div>

      {loading ? (
        <div className="space-y-2 animate-pulse">
          <div className="h-3 bg-gray-100 rounded w-full" />
          <div className="h-3 bg-gray-100 rounded w-5/6" />
          <div className="h-3 bg-gray-100 rounded w-2/3" />
        </div>
      ) : !brief ? (
        <div className="text-sm text-gray-500">
          <p>Your morning brief isn&apos;t ready yet.</p>
          {canRefresh ? (
            <p className="text-xs text-gray-400 mt-1">Click “Generate” to create today&apos;s brief from your data.</p>
          ) : (
            <p className="text-xs text-gray-400 mt-1">It will appear here each morning.</p>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {/* Summary */}
          <p className="text-sm text-gray-700 leading-relaxed">{brief.summary}</p>

          {/* Metrics row */}
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs">
            <Metric label="Revenue" value={naira(brief.metrics.revenue)} accent />
            <Metric label="Orders" value={String(brief.metrics.orders)} />
            <Metric label="Avg order" value={naira(brief.metrics.averageOrderValue)} />
            {brief.metrics.topItem && <Metric label="Top item" value={brief.metrics.topItem} />}
            {brief.metrics.revenueChangePct != null && (
              <Metric
                label="vs prev"
                value={`${brief.metrics.revenueChangePct >= 0 ? "+" : ""}${brief.metrics.revenueChangePct}%`}
              />
            )}
          </div>

          {/* Recommendations */}
          {brief.recommendations.length > 0 && (
            <Section icon={<Lightbulb className="w-3.5 h-3.5 text-blue-500" />} title="Recommendations">
              {brief.recommendations.map((r, i) => (
                <li key={i} className="text-xs text-gray-600">
                  <span className="font-black text-gray-800">{r.title}</span> — {r.action}
                </li>
              ))}
            </Section>
          )}

          {/* Anomalies */}
          {brief.anomalies.length > 0 && (
            <Section icon={<AlertTriangle className="w-3.5 h-3.5 text-red-500" />} title="Needs attention">
              {brief.anomalies.map((a, i) => (
                <li key={i} className="text-xs text-gray-600">
                  <span className="font-black text-gray-800">{a.title}</span> — {a.reason}
                </li>
              ))}
            </Section>
          )}

          {/* Highlights */}
          {brief.highlights.length > 0 && (
            <Section icon={<TrendingUp className="w-3.5 h-3.5 text-green-500" />} title="Highlights">
              {brief.highlights.map((h, i) => (
                <li key={i} className="text-xs text-gray-600">{h}</li>
              ))}
            </Section>
          )}

          <p className="flex items-center gap-1 text-[11px] text-gray-400 font-medium">
            <Info className="w-3 h-3" /> Confidence: {brief.confidenceLevel}
            {brief.degraded ? " · AI narration unavailable" : ""}
          </p>
        </div>
      )}

      {error && <p className="text-xs text-red-500 font-bold mt-3">{error}</p>}
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">{label}</p>
      <p className={`font-black ${accent ? "text-green-600" : "text-gray-800"}`}>{value}</p>
    </div>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-[11px] font-black text-gray-400 uppercase tracking-widest mb-1.5">
        {icon} {title}
      </p>
      <ul className="space-y-1 list-none">{children}</ul>
    </div>
  );
}
