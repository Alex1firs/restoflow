"use client";

import { useState, useEffect, useCallback } from "react";

type DomainStatus = "not_connected" | "pending_dns" | "connected" | "error";

interface DomainInfo {
  customDomain: string | null;
  domainStatus: DomainStatus | null;
  domainError: string | null;
  domainVerifiedAt: unknown;
}

const DOMAIN_RE =
  /^([a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;

function normaliseDomain(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./, "")
    .toLowerCase();
}

function StatusBadge({ status }: { status: DomainStatus | null }) {
  if (!status) return null;
  const map: Record<DomainStatus, { label: string; cls: string }> = {
    not_connected: { label: "Not Connected", cls: "bg-gray-100 text-gray-600" },
    pending_dns: { label: "Pending DNS", cls: "bg-yellow-100 text-yellow-700" },
    connected: { label: "Connected", cls: "bg-green-100 text-green-700" },
    error: { label: "Error", cls: "bg-red-100 text-red-700" },
  };
  const { label, cls } = map[status] ?? map.not_connected;
  return (
    <span
      className={`inline-flex items-center text-xs font-black uppercase px-2.5 py-1 rounded-lg ${cls}`}
    >
      {label}
    </span>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const el = document.createElement("textarea");
      el.value = value;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className="ml-2 text-xs font-bold text-gray-400 hover:text-orange-600 transition-colors px-2 py-1 rounded hover:bg-orange-50 border border-gray-200 hover:border-orange-200"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export default function DomainClient({ slug }: { slug: string }) {
  const [domain, setDomain] = useState("");
  const [savedDomain, setSavedDomain] = useState<string | null>(null);
  const [status, setStatus] = useState<DomainStatus | null>(null);
  const [domainError, setDomainError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  void slug; // available for future use (e.g. local previews)

  const loadDomainInfo = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/domain");
      if (!res.ok) throw new Error("Failed to load domain info");
      const data: DomainInfo = await res.json();
      setSavedDomain(data.customDomain);
      setStatus(data.domainStatus ?? (data.customDomain ? "not_connected" : null));
      setDomainError(data.domainError);
    } catch {
      setError("Could not load domain settings. Please refresh.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDomainInfo();
  }, [loadDomainInfo]);

  const handleConnect = async () => {
    setError(null);
    const normalised = normaliseDomain(domain);

    if (!DOMAIN_RE.test(normalised)) {
      setError(
        "Invalid domain format. Enter a hostname like yourdomain.com — no protocol or path."
      );
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/admin/domain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: normalised }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to connect domain.");
        return;
      }
      setSavedDomain(normalised);
      setStatus("pending_dns");
      setDomain("");
    } catch {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleVerify = async () => {
    setError(null);
    setVerifying(true);
    try {
      const res = await fetch("/api/admin/domain/verify", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Verification check failed.");
        return;
      }
      setStatus(data.domainStatus);
    } catch {
      setError("Could not check domain status. Please try again.");
    } finally {
      setVerifying(false);
    }
  };

  const handleRemove = async () => {
    if (
      !window.confirm(
        "Remove this custom domain? Your restaurant will no longer be accessible via it."
      )
    ) {
      return;
    }
    setError(null);
    setRemoving(true);
    try {
      const res = await fetch("/api/admin/domain", { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Failed to remove domain.");
        return;
      }
      setSavedDomain(null);
      setStatus(null);
      setDomainError(null);
    } catch {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setRemoving(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-10">
        <div className="h-8 w-40 bg-gray-200 rounded animate-pulse mb-6" />
        <div className="h-32 bg-white rounded-2xl border border-gray-100 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-10 space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-black text-gray-900">Custom Domain</h1>
        <p className="text-gray-500 mt-1 text-sm">
          Serve your restaurant page from your own domain instead of the default link.
        </p>
      </div>

      {/* Global error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <p className="text-sm font-medium text-red-700">{error}</p>
        </div>
      )}

      {/* === Section A: Connect domain (no domain saved) === */}
      {!savedDomain && (
        <div className="bg-white rounded-2xl border border-gray-100 p-6">
          <h2 className="text-base font-black text-gray-800 mb-1">Connect a Domain</h2>
          <p className="text-sm text-gray-500 mb-5">
            Enter your domain name below. Make sure you own the domain and have
            access to its DNS settings.
          </p>
          <div className="flex gap-3">
            <input
              type="text"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !saving && handleConnect()}
              placeholder="yourdomain.com"
              className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-medium text-gray-800 focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent placeholder-gray-300"
            />
            <button
              onClick={handleConnect}
              disabled={saving || !domain.trim()}
              className="px-5 py-2.5 bg-orange-600 hover:bg-orange-700 disabled:bg-orange-300 text-white text-sm font-black rounded-xl transition-colors"
            >
              {saving ? "Connecting…" : "Connect Domain"}
            </button>
          </div>
        </div>
      )}

      {/* === Section B: Connected domain card === */}
      {savedDomain && (
        <div className="bg-white rounded-2xl border border-gray-100 p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-black text-gray-800 mb-1">Your Domain</h2>
              <p className="text-lg font-bold text-gray-900">{savedDomain}</p>
              <div className="mt-2 flex items-center gap-2">
                <StatusBadge status={status} />
                {domainError && (
                  <span className="text-xs text-red-600 font-medium">
                    {domainError}
                  </span>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-2 shrink-0">
              {status !== "connected" && (
                <button
                  onClick={handleVerify}
                  disabled={verifying}
                  className="px-4 py-2 text-sm font-black text-orange-600 border border-orange-200 hover:bg-orange-50 rounded-xl transition-colors disabled:opacity-50"
                >
                  {verifying ? "Checking…" : "Check Status"}
                </button>
              )}
              <button
                onClick={handleRemove}
                disabled={removing}
                className="px-4 py-2 text-sm font-black text-red-600 border border-red-200 hover:bg-red-50 rounded-xl transition-colors disabled:opacity-50"
              >
                {removing ? "Removing…" : "Remove Domain"}
              </button>
            </div>
          </div>

          {status === "connected" && (
            <div className="mt-4 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
              <p className="text-sm font-medium text-green-700">
                Your domain is connected and active. Customers can now visit your
                restaurant at{" "}
                <a
                  href={`https://${savedDomain}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-black underline hover:text-green-900"
                >
                  {savedDomain}
                </a>
                .
              </p>
            </div>
          )}
        </div>
      )}

      {/* === Section C: DNS Instructions === */}
      {savedDomain && status !== "connected" && (
        <div className="bg-white rounded-2xl border border-gray-100 p-6">
          <h2 className="text-base font-black text-gray-800 mb-1">
            Configure DNS Records
          </h2>
          <p className="text-sm text-gray-500 mb-5">
            Add the following records in your domain registrar or DNS provider.
            Use the record that matches your setup.
          </p>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-gray-100">
                  <th className="pb-2 pr-4 font-black text-gray-600 text-xs uppercase tracking-wide">
                    Type
                  </th>
                  <th className="pb-2 pr-4 font-black text-gray-600 text-xs uppercase tracking-wide">
                    Name
                  </th>
                  <th className="pb-2 pr-4 font-black text-gray-600 text-xs uppercase tracking-wide">
                    Value
                  </th>
                  <th className="pb-2 font-black text-gray-600 text-xs uppercase tracking-wide">
                    Use for
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                <tr>
                  <td className="py-3 pr-4">
                    <span className="bg-blue-50 text-blue-700 font-black text-xs px-2 py-1 rounded">
                      A
                    </span>
                  </td>
                  <td className="py-3 pr-4">
                    <code className="font-mono text-gray-700 text-xs bg-gray-50 px-1.5 py-0.5 rounded">
                      @
                    </code>
                  </td>
                  <td className="py-3 pr-4">
                    <div className="flex items-center">
                      <code className="font-mono text-gray-700 text-xs bg-gray-50 px-1.5 py-0.5 rounded">
                        76.76.21.21
                      </code>
                      <CopyButton value="76.76.21.21" />
                    </div>
                  </td>
                  <td className="py-3 text-xs text-gray-500">
                    Apex / root domain (bargscafe.com)
                  </td>
                </tr>
                <tr>
                  <td className="py-3 pr-4">
                    <span className="bg-purple-50 text-purple-700 font-black text-xs px-2 py-1 rounded">
                      CNAME
                    </span>
                  </td>
                  <td className="py-3 pr-4">
                    <code className="font-mono text-gray-700 text-xs bg-gray-50 px-1.5 py-0.5 rounded">
                      www
                    </code>
                  </td>
                  <td className="py-3 pr-4">
                    <div className="flex items-center">
                      <code className="font-mono text-gray-700 text-xs bg-gray-50 px-1.5 py-0.5 rounded">
                        cname.vercel-dns.com
                      </code>
                      <CopyButton value="cname.vercel-dns.com" />
                    </div>
                  </td>
                  <td className="py-3 text-xs text-gray-500">
                    www subdomain (www.bargscafe.com)
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <p className="mt-4 text-xs text-gray-400 font-medium">
            DNS changes can take up to 48 hours to propagate. Click "Check Status"
            above after updating your DNS records.
          </p>
        </div>
      )}

      {/* === Section D: How it works info box === */}
      {savedDomain && (
        <div className="bg-gray-50 rounded-2xl border border-gray-100 p-6">
          <h2 className="text-sm font-black text-gray-700 mb-3">How it works</h2>
          <ul className="space-y-2">
            {[
              "You connect a domain you own and add the DNS records shown above.",
              "Once DNS propagates, your restaurant page is served at your custom domain.",
              "Your original link continues to work unchanged.",
              "Customers visiting your domain see the same menu and ordering experience.",
              "If you remove the domain, it stops routing immediately.",
            ].map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm text-gray-500">
                <span className="mt-0.5 w-4 h-4 rounded-full bg-orange-100 text-orange-600 text-xs font-black flex items-center justify-center shrink-0">
                  +
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
