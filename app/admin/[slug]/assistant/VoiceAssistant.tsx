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

// Conversation Mode tuning + spoken end-phrases (module scope → stable identities).
const SILENCE_MS = 45_000; // end the session after this much continuous silence
const RESTART_MS = 300; // brief gap before reopening the mic between turns
const END_RE = /^(stop( listening| the conversation)?|end (the )?conversation|goodbye|bye|that'?s all|that is all|we'?re done|i'?m done|cancel|never ?mind|exit|quit)\b/i;

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
  // Conversation Mode: one tap starts a hands-free session that auto-reopens the mic
  // after each answer until the owner ends it (tap, "stop listening", or silence).
  const [sessionActive, setSessionActive] = useState(false);
  const idRef = useRef(0);
  const mutedRef = useRef(false);
  const pendingRef = useRef<PendingAction | null>(null);
  const messagesRef = useRef<Msg[]>([]);
  const sessionRef = useRef(false);           // mirror of sessionActive for async callbacks
  const busyRef = useRef(false);              // true while an utterance is being processed/spoken
  const lastSpeechAtRef = useRef(0);          // for the silence timeout
  const restartTimerRef = useRef<number | null>(null);
  const onFinalRef = useRef<(t: string) => void>(() => {});
  const endSessionRef = useRef<(reason?: string) => void>(() => {});
  const turnRef = useRef(0); // bumped on interrupt/end so a stale TTS onEnd can't reopen the mic

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

  useEffect(() => { sessionRef.current = sessionActive; }, [sessionActive]);

  /** One-shot speech (no mic reopen) — for the greeting button and session end note. */
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

  /** Open the mic. In a session, keeps listening across turns until silence/end. */
  const beginListening = useCallback(() => {
    const p = providers.current;
    if (!p) return;
    p.tts.cancel();
    setSpeaking(false);
    setError("");
    busyRef.current = false;
    setListening(true);
    p.stt.start({
      onResult: (t, isFinal) => {
        if (isFinal) { setListening(false); onFinalRef.current(t); }
        else setInterim(t);
      },
      onError: (m) => {
        setListening(false);
        setInterim("");
        if (/not-allowed|service-not-allowed|audio-capture/i.test(m)) {
          setError("I need microphone access to listen.");
          endSessionRef.current("error");
        }
        // no-speech / aborted are normal — onEnd decides whether to keep listening.
      },
      onEnd: () => {
        setListening(false);
        if (!sessionRef.current || busyRef.current) return; // a turn is being processed
        if (Date.now() - lastSpeechAtRef.current > SILENCE_MS) { endSessionRef.current("silence"); return; }
        // Hands-free: reopen the mic so the owner never taps between turns.
        restartTimerRef.current = window.setTimeout(() => {
          if (sessionRef.current && !busyRef.current) beginListening();
        }, RESTART_MS);
      },
    });
  }, []);

  /** Speak the answer, then (in a session) automatically reopen the mic. */
  const respondWith = useCallback((speechText: string | null) => {
    const p = providers.current;
    const myTurn = ++turnRef.current;
    lastSpeechAtRef.current = Date.now();
    const resume = () => {
      if (myTurn !== turnRef.current) return; // an interrupt/end superseded this turn
      busyRef.current = false;
      if (sessionRef.current) beginListening();
    };
    if (speechText && !mutedRef.current && p) {
      setSpeaking(true);
      p.tts.speak(speechText, { onStart: () => setSpeaking(true), onEnd: () => { setSpeaking(false); resume(); } });
    } else {
      resume();
    }
  }, [beginListening]);

  const send = useCallback(
    async (transcript: string) => {
      const text = transcript.trim();
      if (!text) return;
      addMsg("user", text);
      setInterim("");
      setThinking(true);
      setError("");
      busyRef.current = true;
      let speechText: string | null = null;
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
        speechText = clean(body.speech);
        // Command layer: a navigation command drives the app for the owner.
        if (body.navigation?.path) {
          const href = body.navigation.anchor ? `${body.navigation.path}#${body.navigation.anchor}` : body.navigation.path;
          router.push(href);
        }
      } catch {
        setError("Network error.");
      } finally {
        setThinking(false);
        respondWith(speechText); // speak + reopen mic (or just reopen if muted/errored)
      }
    },
    [addMsg, buildTurns, router, respondWith]
  );

  useEffect(() => {
    onFinalRef.current = (t: string) => {
      const text = t.trim();
      if (!text) { if (sessionRef.current) beginListening(); return; }
      lastSpeechAtRef.current = Date.now();
      if (sessionRef.current && END_RE.test(text)) { endSessionRef.current("goodbye"); return; }
      busyRef.current = true; // claim the turn before the recognizer's onEnd fires
      void send(text);
    };
  }, [send, beginListening]);

  const endSession = useCallback((reason?: string) => {
    sessionRef.current = false;
    setSessionActive(false);
    turnRef.current++; // invalidate any in-flight TTS onEnd resume
    busyRef.current = false;
    if (restartTimerRef.current) { clearTimeout(restartTimerRef.current); restartTimerRef.current = null; }
    providers.current?.stt.stop();
    providers.current?.tts.cancel();
    setListening(false);
    setSpeaking(false);
    setInterim("");
    if (reason === "goodbye") speak("Okay, ending our conversation.");
    else if (reason === "silence") speak("I'll pause here — tap when you'd like to continue.");
  }, [speak]);
  useEffect(() => { endSessionRef.current = endSession; }, [endSession]);

  const startSession = useCallback(() => {
    sessionRef.current = true;
    setSessionActive(true);
    lastSpeechAtRef.current = Date.now();
    setError("");
    beginListening();
  }, [beginListening]);

  /** Barge-in: cut the manager off mid-sentence and start listening immediately. */
  const interrupt = useCallback(() => {
    turnRef.current++; // the cancelled utterance's onEnd must NOT reopen the mic
    providers.current?.tts.cancel();
    setSpeaking(false);
    busyRef.current = false;
    lastSpeechAtRef.current = Date.now();
    if (sessionRef.current) beginListening();
  }, [beginListening]);

  const toggleMute = useCallback(() => { setMuted((m) => { if (!m) providers.current?.tts.cancel(); return !m; }); }, []);
  const confirm = useCallback((answer: "yes" | "no") => void send(answer), [send]);

  // Tidy up STT/TTS and timers when the component unmounts.
  useEffect(() => {
    const p = providers.current;
    return () => {
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      sessionRef.current = false;
      p?.stt.stop();
      p?.tts.cancel();
    };
  }, []);

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

      {/* Suggested next questions — only when idle (a session is hands-free) */}
      {!sessionActive && !thinking && (
        <div className="flex flex-wrap gap-2 mb-3">
          {SUGGESTIONS.map((s) => (
            <button key={s.label} type="button" onClick={() => send(s.prompt)} className="inline-flex items-center gap-1.5 text-[11px] font-bold text-gray-700 bg-white border border-gray-200 hover:border-orange-300 hover:text-orange-700 rounded-full px-3 py-1.5 transition-colors">
              <span>{s.emoji}</span> {s.label}
            </button>
          ))}
        </div>
      )}

      {error && <p className="text-xs text-red-500 font-bold mb-2 text-center">{error}</p>}

      {/* Conversation-mode control: one tap starts a hands-free session */}
      <div className="flex flex-col items-center gap-2 pt-1">
        {sessionActive && (
          <div className="inline-flex items-center gap-1.5 text-[11px] font-black text-green-700 bg-green-50 border border-green-200 rounded-full px-3 py-1 mb-1">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" /> Conversation active
          </div>
        )}

        <div className="relative flex items-center justify-center">
          {listening && (
            <>
              <span className="absolute w-16 h-16 rounded-full bg-green-400/30 animate-ping" />
              <span className="absolute w-20 h-20 rounded-full bg-green-400/20 animate-ping" style={{ animationDelay: "0.3s" }} />
            </>
          )}
          <button
            type="button"
            onClick={!sessionActive ? startSession : speaking ? interrupt : () => endSession()}
            className={`relative w-16 h-16 rounded-full flex items-center justify-center shadow-lg transition-all ${
              listening ? "bg-green-500 scale-105" : speaking ? "bg-orange-400" : sessionActive ? "bg-gray-800 hover:bg-gray-900" : "bg-orange-600 hover:bg-orange-700"
            }`}
            aria-label={!sessionActive ? "Start conversation" : speaking ? "Interrupt" : "End conversation"}
          >
            {!sessionActive ? (
              <Mic className="w-7 h-7 text-white" />
            ) : speaking ? (
              // Waveform while the manager speaks — tap to interrupt.
              <span className="flex items-end gap-0.5 h-6">
                {[0, 1, 2, 3].map((i) => (
                  <span key={i} className="w-1 bg-white rounded-full animate-pulse" style={{ height: `${[10, 20, 14, 22][i]}px`, animationDelay: `${i * 0.12}s` }} />
                ))}
              </span>
            ) : (
              <Square className="w-6 h-6 text-white" />
            )}
          </button>
        </div>

        <span className="text-[11px] font-bold text-gray-500 inline-flex items-center gap-1 text-center">
          {!sessionActive ? (
            "🎤 Tap to start a conversation"
          ) : thinking ? (
            <><Loader2 className="w-3 h-3 animate-spin" /> Thinking…</>
          ) : speaking ? (
            <><Sparkles className="w-3 h-3" /> Restaurant Manager speaking… · tap to interrupt</>
          ) : listening ? (
            "🟢 Operations Manager is listening…"
          ) : (
            "One moment…"
          )}
        </span>
        {!sessionActive && (
          <span className="text-[10px] text-gray-400">Ask anything about your restaurant — I&apos;ll keep listening.</span>
        )}
        {sessionActive && !speaking && !thinking && (
          <span className="text-[10px] text-gray-400">Say “stop listening” or tap to end.</span>
        )}
      </div>
    </div>
  );
}
