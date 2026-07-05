"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Mic, Square, Volume2, VolumeX, Check, X, Loader2, Play, Bell, Bot, Sparkles } from "lucide-react";
import { createSpeechProviders, type SpeechToTextProvider, type TextToSpeechProvider } from "./speech";

/**
 * Your AI Operations Manager — the voice client.
 *
 * Proactive by default: on open it greets the owner, reads the day's brief on tap, and
 * surfaces suggested next questions. One tap to talk; the device does STT/TTS via the
 * SpeechProvider abstraction and the transcript flows through the whole AI stack.
 * Actions are approval-first — the manager proposes, then waits for a "yes".
 */

type PendingAction = { type: "execute_recommendation" | "execute_purchasing" | "read_recommendations"; recId?: string; items?: string[]; label: string };
type Navigation = { target: string; path: string; label: string; anchor?: string } | null;
type VoiceResult = { intent: string; speech: string; display: string; pending: PendingAction | null; executed: boolean; degraded: boolean; navigation?: Navigation };
type Msg = { id: number; role: "user" | "assistant"; text: string };
type Turn = { question: string; answer: string };

export type VoiceGreetingProp = { display: string; speech: string; pending: PendingAction | null };
export type VoiceSignalProp = { id: string; message: string; followup: string; severity: string };

/** Suggested next questions — removes the burden of inventing what to ask. */
const SUGGESTIONS: { emoji: string; label: string; prompt: string }[] = [
  { emoji: "📈", label: "This week's revenue", prompt: "What's my revenue this week?" },
  { emoji: "🍛", label: "Best-selling items", prompt: "What are my best-selling items?" },
  { emoji: "💰", label: "My recommendations", prompt: "Read the recommendations" },
  { emoji: "📦", label: "Inventory status", prompt: "What's my inventory status?" },
  { emoji: "👥", label: "Staff performance", prompt: "How is staff performance?" },
];

/** Strip any residual internal-state note from older cached answers. */
function clean(text: string): string {
  return text.replace(/\s*\((?:AI narration[^)]*)\)\s*/gi, " ").replace(/\s{2,}/g, " ").trim();
}

