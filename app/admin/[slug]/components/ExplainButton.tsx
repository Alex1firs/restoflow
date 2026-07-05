"use client";

import { useState } from "react";
import { Sparkles, X } from "lucide-react";

/**
 * Reusable "Explain" action for any dashboard widget.
 *
 * Drop onto any card:
 *   <ExplainButton widget="revenue" data={revenueSnapshot} />
 *
 * It POSTs to /api/admin/ai/explain, which re-fetches the widget's authoritative
 * data via the tool layer and returns a plain-language explanation. `data` is only
 * a display snapshot the server reconciles against — never the source of truth.
 */

type Props = {
  /** Must match a key in the server WIDGET_REGISTRY (e.g. "revenue", "kitchen"). */
  widget: string;
  /** Optional: the value currently shown on the card, for reconciliation. */
  data?: unknown;
  /** Optional: time window hint ("today" | "yesterday" | "week" | "month"). */
  range?: string;
  /** Optional label override. */
  label?: string;
  className?: string;
};

type State = "idle" | "loading" | "done" | "error";

export default function ExplainButton({ widget, data, range, label = "Explain", className = "" }: Props) {
  const [state, setState] = useState<State>("idle");
  const [explanation, setExplanation] = useState("");
  const [open, setOpen] = useState(false);

  async function explain() {
    setOpen(true);
    setState("loading");
    try {
      const res = await fetch(`/api/admin/ai/explain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ widget, range, clientData: data }),
      });
      if (!res.ok) {
        setState("error");
        return;
      }
      const body = (await res.json()) as { explanation?: string };
      setExplanation(body.explanation ?? "");
      setState("done");
    } catch {
      setState("error");
    }
  }

  return (
    <div className={`relative inline-block ${className}`}>
      <button
        type="button"
        onClick={explain}
        className="inline-flex items-center gap-1 text-[11px] font-black text-orange-600 hover:text-orange-700 transition-colors"
      >
        <Sparkles className="w-3 h-3" />
        {label}
      </button>

      {open && (
        <div className="absolute z-20 right-0 mt-2 w-72 bg-white border border-orange-100 rounded-xl shadow-lg p-3">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[11px] font-black text-orange-500 uppercase tracking-widest">Explanation</p>
            <button type="button" onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          {state === "loading" && (
            <div className="flex items-center gap-2 mt-2">
              <span className="w-3.5 h-3.5 rounded-full border-2 border-orange-400 border-t-transparent animate-spin" />
              <span className="text-xs text-gray-400 font-bold">Analysing…</span>
            </div>
          )}
          {state === "error" && (
            <p className="text-xs text-red-500 font-bold mt-2">
              Couldn&apos;t explain this right now.{" "}
              <button type="button" onClick={explain} className="underline">
                Retry
              </button>
            </p>
          )}
          {state === "done" && <p className="text-sm text-gray-700 leading-relaxed mt-2">{explanation}</p>}
        </div>
      )}
    </div>
  );
}
