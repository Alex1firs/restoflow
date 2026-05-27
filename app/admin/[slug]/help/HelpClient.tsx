"use client";

import { useState } from "react";
import { STEP_GUIDES } from "@/lib/setup-guides";

const GUIDE_ORDER = [
  "business",
  "branding",
  "hours",
  "menu",
  "payment",
  "preview",
  "readiness",
] as const;

export default function HelpClient({ slug }: { slug: string }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [isRequestingHelp, setIsRequestingHelp] = useState(false);
  const [helpSent, setHelpSent] = useState(false);
  const [helpAlreadyOpen, setHelpAlreadyOpen] = useState(false);

  async function requestHelp() {
    if (helpAlreadyOpen || helpSent || isRequestingHelp) return;
    setIsRequestingHelp(true);
    try {
      const res = await fetch("/api/admin/restaurants/assistance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.status === 409) { setHelpAlreadyOpen(true); return; }
      if (res.ok) setHelpSent(true);
    } finally {
      setIsRequestingHelp(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 pb-24 md:pb-8">

      {/* Back link */}
      <a
        href={`/admin/${slug}/setup`}
        className="inline-flex items-center gap-1.5 text-sm font-bold text-gray-500 hover:text-gray-800 transition-colors mb-8"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to Setup
      </a>

      <h1 className="text-2xl font-black text-gray-900 mb-1">Help Center</h1>
      <p className="text-sm text-gray-500 mb-8">
        Step-by-step guides to help you set up and launch your store.
      </p>

      {/* Guide accordion */}
      <div className="space-y-3 mb-8">
        {GUIDE_ORDER.map((key, i) => {
          const guide = STEP_GUIDES[key];
          const isOpen = openKey === key;

          return (
            <div key={key} className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
              <button
                type="button"
                onClick={() => setOpenKey(isOpen ? null : key)}
                className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="w-7 h-7 rounded-full bg-gray-100 text-gray-600 text-xs font-black flex items-center justify-center flex-shrink-0">
                    {i + 1}
                  </span>
                  <span className="text-sm font-black text-gray-900">{guide.title}</span>
                </div>
                <svg
                  className={`w-4 h-4 text-gray-400 transition-transform flex-shrink-0 ${isOpen ? "rotate-180" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {isOpen && (
                <div className="px-5 pb-5 border-t border-gray-100 space-y-4 pt-4">

                  {/* Video placeholder */}
                  {guide.videoUrl ? (
                    <div className="aspect-video w-full rounded-xl overflow-hidden bg-black">
                      <iframe
                        src={guide.videoUrl}
                        className="w-full h-full"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                      />
                    </div>
                  ) : (
                    <div className="flex items-center gap-2.5 bg-gray-50 border border-gray-100 rounded-xl px-4 py-3">
                      <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span className="text-xs text-gray-400 font-bold">Video guide coming soon</span>
                    </div>
                  )}

                  {/* What */}
                  <div>
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">
                      What this step covers
                    </p>
                    <p className="text-sm text-gray-600 leading-relaxed">{guide.what}</p>
                  </div>

                  {/* Why */}
                  <div>
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">
                      Why it matters
                    </p>
                    <p className="text-sm text-gray-600 leading-relaxed">{guide.why}</p>
                  </div>

                  {/* Prepare */}
                  <div>
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">
                      What to prepare
                    </p>
                    <ul className="space-y-2">
                      {guide.prepare.map((item, j) => (
                        <li key={j} className="flex items-start gap-2.5 text-sm text-gray-600">
                          <span className="w-1.5 h-1.5 rounded-full bg-gray-400 mt-2 flex-shrink-0" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Mistakes */}
                  <div>
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">
                      Common mistakes to avoid
                    </p>
                    <ul className="space-y-2">
                      {guide.mistakes.map((item, j) => (
                        <li key={j} className="flex items-start gap-2.5 text-sm text-gray-600">
                          <span className="text-orange-400 font-black text-xs flex-shrink-0 mt-0.5">!</span>
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Direct action */}
                  <a
                    href={`/admin/${slug}/setup?step=${i + 1}`}
                    className="inline-flex items-center gap-2 bg-gray-900 hover:bg-black text-white text-sm font-black px-4 py-2.5 rounded-xl transition-colors"
                  >
                    Go to Step {i + 1} in Setup Wizard
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </a>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Human support */}
      <div className="bg-orange-50 border border-orange-100 rounded-2xl p-6">
        <h2 className="text-base font-black text-gray-900 mb-1">Still need help?</h2>
        <p className="text-sm text-gray-600 mb-4 leading-relaxed">
          Our team can walk you through setting up your store over a call. Request assistance and we&apos;ll reach out.
        </p>
        {helpAlreadyOpen ? (
          <p className="text-xs text-blue-600 font-bold">
            Setup assistance has already been requested. Our team will reach out soon.
          </p>
        ) : helpSent ? (
          <p className="text-xs text-green-600 font-bold">Help request sent ✓</p>
        ) : (
          <button
            type="button"
            onClick={requestHelp}
            disabled={isRequestingHelp}
            className="bg-orange-600 hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-black px-5 py-2.5 rounded-xl transition-colors"
          >
            {isRequestingHelp ? "Sending…" : "Request Setup Help"}
          </button>
        )}
      </div>

    </div>
  );
}
