"use client";

import { useEffect, useState } from "react";
import { TrendingUp, RefreshCw, Clock, ShoppingBasket, Info } from "lucide-react";

/**
 * Forecast card — shows the deterministic 7-day outlook: expected revenue &
 * orders (with a range), the top item-demand projections (what Smart Purchasing
 * will buy against), the expected peak window, and the "why" drivers. Loads the
 * cached forecast via GET; if none exists, generates once (deterministic, no LLM).
 */

type ForecastPoint = {
  predicted: number;
  low: number;
  high: number;
  unit: "NGN" | "orders";
  confidenceLevel: string;
};

type ItemDemand = {
  item: string;
  expectedUnitsPerDay: number;
  expectedUnitsNext7: number;
  note: string | null;
};

type Driver = { type: string; detail: string };

type Forecast = {
  revenue: ForecastPoint;
  orders: ForecastPoint;
  itemDemand: ItemDemand[];
  peakWindows: { window: string; expectedSharePct: number }[];
  drivers: Driver[];
  confidenceLevel: string;
  basis: { daysOfHistory: number; trendPct: number | null };
  degraded: boolean;
};

function naira(n: number) {
  return `₦${Math.round(n).toLocaleString("en-NG")}`;
}

export default function ForecastCard({ role }: { role?: string }) {
  const canManage = role === "owner" || role === "manager";
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/admin/ai/forecast`);
        if (!active) return;
        if (res.ok) {
          const body = (await res.json()) as { forecast: Forecast | null };
          if (body.forecast || !canManage) {
            setForecast(body.forecast);
            setLoading(false);
            return;
          }
          // No cached forecast and we can manage → generate once (deterministic, cheap).
          const gen = await fetch(`/api/admin/ai/forecast`, { method: "POST" });
          if (active && gen.ok) {
            const g = (await gen.json()) as { forecast: Forecast };
            setForecast(g.forecast);
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
      const res = await fetch(`/api/admin/ai/forecast`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
      if (res.status === 429) {
        setError("Please wait a moment before refreshing again.");
        return;
      }
      if (!res.ok) {
        setError("Couldn't refresh the forecast.");
        return;
      }
      const body = (await res.json()) as { forecast: Forecast };
      setForecast(body.forecast);
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
          <span className="w-8 h-8 rounded-xl bg-purple-50 flex items-center justify-center">
            <TrendingUp className="w-4 h-4 text-purple-600" />
          </span>
          <div>
            <h2 className="text-sm font-black text-gray-900 leading-tight">7-Day Forecast</h2>
            {forecast && (
              <p className="text-[11px] text-gray-400 leading-tight">Confidence: {forecast.confidenceLevel}</p>
            )}
          </div>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={refresh}
            disabled={busy}
            className="inline-flex items-center gap-1 text-[11px] font-black text-purple-600 hover:text-purple-700 disabled:opacity-40 transition-colors"
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
      ) : !forecast ? (
        <p className="text-sm text-gray-500">Not enough history yet to forecast — check back after a few more days of sales.</p>
      ) : (
        <div className="space-y-4">
          {/* Headline projections */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-purple-50/50 border border-purple-100 p-3">
              <p className="text-[11px] font-bold text-purple-700/70 uppercase tracking-wide">Expected revenue</p>
              <p className="text-lg font-black text-gray-900 leading-tight mt-0.5">{naira(forecast.revenue.predicted)}</p>
              <p className="text-[11px] text-gray-400">{naira(forecast.revenue.low)} – {naira(forecast.revenue.high)}</p>
            </div>
            <div className="rounded-xl bg-purple-50/50 border border-purple-100 p-3">
              <p className="text-[11px] font-bold text-purple-700/70 uppercase tracking-wide">Expected orders</p>
              <p className="text-lg font-black text-gray-900 leading-tight mt-0.5">{Math.round(forecast.orders.predicted)}</p>
              <p className="text-[11px] text-gray-400">{Math.round(forecast.orders.low)} – {Math.round(forecast.orders.high)}</p>
            </div>
          </div>

          {/* Peak window */}
          {forecast.peakWindows.length > 0 && (
            <div className="flex items-center gap-2 text-xs text-gray-600">
              <Clock className="w-3.5 h-3.5 text-purple-500 flex-shrink-0" />
              Busiest window expected around <span className="font-black text-gray-900">{forecast.peakWindows[0].window}</span>
              <span className="text-gray-400">({Math.round(forecast.peakWindows[0].expectedSharePct)}% of orders)</span>
            </div>
          )}

          {/* Item demand — what to prep / buy */}
          {forecast.itemDemand.length > 0 && (
            <div>
              <p className="text-[11px] font-black text-gray-500 uppercase tracking-wide flex items-center gap-1.5 mb-1.5">
                <ShoppingBasket className="w-3.5 h-3.5" /> Expected demand (next 7 days)
              </p>
              <ul className="space-y-1">
                {forecast.itemDemand.slice(0, 5).map((it) => (
                  <li key={it.item} className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="text-gray-700 truncate">{it.item}</span>
                    <span className="font-black text-gray-900 whitespace-nowrap">
                      ~{it.expectedUnitsNext7} units
                      <span className="text-[11px] font-normal text-gray-400"> ({it.expectedUnitsPerDay}/day)</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Why — drivers */}
          {forecast.drivers.length > 0 && (
            <div className="rounded-xl bg-gray-50 border border-gray-100 p-3">
              <p className="text-[11px] font-black text-gray-500 uppercase tracking-wide flex items-center gap-1.5 mb-1.5">
                <Info className="w-3.5 h-3.5" /> Why
              </p>
              <ul className="space-y-1">
                {forecast.drivers.slice(0, 4).map((d, i) => (
                  <li key={i} className="text-xs text-gray-600 leading-snug">• {d.detail}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {error && <p className="text-xs text-red-500 font-bold mt-3">{error}</p>}
    </div>
  );
}
