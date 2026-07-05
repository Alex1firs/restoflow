"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Square, Volume2, VolumeX, Sunrise, Check, X, Loader2 } from "lucide-react";
import { createSpeechProviders, type SpeechToTextProvider, type TextToSpeechProvider } from "./speech";

/**
 * Voice AI Restaurant Manager — the voice client.
 *
 * One tap to talk. The device does STT/TTS via the SpeechProvider abstraction; the
 * transcript is sent to /api/admin/ai/voice which reuses the whole AI stack and
 * returns text to speak. Actions are approval-first: the assistant proposes, then
 * waits for a spoken (or tapped) "yes".
 */

type PendingAction = { type: "execute_recommendation" | "execute_purchasing"; recId?: string; items?: string[]; label: string };
type VoiceResult = { intent: string; speech: string; display: string; pending: PendingAction | null; executed: boolean; degraded: boolean };
type Msg = { id: number; role: "user" | "assistant"; text: string };
type Turn = { question: string; answer: string };

export default function VoiceAssistant() {
  const providers = useRef<{ stt: SpeechToTextProvider; tts: TextToSpeechProvider } | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [interim, setInterim] = useState("");
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [muted, setMuted] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
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
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

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
      if (msgs[i].role === "user" && msgs[i + 1]?.role === "assistant") {
        turns.push({ question: msgs[i].text, answer: msgs[i + 1].text });
      }
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
        if (res.status === 429) {
          setError("One moment — too many requests.");
          return;
        }
        if (!res.ok) {
          setError("I couldn't process that. Please try again.");
          return;
        }
        const body = (await res.json()) as VoiceResult;
        addMsg("assistant", body.display);
        setPending(body.pending);
        speak(body.speech);
      } catch {
        setError("Network error.");
      } finally {
        setThinking(false);
      }
    },
    [addMsg, buildTurns, speak]
  );

  const startListening = useCallback(() => {
    if (!providers.current) return;
    providers.current.tts.cancel();
    setSpeaking(false);
    setError("");
    setListening(true);
    providers.current.stt.start({
      onResult: (t, isFinal) => {
        if (isFinal) {
          setListening(false);
          void send(t);
        } else {
          setInterim(t);
        }
      },
      onError: (m) => {
        setListening(false);
        setInterim("");
        if (!/no-speech|aborted/i.test(m)) setError(m);
      },
      onEnd: () => setListening(false),
    });
  }, [send]);

  const stopListening = useCallback(() => {
    providers.current?.stt.stop();
    setListening(false);
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      if (!m) providers.current?.tts.cancel();
      return !m;
    });
  }, []);

  const confirm = useCallback((answer: "yes" | "no") => void send(answer), [send]);

  if (!supported) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-10 text-center">
        <p className="text-sm text-gray-500">
          Voice isn&apos;t supported in this browser. Try Chrome or Safari, or use the text assistant.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 flex flex-col min-h-[70vh]">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-lg font-black text-gray-900">Voice Manager</h1>
          <p className="text-xs text-gray-500">Tap the mic and ask. Say “how are we doing today?”</p>
        </div>
        <button
          type="button"
          onClick={toggleMute}
          className={`w-9 h-9 rounded-xl flex items-center justify-center ${muted ? "bg-gray-100 text-gray-400" : "bg-orange-50 text-orange-600"}`}
          aria-label={muted ? "Unmute" : "Mute"}
        >
          {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
        </button>
      </div>

      {/* Conversation */}
      <div className="flex-1 space-y-3 overflow-y-auto mb-4">
        {messages.length === 0 && !interim && (
          <button
            type="button"
            onClick={() => send("How are we doing today?")}
            className="w-full rounded-2xl border border-orange-100 bg-orange-50/40 p-4 text-left hover:bg-orange-50 transition-colors"
          >
            <span className="inline-flex items-center gap-2 text-sm font-black text-orange-700">
              <Sunrise className="w-4 h-4" /> Tap to hear your morning brief
            </span>
            <p className="text-xs text-gray-500 mt-1">Or press the mic and ask anything about your restaurant.</p>
          </button>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm ${m.role === "user" ? "bg-orange-600 text-white" : "bg-white border border-gray-100 text-gray-800"}`}>
              {m.text}
            </div>
          </div>
        ))}
        {interim && (
          <div className="flex justify-end">
            <div className="max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm bg-orange-100 text-orange-900 italic">{interim}…</div>
          </div>
        )}
        {thinking && (
          <div className="flex justify-start">
            <div className="rounded-2xl px-3.5 py-2.5 bg-white border border-gray-100">
              <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
            </div>
          </div>
        )}
      </div>

      {/* Pending confirmation (tap fallback for the spoken yes/no) */}
      {pending && (
        <div className="mb-3 rounded-xl border border-indigo-100 bg-indigo-50/50 p-3">
          <p className="text-xs text-gray-700 mb-2">Confirm: <span className="font-black">{pending.label}</span></p>
          <div className="flex gap-2">
            <button type="button" onClick={() => confirm("yes")} className="inline-flex items-center gap-1 text-xs font-black text-white bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 rounded-lg">
              <Check className="w-3.5 h-3.5" /> Yes
            </button>
            <button type="button" onClick={() => confirm("no")} className="inline-flex items-center gap-1 text-xs font-black text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-lg">
              <X className="w-3.5 h-3.5" /> No
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-red-500 font-bold mb-2 text-center">{error}</p>}

      {/* Mic */}
      <div className="flex flex-col items-center gap-2 pt-2">
        <button
          type="button"
          onClick={listening ? stopListening : startListening}
          disabled={thinking}
          className={`w-16 h-16 rounded-full flex items-center justify-center shadow-lg transition-all disabled:opacity-40 ${
            listening ? "bg-red-500 scale-110 animate-pulse" : speaking ? "bg-orange-400" : "bg-orange-600 hover:bg-orange-700"
          }`}
          aria-label={listening ? "Stop" : "Start talking"}
        >
          {listening ? <Square className="w-6 h-6 text-white" /> : <Mic className="w-7 h-7 text-white" />}
        </button>
        <span className="text-[11px] text-gray-400">
          {listening ? "Listening… tap to stop" : speaking ? "Speaking…" : "Tap to talk"}
        </span>
      </div>
    </div>
  );
}
