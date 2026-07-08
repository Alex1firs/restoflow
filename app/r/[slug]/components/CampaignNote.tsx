"use client";

// Lightweight, dismissible promo/consent note (Slice 3). Presentational only —
// shown when the customer arrived via an active campaign link (?camp=). It does
// NOT tag orders or touch cart/checkout/payment; order tagging is Slice 4.

import { useState } from "react";

export default function CampaignNote({
  name,
  prize,
  threshold,
}: {
  name: string;
  prize: string;
  threshold: number;
}) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div className="mx-auto max-w-5xl px-4 mt-4">
      <div className="flex items-start gap-3 rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3">
        <span className="mt-0.5 text-lg leading-none" aria-hidden>🎁</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-orange-900">
            {name} — order {threshold}× to qualify{prize ? ` for ${prize}` : ""}.
          </p>
          <p className="mt-0.5 text-xs font-medium leading-relaxed text-orange-800/90">
            Ordering may enter you into this promotion. Terms apply; winners are selected and contacted by RestoFlow.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss promotion notice"
          className="shrink-0 rounded-full px-1.5 text-lg leading-none text-orange-500 hover:text-orange-700"
        >
          ×
        </button>
      </div>
    </div>
  );
}
