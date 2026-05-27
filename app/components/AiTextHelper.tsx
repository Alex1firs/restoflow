"use client";

import { useState } from "react";

type State = "idle" | "loading" | "done" | "error";

type Props = {
  triggerLabel: string;
  endpoint: string;
  payload: () => Record<string, unknown>;
  onAccept: (text: string) => void;
};

export default function AiTextHelper({ triggerLabel, endpoint, payload, onAccept }: Props) {
  const [state, setState] = useState<State>("idle");
  const [draft, setDraft] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [hidden, setHidden] = useState(false);

  if (hidden) return null;

  async function generate() {
    setState("loading");
    setErrorMsg("");
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload()),
      });
      if (res.status === 503) { setHidden(true); return; }
      if (!res.ok) {
        setState("error");
        setErrorMsg("Generation failed. Try again.");
        return;
      }
      const data = await res.json() as { suggestion?: string };
      setDraft(data.suggestion ?? "");
      setState("done");
    } catch {
      setState("error");
      setErrorMsg("Network error. Try again.");
    }
  }

  if (state === "idle") {
    return (
      <button
        type="button"
        onClick={generate}
        className="inline-flex items-center gap-1.5 text-xs font-black text-orange-600 hover:text-orange-700 transition-colors mt-1.5"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
        {triggerLabel}
      </button>
    );
  }

  if (state === "loading") {
    return (
      <div className="flex items-center gap-2 mt-1.5">
        <div className="w-3.5 h-3.5 rounded-full border-2 border-orange-400 border-t-transparent animate-spin flex-shrink-0" />
        <span className="text-xs text-gray-400 font-bold">Generating…</span>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="mt-2 flex items-center gap-2">
        <span className="text-xs text-red-500 font-bold">{errorMsg}</span>
        <button
          type="button"
          onClick={() => setState("idle")}
          className="text-xs font-black text-gray-500 hover:text-gray-700 transition-colors"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2 bg-orange-50 border border-orange-100 rounded-xl p-3 space-y-2">
      <p className="text-[11px] font-black text-orange-500 uppercase tracking-widest">AI Suggestion</p>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={2}
        className="w-full text-sm text-gray-700 bg-white border border-orange-100 rounded-lg p-2 resize-none focus:outline-none focus:ring-2 focus:ring-orange-300"
      />
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => { onAccept(draft); setState("idle"); setDraft(""); }}
          className="text-xs font-black text-white bg-orange-600 hover:bg-orange-700 px-3 py-1.5 rounded-lg transition-colors"
        >
          Use this suggestion
        </button>
        <button
          type="button"
          onClick={generate}
          className="text-xs font-black text-gray-600 hover:text-gray-800 transition-colors"
        >
          Try again
        </button>
        <button
          type="button"
          onClick={() => setState("idle")}
          className="text-xs font-black text-gray-400 hover:text-gray-600 transition-colors"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
