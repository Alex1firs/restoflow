"use client";

/**
 * SpeechProvider abstraction (Phase 7)
 * ====================================
 * Voice is decoupled from any specific speech technology. The Voice Assistant depends
 * ONLY on these two interfaces — never on the browser APIs directly — so a cloud
 * implementation (OpenAI / ElevenLabs / Google / Azure) can replace either one without
 * touching the Voice Assistant, the AI Assistant, or the Automation layer.
 *
 * Today: browser Web Speech API (SpeechRecognition + speechSynthesis). Zero cost, no
 * keys, hands-free. Swap `createSpeechProviders()` for a cloud factory later.
 */

export interface SpeechToTextProvider {
  readonly id: string;
  isSupported(): boolean;
  /** Begin listening. `onResult` fires with interim + final transcripts. */
  start(handlers: {
    onResult: (transcript: string, isFinal: boolean) => void;
    onError: (message: string) => void;
    onEnd: () => void;
  }): void;
  stop(): void;
}

export interface TextToSpeechProvider {
  readonly id: string;
  isSupported(): boolean;
  speak(text: string, handlers?: { onStart?: () => void; onEnd?: () => void }): void;
  cancel(): void;
}

// ---------------------------------------------------------------------------
// Browser Web Speech API implementations
// ---------------------------------------------------------------------------

interface SRInstance {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SRResultEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
interface SRResultEvent {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}
type SRConstructor = new () => SRInstance;

function getSRConstructor(): SRConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SRConstructor; webkitSpeechRecognition?: SRConstructor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

class BrowserSTTProvider implements SpeechToTextProvider {
  readonly id = "browser-web-speech";
  private rec: SRInstance | null = null;

  isSupported(): boolean {
    return getSRConstructor() !== null;
  }

  start(handlers: { onResult: (t: string, f: boolean) => void; onError: (m: string) => void; onEnd: () => void }): void {
    const Ctor = getSRConstructor();
    if (!Ctor) {
      handlers.onError("Speech recognition is not supported on this device.");
      return;
    }
    const rec = new Ctor();
    rec.lang = navigator.language?.startsWith("en") ? navigator.language : "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      let interim = "";
      let final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text = r[0]?.transcript ?? "";
        if (r.isFinal) final += text;
        else interim += text;
      }
      if (final) handlers.onResult(final.trim(), true);
      else if (interim) handlers.onResult(interim.trim(), false);
    };
    rec.onerror = (e) => handlers.onError(e.error || "Speech recognition error.");
    rec.onend = () => handlers.onEnd();
    this.rec = rec;
    rec.start();
  }

  stop(): void {
    try {
      this.rec?.stop();
    } catch {
      /* already stopped */
    }
  }
}

class BrowserTTSProvider implements TextToSpeechProvider {
  readonly id = "browser-speech-synthesis";

  isSupported(): boolean {
    return typeof window !== "undefined" && "speechSynthesis" in window;
  }

  speak(text: string, handlers?: { onStart?: () => void; onEnd?: () => void }): void {
    if (!this.isSupported() || !text) {
      handlers?.onEnd?.();
      return;
    }
    window.speechSynthesis.cancel(); // never overlap utterances
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.02;
    u.pitch = 1;
    // Prefer a natural English voice when available.
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find((v) => /en-(GB|US|NG)/i.test(v.lang) && /natural|google|samantha|daniel/i.test(v.name)) ?? voices.find((v) => v.lang?.startsWith("en"));
    if (preferred) u.voice = preferred;
    u.onstart = () => handlers?.onStart?.();
    u.onend = () => handlers?.onEnd?.();
    u.onerror = () => handlers?.onEnd?.();
    window.speechSynthesis.speak(u);
  }

  cancel(): void {
    if (this.isSupported()) window.speechSynthesis.cancel();
  }
}

/** The active provider pair. Swap this factory to move to a cloud voice. */
export function createSpeechProviders(): { stt: SpeechToTextProvider; tts: TextToSpeechProvider } {
  return { stt: new BrowserSTTProvider(), tts: new BrowserTTSProvider() };
}
