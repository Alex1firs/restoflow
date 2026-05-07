"use client";

import { useState, useEffect, useCallback, useRef } from "react";

type UIState = "idle" | "connecting" | "dns_required" | "connected";

const DOMAIN_RE =
  /^([a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;

function normaliseDomain(raw: string): string {
  return raw.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "").replace(/^www\./, "").toLowerCase();
}

function CheckIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}

function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(value).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={copy}
      className="text-xs font-bold px-2.5 py-1 rounded-lg border border-gray-200 text-gray-500 hover:text-orange-600 hover:border-orange-200 hover:bg-orange-50 transition-colors"
    >
      {copied ? "Copied!" : (label ?? "Copy")}
    </button>
  );
}

const WHATSAPP_NUMBER = "2347067609816";

export default function DomainClient({ slug }: { slug: string }) {
  void slug;

  const [uiState, setUiState] = useState<UIState>("idle");
  const [domain, setDomain] = useState("");
  const [savedDomain, setSavedDomain] = useState<string | null>(null);
  const [connectStep, setConnectStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [removing, setRemoving] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const checkStatus = useCallback(async (): Promise<"connected" | "pending_dns"> => {
    try {
      const res = await fetch("/api/admin/domain/check");
      if (!res.ok) return "pending_dns";
      const data = await res.json();
      return data.domainStatus === "connected" ? "connected" : "pending_dns";
    } catch {
      return "pending_dns";
    }
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      const status = await checkStatus();
      if (status === "connected") {
        stopPolling();
        setUiState("connected");
      }
    }, 10000);
  }, [checkStatus, stopPolling]);

  // Load existing domain on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/domain");
        if (!res.ok) return;
        const data = await res.json();
        if (data.customDomain) {
          setSavedDomain(data.customDomain);
          if (data.domainStatus === "connected") {
            setUiState("connected");
          } else {
            setUiState("dns_required");
            startPolling();
          }
        }
      } finally {
        setLoading(false);
      }
    })();
    return stopPolling;
  }, [startPolling, stopPolling]);

  const handleConnect = async () => {
    setError(null);
    const clean = normaliseDomain(domain);

    if (!DOMAIN_RE.test(clean)) {
      setError("Enter a valid domain like yourdomain.com — no http:// or /");
      return;
    }

    setUiState("connecting");
    setConnectStep(0);

    // Step 1 — save to Firestore + Vercel
    await new Promise((r) => setTimeout(r, 600));
    setConnectStep(1);

    const res = await fetch("/api/admin/domain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain: clean }),
    });
    const data = await res.json();

    if (!res.ok) {
      setError(data.error ?? "Failed to connect domain.");
      setUiState("idle");
      return;
    }

    // Step 2 — preparing
    await new Promise((r) => setTimeout(r, 700));
    setConnectStep(2);

    // Step 3 — initial check
    await new Promise((r) => setTimeout(r, 800));
    setConnectStep(3);

    const status = await checkStatus();
    setSavedDomain(clean);
    setDomain("");

    if (status === "connected") {
      setUiState("connected");
    } else {
      setUiState("dns_required");
      startPolling();
    }
  };

  const handleRemove = async () => {
    if (!confirm("Remove this domain? Your restaurant page will no longer be accessible from it.")) return;
    setRemoving(true);
    try {
      await fetch("/api/admin/domain", { method: "DELETE" });
      stopPolling();
      setSavedDomain(null);
      setDomain("");
      setError(null);
      setUiState("idle");
    } finally {
      setRemoving(false);
    }
  };

  const whatsappMsg = encodeURIComponent(
    `Hi, I need help connecting my domain${savedDomain ? ` (${savedDomain})` : ""} to my RestoFlow restaurant page.`
  );

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12">
        <div className="space-y-4">
          <div className="h-8 w-48 bg-gray-200 rounded-xl animate-pulse" />
          <div className="h-40 bg-white rounded-2xl border border-gray-100 animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-10 space-y-5">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-black text-gray-900">Get Your Own Restaurant Website</h1>
        <p className="text-gray-500 mt-1 text-sm">
          Let customers order directly from your brand — like <span className="font-bold text-gray-700">bargscafe.com</span>
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </div>
      )}

      {/* ── STATE: IDLE ─────────────────────────────── */}
      {uiState === "idle" && (
        <div className="bg-white rounded-2xl border border-gray-100 p-7 space-y-5">
          <div>
            <p className="text-xs font-black text-gray-400 uppercase tracking-widest mb-3">Your Domain</p>
            <div className="flex gap-3">
              <input
                type="text"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && domain.trim() && handleConnect()}
                placeholder="yourrestaurant.com"
                className="flex-1 border border-gray-200 rounded-xl px-4 py-3 text-sm font-medium text-gray-800 focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent placeholder-gray-300"
              />
              <button
                onClick={handleConnect}
                disabled={!domain.trim()}
                className="px-6 py-3 bg-gray-900 hover:bg-gray-700 disabled:bg-gray-200 disabled:text-gray-400 text-white text-sm font-black rounded-xl transition-colors whitespace-nowrap"
              >
                Connect Domain
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-2">No http:// — just the domain, like <span className="font-mono">yourbrand.com</span></p>
          </div>

          <div className="border-t border-gray-100 pt-5">
            <p className="text-xs font-bold text-gray-400 mb-3">Need help setting it up?</p>
            <a
              href={`https://wa.me/${WHATSAPP_NUMBER}?text=${whatsappMsg}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2.5 px-4 py-2.5 bg-green-50 border border-green-200 text-green-700 font-bold text-sm rounded-xl hover:bg-green-100 transition-colors"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
              </svg>
              Let us connect it for you
            </a>
          </div>
        </div>
      )}

      {/* ── STATE: CONNECTING ────────────────────────── */}
      {uiState === "connecting" && (
        <div className="bg-white rounded-2xl border border-gray-100 p-8">
          <p className="text-base font-black text-gray-900 mb-6">Connecting your domain...</p>
          <div className="space-y-4">
            {[
              "Saving domain",
              "Preparing your website",
              "Checking connection",
            ].map((label, i) => {
              const done = connectStep > i;
              const active = connectStep === i;
              return (
                <div key={label} className="flex items-center gap-3">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 transition-all ${
                    done ? "bg-green-500 text-white" : active ? "bg-orange-100 text-orange-600" : "bg-gray-100 text-gray-300"
                  }`}>
                    {done ? <CheckIcon /> : active ? <Spinner /> : <span className="w-2 h-2 rounded-full bg-gray-300 block" />}
                  </div>
                  <span className={`text-sm font-bold ${done ? "text-green-600" : active ? "text-gray-900" : "text-gray-300"}`}>
                    {label}{active ? "..." : ""}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── STATE: DNS REQUIRED ──────────────────────── */}
      {uiState === "dns_required" && savedDomain && (
        <>
          <div className="bg-orange-50 border border-orange-200 rounded-2xl p-6">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <p className="font-black text-gray-900 text-base">Almost done — 2 minutes left</p>
                <p className="text-sm text-gray-600 mt-1">
                  Update your DNS settings at your domain registrar (GoDaddy, Namecheap, etc.)
                </p>
              </div>
              <div className="flex items-center gap-1.5 bg-yellow-100 text-yellow-700 text-xs font-black px-3 py-1.5 rounded-lg flex-shrink-0">
                <Spinner />
                Connecting
              </div>
            </div>

            <div className="bg-white rounded-xl border border-orange-100 overflow-hidden mb-4">
              <div className="grid grid-cols-3 gap-px bg-gray-100 text-xs font-black text-gray-400 uppercase tracking-wide">
                <div className="bg-gray-50 px-4 py-2">Type</div>
                <div className="bg-gray-50 px-4 py-2">Name</div>
                <div className="bg-gray-50 px-4 py-2">Value</div>
              </div>
              <div className="divide-y divide-gray-100">
                <div className="grid grid-cols-3 gap-px px-4 py-3 text-sm">
                  <span className="font-black text-blue-600">A</span>
                  <code className="font-mono text-gray-600">@</code>
                  <div className="flex items-center gap-2">
                    <code className="font-mono text-gray-800 text-xs">76.76.21.21</code>
                    <CopyButton value="76.76.21.21" />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-px px-4 py-3 text-sm">
                  <span className="font-black text-purple-600">CNAME</span>
                  <code className="font-mono text-gray-600">www</code>
                  <div className="flex items-center gap-2">
                    <code className="font-mono text-gray-800 text-xs truncate">cname.vercel-dns.com</code>
                    <CopyButton value="cname.vercel-dns.com" />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <CopyButton
                value={`Type: A  |  Name: @  |  Value: 76.76.21.21\nType: CNAME  |  Name: www  |  Value: cname.vercel-dns.com`}
                label="Copy All Records"
              />
              <p className="text-xs text-gray-400 font-medium">Usually connects in 1–5 min (up to 24h)</p>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 text-xs text-gray-400 font-medium">
                <Spinner />
                <span>Checking every 10 seconds...</span>
              </div>
              <div className="flex-1" />
              <button
                onClick={handleRemove}
                disabled={removing}
                className="text-xs font-bold text-red-500 hover:text-red-700 transition-colors"
              >
                {removing ? "Removing..." : "Remove domain"}
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-2">
              Domain: <span className="font-mono font-bold text-gray-600">{savedDomain}</span>
            </p>
          </div>

          <div className="bg-green-50 border border-green-100 rounded-2xl p-5 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-black text-gray-800">Not sure how to do this?</p>
              <p className="text-xs text-gray-500 mt-0.5">Message us on WhatsApp — we&apos;ll set it up for you.</p>
            </div>
            <a
              href={`https://wa.me/${WHATSAPP_NUMBER}?text=${whatsappMsg}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-shrink-0 flex items-center gap-2 px-4 py-2.5 bg-green-600 text-white font-bold text-sm rounded-xl hover:bg-green-700 transition-colors"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
              </svg>
              Get Help
            </a>
          </div>
        </>
      )}

      {/* ── STATE: CONNECTED ─────────────────────────── */}
      {uiState === "connected" && savedDomain && (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <div className="bg-green-500 px-7 py-8 text-center">
            <div className="w-14 h-14 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-white font-black text-xl">Your domain is live!</p>
            <p className="text-green-100 text-sm mt-1">Customers can now order directly from your brand.</p>
          </div>

          <div className="px-7 py-6 space-y-5">
            <div className="bg-gray-50 rounded-xl px-4 py-3 flex items-center justify-between">
              <span className="font-mono text-gray-800 font-bold text-sm">https://{savedDomain}</span>
              <CopyButton value={`https://${savedDomain}`} />
            </div>

            <div className="flex gap-3">
              <a
                href={`https://${savedDomain}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 text-center py-3 bg-gray-900 hover:bg-gray-700 text-white font-black text-sm rounded-xl transition-colors"
              >
                Open Website
              </a>
              <button
                onClick={handleRemove}
                disabled={removing}
                className="px-4 py-3 text-sm font-black text-red-500 border border-red-200 hover:bg-red-50 rounded-xl transition-colors disabled:opacity-50"
              >
                {removing ? "Removing..." : "Remove"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
