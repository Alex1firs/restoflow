"use client";

// Passive pre-checkout location notice (G4). Presentational only — reads the
// customer's selected state (carried from /discover) vs the restaurant's own
// state and shows a soft, dismissible banner. It does NOT touch cart, checkout,
// order, or payment logic; nothing here blocks or intercepts ordering.

import { useState } from "react";
import { classifyLocation } from "@/lib/location-match";

export default function LocationNotice({
  customerState,
  restaurantState,
}: {
  customerState: string | null;
  restaurantState: string | null;
}) {
  const [dismissed, setDismissed] = useState(false);
  const notice = classifyLocation({ customerState, restaurantState });

  if (!notice.show || dismissed) return null;

  return (
    <div className="mx-auto max-w-5xl px-4 mt-4" role="status" aria-live="polite">
      <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
        <svg className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v3.5m0 3.5h.01M10.3 4.3 2.6 18a1.9 1.9 0 0 0 1.7 2.9h15.4a1.9 1.9 0 0 0 1.7-2.9L13.7 4.3a1.9 1.9 0 0 0-3.4 0Z" />
        </svg>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-amber-900">{notice.title}</p>
          <p className="mt-0.5 text-xs font-medium leading-relaxed text-amber-800">{notice.body}</p>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss location notice"
          className="shrink-0 rounded-full px-1.5 text-lg leading-none text-amber-500 hover:text-amber-700"
        >
          ×
        </button>
      </div>
    </div>
  );
}
