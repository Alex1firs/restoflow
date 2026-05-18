"use client";

import { useEffect, useState } from "react";
import { X, Download, Share } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export default function PWAInstallPrompt() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    // Already installed — don't show
    if (window.matchMedia("(display-mode: standalone)").matches) {
      setIsStandalone(true);
      return;
    }
    // iOS detection
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !(window.navigator as { standalone?: boolean }).standalone;
    setIsIOS(ios);

    // Check if previously dismissed (session-level)
    if (sessionStorage.getItem("pwa-prompt-dismissed") === "1") {
      setDismissed(true);
      return;
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    const { outcome } = await installEvent.userChoice;
    if (outcome === "accepted") setInstallEvent(null);
    dismiss();
  };

  const dismiss = () => {
    sessionStorage.setItem("pwa-prompt-dismissed", "1");
    setDismissed(true);
  };

  if (isStandalone || dismissed) return null;

  // Android / Chrome — native install prompt available
  if (installEvent) {
    return (
      <div className="fixed bottom-4 left-4 right-4 z-50 flex items-center gap-3 rounded-2xl border border-white/10 bg-[#111] px-4 py-3 shadow-2xl md:left-auto md:right-6 md:max-w-sm">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-500/20">
          <span className="text-lg font-extrabold text-orange-500">R</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">Install Restaflow</p>
          <p className="truncate text-xs text-white/50">Add to your home screen</p>
        </div>
        <button
          onClick={handleInstall}
          className="flex shrink-0 items-center gap-1 rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-bold text-black transition-opacity hover:opacity-90"
        >
          <Download size={13} />
          Install
        </button>
        <button onClick={dismiss} className="shrink-0 text-white/40 hover:text-white/70" aria-label="Dismiss">
          <X size={16} />
        </button>
      </div>
    );
  }

  // iOS Safari — manual instructions
  if (isIOS) {
    return (
      <div className="fixed bottom-4 left-4 right-4 z-50 rounded-2xl border border-white/10 bg-[#111] p-4 shadow-2xl md:left-auto md:right-6 md:max-w-sm">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-semibold text-white">Install Restaflow</p>
          <button onClick={dismiss} className="text-white/40 hover:text-white/70" aria-label="Dismiss">
            <X size={16} />
          </button>
        </div>
        <p className="text-xs text-white/60 leading-relaxed">
          Tap{" "}
          <span className="inline-flex items-center gap-1 font-semibold text-orange-400">
            <Share size={12} /> Share
          </span>{" "}
          then{" "}
          <span className="font-semibold text-orange-400">Add to Home Screen</span>{" "}
          to install this app.
        </p>
      </div>
    );
  }

  return null;
}
