"use client";

import { useEffect, useState } from "react";
import { ShoppingBasket, RefreshCw, Clock, AlertTriangle } from "lucide-react";

/**
 * Smart Purchasing card — turns the 7-day forecast into a concrete prep &
 * purchasing plan: per-item expected units, suggested prep batches, a LOW/MED/HIGH
 * reorder signal, and the peak production window. Loads the cached plan via GET; if
 * none exists, generates once (deterministic, no LLM). Ingredient-level quantities
 * light up automatically once recipes exist (a future phase).
 */

type Signal = "LOW" | "MEDIUM" | "HIGH";

type Line = {
  item: string;
  expectedUnits: number;
  expectedUnitsPerDay: number;
  preparationBatches: number;
  peakWindow: string | null;
  reorderSignal: Signal;
  guidance: string;
};

type Plan = {
  menuDemand: Line[];
  peakWindows: { window: string; expectedSharePct: number }[];
  summary: string;
  ingredientPlanningAvailable: boolean;
  confidenceLevel: string;
};

const SIGNAL_STYLES: Record<Signal, string> = {
  HIGH: "bg-red-50 text-red-700 border-red-200",
  MEDIUM: "bg-amber-50 text-amber-700 border-amber-200",
  LOW: "bg-gray-50 text-gray-500 border-gray-200",
};

export default function PurchasingCard({ role }: { role?: string }) {
  const canManage = role === "owner" || role === "manager";
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/admin/ai/purchasing`);
        if (!active) return;
        if (res.ok) {
          const body = (await res.json()) as { plan: Plan | null };
          if (body.plan || !canManage) {
            setPlan(body.plan);
            setLoading(false);
            return;
          }
          const gen = await fetch(`/api/admin/ai/purchasing`, { method: "POST" });
          if (active && gen.ok) {
            const g = (await gen.json()) as { plan: Plan };
            setPlan(g.plan);
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
      const res = await fetch(`/api/admin/ai/purchasing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
      if (res.status === 429) {
        setError("Please wait a moment before refreshing again.");
        return;
      }
      if (!res.ok) {
        setError("Couldn't refresh the plan.");
        return;
      }
      const body = (await res.json()) as { plan: Plan };
      setPlan(body.plan);
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-xl bg-emerald-50 flex items-center justify-center">
            <ShoppingBasket className="w-4 h-4 text-emerald-600" />
          </span>
          <div>
            <h2 className="text-sm font-black text-gray-900 leading-tight">Smart Purchasing</h2>
            {plan && <p className="text-[11px] text-gray-400 leading-tight">Next 7 days · Confidence: {plan.confidenceLevel}</p>}
          </div>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={refresh}
            disabled={busy}
            className="inline-flex items-center gap-1 text-[11px] font-black text-emerald-600 hover:text-emerald-700 disabled:opacity-40 transition-colors"
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
      ) : !plan || plan.menuDemand.length === 0 ? (
        <p className="text-sm text-gray-500">Not enough demand signal yet to build a purchasing plan — check back after a few more days of sales.</p>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-gray-600">{plan.summary}</p>

          {plan.peakWindows.length > 0 && (
            <div className="flex items-center gap-2 text-xs text-gray-600">
              <Clock className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
              Concentrate prep before <span className="font-black text-gray-900">{plan.peakWindows[0].window}</span>
            </div>
          )}

          <ul className="space-y-2">
            {plan.menuDemand.slice(0, 6).map((l) => (
              <li key={l.item} className="rounded-xl border border-gray-100 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-black text-gray-900 truncate">{l.item}</span>
                  <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border whitespace-nowrap ${SIGNAL_STYLES[l.reorderSignal]}`}>
                    {l.reorderSignal === "HIGH" && <AlertTriangle className="inline w-3 h-3 mr-0.5 -mt-0.5" />}
                    {l.reorderSignal}
                  </span>
                </div>
                <p className="text-[11px] text-gray-600 mt-1 leading-snug">{l.guidance}</p>
                {l.expectedUnits > 0 && (
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    ~{l.expectedUnits} units / 7 days · {l.preparationBatches} prep batch{l.preparationBatches === 1 ? "" : "es"}/day
                  </p>
                )}
              </li>
            ))}
          </ul>

          {!plan.ingredientPlanningAvailable && (
            <p className="text-[11px] text-gray-400 border-t border-gray-100 pt-2">
              Ingredient-level quantities and reorder-by-supplier will unlock once recipes are set up.
            </p>
          )}
        </div>
      )}

      {error && <p className="text-xs text-red-500 font-bold mt-3">{error}</p>}
    </div>
  );
}
