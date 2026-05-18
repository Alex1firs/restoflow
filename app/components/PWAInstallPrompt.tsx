"use client";

import { useEffect, useState } from "react";
import { X, Download, Share } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

declare global {
  interface Window {
    __pwaPrompt: BeforeInstallPromptEvent | null;
  }
}

export default function PWAInstallPrompt() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    // Already installed — hide entirely
    if (window.matchMedia("(display-mode: standalone)").matches) return;

    // Previously dismissed this session
    if (sessionStorage.getItem("pwa-prompt-dismissed") === "1") {
      setDismissed(true);
      return;
    }

    // iOS Safari: no beforeinstallprompt — show manual instructions
    const isIOSDevice =
      /iphone|ipad|ipod/i.test(navigator.userAgent) &&
      !(window.navigator as { standalone?: boolean }).standalone;
    setIsIOS(isIOSDevice);
    if (isIOSDevice) return;

    // Pick up the event that was captured BEFORE React hydrated (see layout.tsx script)
    if (window.__pwaPrompt) {
      setInstallEvent(window.__pwaPrompt);
      return;
    }

    // Fallback: listen in case the browser fires it after hydration
    const handler = (e: Event) => {
      e.preventDefault();
      const evt = e as BeforeInstallPromptEvent;
      window.__pwaPrompt = evt;
      setInstallEvent(evt);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const dismiss = () => {
    sessionStorage.setItem("pwa-prompt-dismissed", "1");
    setDismissed(true);
  };

  const handleInstall = async () => {
    if (!installEvent || installing) return;
    setInstalling(true);
    try {
      await installEvent.prompt();
      const { outcome } = await installEvent.userChoice;
      if (outcome === "accepted") {
        window.__pwaPrompt = null;
        setInstallEvent(null);
      }
    } catch {
      // prompt() can only be called once per event — if it throws, just hide
    } finally {
      setInstalling(false);
      dismiss();
    }
  };

  if (dismissed) return null;

  // ── Android / Chrome: native install prompt ──────────────────────────────
  if (installEvent) {
    return (
      <div className="fixed bottom-4 left-4 right-4 z-50 md:left-auto md:right-6 md:max-w-sm">
        <button
          onClick={handleInstall}
          disabled={installing}
          className="w-full flex items-center gap-3 rounded-2xl border border-white/10 bg-[#111] px-4 py-3 shadow-2xl text-left transition-opacity active:opacity-80 disabled:opacity-60"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-500/20">
            <span className="text-lg font-extrabold text-orange-500">R</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white">
              {installing ? "Opening installer…" : "Install Restaflow"}
            </p>
            <p className="truncate text-xs text-white/50">
              {installing ? "Please follow the prompt" : "Add to your home screen"}
            </p>
          </div>
          <Download size={18} className="shrink-0 text-orange-400" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); dismiss(); }}
          className="absolute top-1 right-1 p-2 text-white/30 hover:text-white/70"
          aria-label="Dismiss"
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  // ── iOS Safari: manual Add to Home Screen instructions ───────────────────
  if (isIOS) {
    return (
      <div className="fixed bottom-4 left-4 right-4 z-50 rounded-2xl border border-white/10 bg-[#111] p-4 shadow-2xl md:left-auto md:right-6 md:max-w-sm">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-bold text-white">Install Restaflow</p>
          <button
            onClick={dismiss}
            className="text-white/40 hover:text-white/70 p-1"
            aria-label="Dismiss"
          >
            <X size={16} />
          </button>
        </div>
        <div className="space-y-2 text-xs text-white/60 leading-relaxed">
          <div className="flex items-start gap-2">
            <span className="shrink-0 w-5 h-5 rounded-full bg-orange-500/20 text-orange-400 font-black text-[10px] flex items-center justify-center">1</span>
            <p>Tap the <span className="inline-flex items-center gap-1 font-bold text-white/80"><Share size={12} /> Share</span> button at the bottom of Safari</p>
          </div>
          <div className="flex items-start gap-2">
            <span className="shrink-0 w-5 h-5 rounded-full bg-orange-500/20 text-orange-400 font-black text-[10px] flex items-center justify-center">2</span>
            <p>Scroll down and tap <span className="font-bold text-white/80">Add to Home Screen</span></p>
          </div>
          <div className="flex items-start gap-2">
            <span className="shrink-0 w-5 h-5 rounded-full bg-orange-500/20 text-orange-400 font-black text-[10px] flex items-center justify-center">3</span>
            <p>Tap <span className="font-bold text-white/80">Add</span> in the top right</p>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
