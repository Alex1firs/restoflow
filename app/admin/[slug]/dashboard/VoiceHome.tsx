"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import VoiceAssistant, { type VoiceGreetingProp, type VoiceSignalProp } from "../assistant/VoiceAssistant";

/**
 * Voice-First Home — the primary entry point on the dashboard.
 *
 * When the owner opens the app, the assistant greets them and surfaces proactive
 * signals; the full dashboard remains available below (this component is collapsible).
 * It reuses the existing voice endpoints — greeting + signals + the voice turn API —
 * and adds no business logic.
 */
export default function VoiceHome() {
  const [greeting, setGreeting] = useState<VoiceGreetingProp | null>(null);
  const [signals, setSignals] = useState<VoiceSignalProp[]>([]);
  const [open, setOpen] = useState(true);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [gRes, sRes] = await Promise.all([
          fetch(`/api/admin/ai/voice/greeting`),
          fetch(`/api/admin/ai/voice/signals`),
        ]);
        if (!active) return;
        if (gRes.ok) {
          const b = (await gRes.json()) as { greeting: { display: string; speech: string; pending: VoiceGreetingProp["pending"] } };
          setGreeting({ display: b.greeting.display, speech: b.greeting.speech, pending: b.greeting.pending });
        }
        if (sRes.ok) {
          const b = (await sRes.json()) as { signals: VoiceSignalProp[] };
          setSignals(b.signals);
        }
      } catch {
        /* voice-first is additive — dashboard still works if this fails */
      } finally {
        if (active) setReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="mb-6 rounded-2xl border border-orange-100 bg-gradient-to-b from-orange-50/60 to-white overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 px-5 py-3"
      >
        <span className="inline-flex items-center gap-2 text-sm font-black text-gray-900">
          <span className="w-7 h-7 rounded-xl bg-orange-100 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-orange-600" />
          </span>
          Talk to your manager
          {signals.length > 0 && (
            <span className="ml-1 text-[10px] font-black text-white bg-orange-600 rounded-full px-1.5 py-0.5">{signals.length}</span>
          )}
        </span>
        {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>

      {open && ready && (
        <div className="px-1 pb-1">
          <VoiceAssistant greeting={greeting} signals={signals} showHeader={false} />
        </div>
      )}
    </div>
  );
}