export default function VoiceAssistant({
  greeting = null,
  signals = [],
  autoGreet = true,
  showHeader = true,
}: {
  greeting?: VoiceGreetingProp | null;
  signals?: VoiceSignalProp[];
  autoGreet?: boolean;
  showHeader?: boolean;
} = {}) {
  const router = useRouter();
  const providers = useRef<{ stt: SpeechToTextProvider; tts: TextToSpeechProvider } | null>(null);
  const [greet, setGreet] = useState<VoiceGreetingProp | null>(greeting);
  const [sigs, setSigs] = useState<VoiceSignalProp[]>(signals);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [interim, setInterim] = useState("");
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [muted, setMuted] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(greeting?.pending ?? null);
  const [error, setError] = useState("");
  const [supported, setSupported] = useState(true);
  const idRef = useRef(0);
  const mutedRef = useRef(false);
  const pendingRef = useRef<PendingAction | null>(null);
  const messagesRef = useRef<Msg[]>([]);

  useEffect(() => {
    providers.current = createSpeechProviders();
    setSupported(providers.current.stt.isSupported());
  }, []);
  useEffect(() => { mutedRef.current = muted; }, [muted]);
  useEffect(() => { pendingRef.current = pending; }, [pending]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // Proactive: fetch the greeting + signals ourselves when not supplied by a parent.
  useEffect(() => {
    if (greeting || !autoGreet) return;
    let active = true;
    (async () => {
      try {
        const [g, s] = await Promise.all([fetch(`/api/admin/ai/voice/greeting`), fetch(`/api/admin/ai/voice/signals`)]);
        if (!active) return;
        if (g.ok) {
          const b = (await g.json()) as { greeting: VoiceGreetingProp };
          setGreet(b.greeting);
          setPending(b.greeting.pending);
        }
        if (s.ok) setSigs(((await s.json()) as { signals: VoiceSignalProp[] }).signals);
      } catch {
        /* greeting is best-effort */
      }
    })();
    return () => { active = false; };
  }, [greeting, autoGreet]);

  const speak = useCallback((text: string) => {
    if (mutedRef.current || !providers.current) return;
    providers.current.tts.speak(text, { onStart: () => setSpeaking(true), onEnd: () => setSpeaking(false) });
  }, []);

  const addMsg = useCallback((role: Msg["role"], text: string) => {
    setMessages((m) => [...m, { id: ++idRef.current, role, text }]);
  }, []);

  const buildTurns = useCallback((): Turn[] => {
    const turns: Turn[] = [];
    const msgs = messagesRef.current;
    for (let i = 0; i < msgs.length - 1; i++) {
      if (msgs[i].role === "user" && msgs[i + 1]?.role === "assistant") turns.push({ question: msgs[i].text, answer: msgs[i + 1].text });
    }
    return turns.slice(-6);
  }, []);

  const send = useCallback(
    async (transcript: string) => {
      const text = transcript.trim();
      if (!text) return;
      addMsg("user", text);
      setInterim("");
      setThinking(true);
      setError("");
      try {
        const res = await fetch(`/api/admin/ai/voice`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcript: text, history: buildTurns(), pending: pendingRef.current }),
        });
        if (res.status === 429) { setError("One moment — too many requests."); return; }
        if (!res.ok) { setError("I couldn't process that. Please try again."); return; }
        const body = (await res.json()) as VoiceResult;
        addMsg("assistant", clean(body.display));
        setPending(body.pending);
        speak(clean(body.speech));
        // Command layer: a navigation command drives the app for the owner.
        if (body.navigation?.path) {
          const href = body.navigation.anchor ? `${body.navigation.path}#${body.navigation.anchor}` : body.navigation.path;
          router.push(href);
        }
      } catch {
        setError("Network error.");
      } finally {
        setThinking(false);
      }
    },
    [addMsg, buildTurns, speak, router]
  );

  const startListening = useCallback(() => {
    if (!providers.current) return;
    providers.current.tts.cancel();
    setSpeaking(false);
    setError("");
    setListening(true);
    providers.current.stt.start({
      onResult: (t, isFinal) => { if (isFinal) { setListening(false); void send(t); } else setInterim(t); },
      onError: (m) => { setListening(false); setInterim(""); if (!/no-speech|aborted/i.test(m)) setError(m); },
      onEnd: () => setListening(false),
    });
  }, [send]);

  const stopListening = useCallback(() => { providers.current?.stt.stop(); setListening(false); }, []);
  const toggleMute = useCallback(() => { setMuted((m) => { if (!m) providers.current?.tts.cancel(); return !m; }); }, []);
  const confirm = useCallback((answer: "yes" | "no") => void send(answer), [send]);

  if (!supported) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-10 text-center">
        <p className="text-sm text-gray-500">Voice isn&apos;t supported in this browser. Try Chrome or Safari, or use the text assistant.</p>
      </div>
    );
  }

  const greetingLines = greet ? clean(greet.display).split(/(?<=[.!?])\s+/).filter(Boolean) : [];
  const started = messages.length > 0;

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 flex flex-col min-h-[70vh]">
      {/* Header */}
      <div className={`flex items-center ${showHeader ? "justify-between" : "justify-end"} mb-4`}>
        {showHeader && (
          <div className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-2xl bg-orange-100 flex items-center justify-center">
              <Bot className="w-5 h-5 text-orange-600" />
            </span>
            <div>
              <h1 className="text-base font-black text-gray-900 leading-tight">Operations Manager</h1>
              <p className="text-[11px] text-gray-500">Already up to speed on your restaurant.</p>
            </div>
          </div>
        )}
        <button type="button" onClick={toggleMute} className={`w-9 h-9 rounded-xl flex items-center justify-center ${muted ? "bg-gray-100 text-gray-400" : "bg-orange-50 text-orange-600"}`} aria-label={muted ? "Unmute" : "Mute"}>
          {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
        </button>
      </div>

      {/* Greeting hero — the manager speaks first */}
      {greet && !started && (
        <div className="mb-4 rounded-2xl border border-orange-100 bg-gradient-to-b from-orange-50/70 to-white p-4">
          <div className="space-y-1">
            {greetingLines.map((line, i) => (
              <p key={i} className={i === 0 ? "text-base font-black text-gray-900" : "text-sm text-gray-700 leading-snug"}>{line}</p>
            ))}
          </div>
          <button type="button" onClick={() => speak(greet.speech)} disabled={speaking} className="mt-3 inline-flex items-center gap-1.5 text-xs font-black text-white bg-orange-600 hover:bg-orange-700 disabled:opacity-50 px-3 py-2 rounded-xl">
            <Play className="w-3.5 h-3.5" /> Hear today&apos;s briefing
          </button>
        </div>
      )}

      {/* Proactive signals */}
      {sigs.length > 0 && !started && (
        <div className="flex flex-col gap-2 mb-4">
          {sigs.slice(0, 3).map((s) => (
            <button key={s.id} type="button" onClick={() => send(s.followup)} className={`flex items-center gap-2 text-left text-xs font-bold rounded-xl px-3 py-2.5 border transition-colors ${s.severity === "high" || s.severity === "critical" ? "border-red-200 bg-red-50/60 text-red-800 hover:bg-red-50" : "border-indigo-100 bg-indigo-50/50 text-indigo-800 hover:bg-indigo-50"}`}>
              <Bell className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="min-w-0">{s.message}</span>
            </button>
          ))}
        </div>
      )}

      {/* Conversation */}
      <div className="flex-1 space-y-4 overflow-y-auto mb-4">
        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-md px-3.5 py-2.5 text-sm bg-orange-600 text-white">{m.text}</div>
            </div>
          ) : (
            <div key={m.id} className="flex flex-col items-start">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-black text-gray-500 mb-1 ml-1">
                <span className="w-5 h-5 rounded-lg bg-orange-100 flex items-center justify-center"><Bot className="w-3 h-3 text-orange-600" /></span>
                Restaurant Manager
              </span>
              <div className="max-w-[90%] rounded-2xl rounded-tl-md px-3.5 py-3 text-sm bg-white border border-gray-100 shadow-sm text-gray-800 leading-relaxed">{m.text}</div>
            </div>
          )
        )}
        {interim && (
          <div className="flex justify-end">
            <div className="max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm bg-orange-100 text-orange-900 italic">{interim}…</div>
          </div>
        )}
        {thinking && (
          <div className="flex items-center gap-1.5 ml-1">
            <span className="w-5 h-5 rounded-lg bg-orange-100 flex items-center justify-center"><Bot className="w-3 h-3 text-orange-600" /></span>
            <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
          </div>
        )}
      </div>

      {/* Pending confirmation */}
      {pending && (
        <div className="mb-3 rounded-xl border border-indigo-100 bg-indigo-50/50 p-3">
          <p className="text-xs text-gray-700 mb-2">Confirm: <span className="font-black">{pending.label}</span></p>
          <div className="flex gap-2">
            <button type="button" onClick={() => confirm("yes")} className="inline-flex items-center gap-1 text-xs font-black text-white bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 rounded-lg"><Check className="w-3.5 h-3.5" /> Yes</button>
            <button type="button" onClick={() => confirm("no")} className="inline-flex items-center gap-1 text-xs font-black text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-lg"><X className="w-3.5 h-3.5" /> No</button>
          </div>
        </div>
      )}

      {/* Suggested next questions */}
      {!thinking && !listening && (
        <div className="flex flex-wrap gap-2 mb-3">
          {SUGGESTIONS.map((s) => (
            <button key={s.label} type="button" onClick={() => send(s.prompt)} className="inline-flex items-center gap-1.5 text-[11px] font-bold text-gray-700 bg-white border border-gray-200 hover:border-orange-300 hover:text-orange-700 rounded-full px-3 py-1.5 transition-colors">
              <span>{s.emoji}</span> {s.label}
            </button>
          ))}
        </div>
      )}

      {error && <p className="text-xs text-red-500 font-bold mb-2 text-center">{error}</p>}

      {/* Mic with a live listening state */}
      <div className="flex flex-col items-center gap-2 pt-1">
        <div className="relative flex items-center justify-center">
          {listening && (
            <>
              <span className="absolute w-16 h-16 rounded-full bg-red-400/30 animate-ping" />
              <span className="absolute w-20 h-20 rounded-full bg-red-400/20 animate-ping" style={{ animationDelay: "0.3s" }} />
            </>
          )}
          <button
            type="button"
            onClick={listening ? stopListening : startListening}
            disabled={thinking}
            className={`relative w-16 h-16 rounded-full flex items-center justify-center shadow-lg transition-all disabled:opacity-40 ${listening ? "bg-red-500 scale-105" : speaking ? "bg-orange-400" : "bg-orange-600 hover:bg-orange-700"}`}
            aria-label={listening ? "Stop" : "Start talking"}
          >
            {listening ? <Square className="w-6 h-6 text-white" /> : <Mic className="w-7 h-7 text-white" />}
          </button>
        </div>
        <span className="text-[11px] text-gray-400 inline-flex items-center gap-1">
          {listening ? "Listening…" : speaking ? <><Sparkles className="w-3 h-3" /> Speaking…</> : "Tap to talk"}
        </span>
      </div>
    </div>
  );
}
