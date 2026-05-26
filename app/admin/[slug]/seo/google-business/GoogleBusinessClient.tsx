"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

// ─── Types ───────────────────────────────────────────────────────────────────

type ProfileStatus =
  | "not_connected"
  | "connected"
  | "draft"
  | "synced"
  | "pending_verification"
  | "verified"
  | "sync_failed";

interface GBStatus {
  apiConfigured: boolean;
  connected: boolean;
  connectedEmail: string | null;
  googleLocationId: string | null;
  profileStatus: ProfileStatus;
  verificationStatus: string | null;
  lastSyncedAt: { _seconds: number } | null;
  lastSyncError: string | null;
  draft: BusinessDetails | null;
}

interface BusinessDetails {
  name: string;
  category: string;
  address: string;
  phone: string;
  website: string;
  description: string;
  accountName?: string;
  locationId?: string;
}

interface GbpAccount {
  accountName: string;
  displayName: string;
  locations: { name: string; title: string }[];
}

type Step = 1 | 2 | 3 | 4 | 5;

type SubscriptionStatus = "trialing" | "active" | "grace_period" | "expired";

// ─── Props ───────────────────────────────────────────────────────────────────

interface Props {
  slug: string;
  restaurant: {
    name: string;
    description: string;
    phone: string;
    address: string;
  };
  publicUrl: string;
  apiConfigured: boolean;
  subscriptionStatus: SubscriptionStatus;
  userRole: string;
}

// ─── Small helpers ────────────────────────────────────────────────────────────

function Toast({
  type,
  message,
  onClose,
}: {
  type: "success" | "error";
  message: string;
  onClose: () => void;
}) {
  return (
    <div
      className={`fixed top-4 right-4 z-50 flex items-start gap-3 px-4 py-3 rounded-xl shadow-lg max-w-sm text-sm font-medium ${
        type === "success"
          ? "bg-green-50 border border-green-200 text-green-800"
          : "bg-red-50 border border-red-200 text-red-800"
      }`}
    >
      <span className="flex-1">{message}</span>
      <button onClick={onClose} className="text-current opacity-60 hover:opacity-100 ml-2 flex-shrink-0">✕</button>
    </div>
  );
}

function StepIndicator({ step, total }: { step: Step; total: number }) {
  return (
    <div className="flex items-center gap-2 mb-6">
      {Array.from({ length: total }, (_, i) => i + 1).map((s) => (
        <div key={s} className="flex items-center gap-2">
          <div
            className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black transition-all ${
              s < step
                ? "bg-orange-600 text-white"
                : s === step
                ? "bg-orange-600 text-white ring-4 ring-orange-100"
                : "bg-gray-200 text-gray-400"
            }`}
          >
            {s < step ? "✓" : s}
          </div>
          {s < total && (
            <div
              className={`h-0.5 w-8 transition-all ${s < step ? "bg-orange-600" : "bg-gray-200"}`}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: ProfileStatus }) {
  const map: Record<ProfileStatus, { label: string; cls: string }> = {
    not_connected: { label: "Not connected", cls: "bg-gray-100 text-gray-500" },
    connected: { label: "Connected", cls: "bg-blue-50 text-blue-700" },
    draft: { label: "Draft saved", cls: "bg-yellow-50 text-yellow-700" },
    synced: { label: "Synced to Google", cls: "bg-green-50 text-green-700" },
    pending_verification: { label: "Pending verification", cls: "bg-orange-50 text-orange-700" },
    verified: { label: "Verified", cls: "bg-green-50 text-green-800 font-black" },
    sync_failed: { label: "Sync failed", cls: "bg-red-50 text-red-700" },
  };
  const { label, cls } = map[status] ?? map.not_connected;
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold ${cls}`}>
      {label}
    </span>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-xs font-black text-gray-500 uppercase tracking-wide mb-1.5">
      {children}
    </label>
  );
}

function Input({
  value,
  onChange,
  placeholder,
  maxLength,
  type = "text",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  maxLength?: number;
  type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      maxLength={maxLength}
      className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 outline-none focus:border-orange-500 bg-white"
    />
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(value).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="text-xs font-bold px-3 py-1.5 rounded-lg border border-gray-200 text-gray-500 hover:text-orange-600 hover:border-orange-200 hover:bg-orange-50 transition-colors whitespace-nowrap"
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function GoogleBusinessClient({
  slug,
  restaurant,
  publicUrl,
  apiConfigured,
  subscriptionStatus,
  userRole,
}: Props) {
  const searchParams = useSearchParams();
  const isExpired = subscriptionStatus === "expired";
  const canEdit = userRole === "owner" || userRole === "manager";

  const [step, setStep] = useState<Step>(1);
  const [gbStatus, setGbStatus] = useState<GBStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [toast, setToast] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [accounts, setAccounts] = useState<GbpAccount[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<{ success: boolean; error?: string } | null>(null);

  const [details, setDetails] = useState<BusinessDetails>({
    name: restaurant.name,
    category: "restaurant",
    address: restaurant.address,
    phone: restaurant.phone,
    website: publicUrl,
    description: restaurant.description,
    accountName: "",
    locationId: "",
  });

  const showToast = (type: "success" | "error", msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 5000);
  };

  const setDetail = (k: keyof BusinessDetails) => (v: string) =>
    setDetails((d) => ({ ...d, [k]: v }));

  const fetchStatus = useCallback(async () => {
    setLoadingStatus(true);
    try {
      const res = await fetch("/api/admin/google-business/status");
      if (res.ok) {
        const data = (await res.json()) as GBStatus;
        setGbStatus(data);
        if (data.draft) {
          setDetails((d) => ({ ...d, ...data.draft }));
        }
        if (data.connected && data.profileStatus === "draft") setStep(2);
        if (data.profileStatus === "synced" || data.profileStatus === "verified") setStep(5);
      }
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Handle OAuth callback params
  useEffect(() => {
    const connected = searchParams.get("connected");
    const error = searchParams.get("error");
    if (connected === "1") {
      showToast("success", "Google account connected successfully!");
      fetchStatus();
      setStep(2);
    }
    if (error) {
      showToast("error", `Connection failed: ${decodeURIComponent(error)}`);
    }
  }, [searchParams, fetchStatus]);

  const handleConnect = async () => {
    if (!apiConfigured) return;
    setConnecting(true);
    try {
      const res = await fetch("/api/admin/google-business/connect");
      const data = (await res.json()) as { authUrl?: string; error?: string };
      if (!res.ok || !data.authUrl) {
        showToast("error", data.error ?? "Failed to start Google connection");
        return;
      }
      window.location.href = data.authUrl;
    } catch {
      showToast("error", "Network error. Please try again.");
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm("Disconnect your Google account? Your GBP listing will remain on Google.")) return;
    setDisconnecting(true);
    try {
      const res = await fetch("/api/admin/google-business/disconnect", { method: "POST" });
      if (res.ok) {
        showToast("success", "Google account disconnected.");
        await fetchStatus();
        setStep(1);
      } else {
        const d = (await res.json()) as { error?: string };
        showToast("error", d.error ?? "Failed to disconnect");
      }
    } finally {
      setDisconnecting(false);
    }
  };

  const handleLoadAccounts = async () => {
    setLoadingAccounts(true);
    try {
      const res = await fetch("/api/admin/google-business/locations");
      const data = (await res.json()) as { accounts?: GbpAccount[]; error?: string };
      if (!res.ok) {
        showToast("error", data.error ?? "Failed to load Google accounts");
        return;
      }
      setAccounts(data.accounts ?? []);
      if (data.accounts && data.accounts.length > 0 && !details.accountName) {
        setDetails((d) => ({
          ...d,
          accountName: data.accounts![0].accountName,
        }));
      }
    } finally {
      setLoadingAccounts(false);
    }
  };

  const handleSaveDraft = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/google-business/locations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save_draft", details }),
      });
      if (res.ok) {
        showToast("success", "Business details saved as draft.");
        setStep(3);
      } else {
        const d = (await res.json()) as { error?: string };
        showToast("error", d.error ?? "Failed to save");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitResult(null);
    try {
      const res = await fetch("/api/admin/google-business/locations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "submit", details }),
      });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (res.ok && data.success) {
        setSubmitResult({ success: true });
        await syncSeo();
        await fetchStatus();
        setStep(5);
      } else {
        setSubmitResult({ success: false, error: data.error ?? "Submission failed" });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const syncSeo = async () => {
    await fetch("/api/admin/google-business/sync-seo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: details.name,
        address: details.address,
        phone: details.phone,
        website: details.website,
        description: details.description,
        category: details.category,
      }),
    }).catch(() => {});
  };

  // ── Subscription gate ──────────────────────────────────────────────────────
  if (isExpired) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12">
        <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center">
          <div className="text-4xl mb-4">🔒</div>
          <h2 className="text-xl font-black text-gray-900 mb-2">Subscription Required</h2>
          <p className="text-gray-500 text-sm mb-6">
            Renew Restaflow Pro to manage your Google Business Profile.
          </p>
          <Link
            href={`/admin/${slug}/billing`}
            className="inline-block px-6 py-3 bg-orange-600 hover:bg-orange-700 text-white font-black text-sm rounded-xl transition-colors"
          >
            Renew Restaflow Pro
          </Link>
        </div>
      </div>
    );
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loadingStatus) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-28 bg-white rounded-2xl border border-gray-100 animate-pulse" />
        ))}
      </div>
    );
  }

  const isFallbackMode = !apiConfigured;

  return (
    <>
      {toast && (
        <Toast type={toast.type} message={toast.msg} onClose={() => setToast(null)} />
      )}

      <div className="max-w-2xl mx-auto px-4 py-8 pb-24 md:pb-8 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <Link
                href={`/admin/${slug}/seo`}
                className="text-xs font-bold text-gray-400 hover:text-orange-600 transition-colors"
              >
                ← SEO
              </Link>
            </div>
            <h1 className="text-2xl font-black text-gray-900">Google Business Profile</h1>
            <p className="text-sm text-gray-500 mt-1">
              Get discovered on Google Maps and local search results.
            </p>
          </div>
          {gbStatus && gbStatus.profileStatus !== "not_connected" && (
            <StatusBadge status={gbStatus.profileStatus} />
          )}
        </div>

        {/* Fallback mode — Setup Assistant */}
        {isFallbackMode ? (
          <SetupAssistant
            details={details}
            setDetail={setDetail}
            restaurant={restaurant}
            publicUrl={publicUrl}
            saving={saving}
            canEdit={canEdit}
            onSaveDraft={handleSaveDraft}
            slug={slug}
          />
        ) : (
          /* Full OAuth wizard */
          <OAuthWizard
            step={step}
            setStep={setStep}
            gbStatus={gbStatus}
            details={details}
            setDetail={setDetail}
            accounts={accounts}
            loadingAccounts={loadingAccounts}
            connecting={connecting}
            disconnecting={disconnecting}
            saving={saving}
            submitting={submitting}
            submitResult={submitResult}
            canEdit={canEdit}
            onConnect={handleConnect}
            onDisconnect={handleDisconnect}
            onLoadAccounts={handleLoadAccounts}
            onSaveDraft={handleSaveDraft}
            onSubmit={handleSubmit}
            publicUrl={publicUrl}
            slug={slug}
          />
        )}
      </div>
    </>
  );
}

// ─── Fallback "Setup Assistant" ───────────────────────────────────────────────

function SetupAssistant({
  details,
  setDetail,
  restaurant,
  publicUrl,
  saving,
  canEdit,
  onSaveDraft,
  slug,
}: {
  details: BusinessDetails;
  setDetail: (k: keyof BusinessDetails) => (v: string) => void;
  restaurant: { name: string; description: string; phone: string; address: string };
  publicUrl: string;
  saving: boolean;
  canEdit: boolean;
  onSaveDraft: () => void;
  slug: string;
}) {
  const generatedDescription = details.description.trim()
    ? details.description.trim()
    : `${restaurant.name} is a restaurant offering quality meals. Order online at ${publicUrl} for delivery or pickup. ${restaurant.phone ? `Call us at ${restaurant.phone}.` : ""}`.trim();

  return (
    <div className="space-y-6">
      {/* Info banner */}
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
        <div className="flex gap-3">
          <span className="text-xl flex-shrink-0">ℹ️</span>
          <div>
            <p className="font-black text-amber-900 text-sm mb-1">Manual Setup Mode</p>
            <p className="text-amber-800 text-sm">
              Google API integration is not configured yet. Use this assistant to prepare your business
              listing details, then manually submit them to Google Business Profile.
            </p>
          </div>
        </div>
      </div>

      {/* Business details form */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-5">
        <h2 className="font-black text-gray-900">Your Business Details</h2>
        <p className="text-sm text-gray-500 -mt-2">
          Fill in these details. We&apos;ll generate copy you can paste directly into Google.
        </p>

        <div>
          <FieldLabel>Business Name</FieldLabel>
          <Input value={details.name} onChange={setDetail("name")} placeholder={restaurant.name} />
        </div>

        <div>
          <FieldLabel>Business Category</FieldLabel>
          <Input
            value={details.category}
            onChange={setDetail("category")}
            placeholder="Restaurant, Fast Food, Cafe..."
          />
          <p className="text-xs text-gray-400 mt-1">
            Tip: use Google&apos;s exact category names for better matching.
          </p>
        </div>

        <div>
          <FieldLabel>Address</FieldLabel>
          <Input value={details.address} onChange={setDetail("address")} placeholder={restaurant.address || "123 Main St, Lagos"} />
        </div>

        <div>
          <FieldLabel>Phone Number</FieldLabel>
          <Input value={details.phone} onChange={setDetail("phone")} placeholder={restaurant.phone || "+234..."} type="tel" />
        </div>

        <div>
          <FieldLabel>Website / Ordering URL</FieldLabel>
          <Input value={details.website} onChange={setDetail("website")} placeholder={publicUrl} type="url" />
        </div>

        <div>
          <FieldLabel>Business Description</FieldLabel>
          <textarea
            value={details.description}
            onChange={(e) => setDetail("description")(e.target.value)}
            placeholder="Describe your restaurant, cuisine type, specialties..."
            rows={4}
            maxLength={750}
            className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-orange-500 resize-none bg-white"
          />
          <p className="text-xs text-gray-400 mt-1">{details.description.length}/750 characters</p>
        </div>

        {canEdit && (
          <button
            onClick={onSaveDraft}
            disabled={saving}
            className="w-full py-3 bg-gray-900 hover:bg-gray-700 disabled:bg-gray-300 text-white font-black text-sm rounded-xl transition-colors"
          >
            {saving ? "Saving..." : "Save Draft"}
          </button>
        )}
      </div>

      {/* Generated description */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
        <h2 className="font-black text-gray-900">Generated Business Description</h2>
        <p className="text-sm text-gray-500">
          Copy this text and paste it into the &quot;Description&quot; field on Google Business Profile.
        </p>
        <div className="bg-gray-50 rounded-xl border border-gray-100 p-4">
          <p className="text-sm text-gray-700 leading-relaxed">{generatedDescription}</p>
        </div>
        <CopyButton value={generatedDescription} />
      </div>

      {/* Manual submission guide */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-5">
        <h2 className="font-black text-gray-900">How to Submit to Google</h2>

        {[
          {
            n: 1,
            title: "Go to Google Business Profile",
            body: (
              <>
                Visit{" "}
                <a
                  href="https://business.google.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-orange-600 font-bold hover:underline"
                >
                  business.google.com
                </a>{" "}
                and sign in with your Google account.
              </>
            ),
          },
          {
            n: 2,
            title: "Add your business",
            body: 'Click "Add your business to Google" and enter your business name.',
          },
          {
            n: 3,
            title: "Enter your details",
            body: "Use the details from the form above. Paste the generated description into the description field.",
          },
          {
            n: 4,
            title: "Add your ordering URL",
            body: (
              <div className="mt-2 flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2 border border-gray-100">
                <span className="font-mono text-xs text-gray-700 flex-1 truncate">{details.website || publicUrl}</span>
                <CopyButton value={details.website || publicUrl} />
              </div>
            ),
          },
          {
            n: 5,
            title: "Verify your business",
            body: "Google will ask you to verify ownership — usually via phone, email, or postcard. Follow their instructions.",
          },
          {
            n: 6,
            title: "Come back and paste your GBP link",
            body: (
              <>
                Once live, copy your Google Business URL and paste it into{" "}
                <Link href={`/admin/${slug}/seo`} className="text-orange-600 font-bold hover:underline">
                  SEO Settings
                </Link>{" "}
                under &quot;Google Business Profile URL.&quot;
              </>
            ),
          },
        ].map(({ n, title, body }) => (
          <div key={n} className="flex gap-4">
            <div className="w-7 h-7 rounded-full bg-orange-600 text-white text-xs font-black flex items-center justify-center flex-shrink-0 mt-0.5">
              {n}
            </div>
            <div>
              <p className="font-black text-gray-800 text-sm">{title}</p>
              <div className="text-sm text-gray-500 mt-1">{body}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Full OAuth wizard ────────────────────────────────────────────────────────

function OAuthWizard({
  step,
  setStep,
  gbStatus,
  details,
  setDetail,
  accounts,
  loadingAccounts,
  connecting,
  disconnecting,
  saving,
  submitting,
  submitResult,
  canEdit,
  onConnect,
  onDisconnect,
  onLoadAccounts,
  onSaveDraft,
  onSubmit,
  publicUrl,
  slug,
}: {
  step: Step;
  setStep: (s: Step) => void;
  gbStatus: GBStatus | null;
  details: BusinessDetails;
  setDetail: (k: keyof BusinessDetails) => (v: string) => void;
  accounts: GbpAccount[];
  loadingAccounts: boolean;
  connecting: boolean;
  disconnecting: boolean;
  saving: boolean;
  submitting: boolean;
  submitResult: { success: boolean; error?: string } | null;
  canEdit: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onLoadAccounts: () => void;
  onSaveDraft: () => void;
  onSubmit: () => void;
  publicUrl: string;
  slug: string;
}) {
  const STEP_LABELS = ["Connect Google", "Business Details", "Review", "Submit", "Status"];

  return (
    <div className="space-y-6">
      <StepIndicator step={step} total={5} />

      {/* Step labels */}
      <div className="flex justify-between -mt-3 px-0.5 mb-2">
        {STEP_LABELS.map((label, i) => (
          <span
            key={label}
            className={`text-[10px] font-bold text-center w-16 leading-tight ${
              i + 1 === step ? "text-orange-600" : "text-gray-400"
            }`}
          >
            {label}
          </span>
        ))}
      </div>

      {/* Step 1: Connect Google */}
      {step === 1 && (
        <div className="space-y-4">
          {gbStatus?.connected ? (
            <div className="bg-white rounded-2xl border border-gray-100 p-6">
              <div className="flex items-center gap-4 mb-5">
                <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center text-green-700 text-lg">
                  ✓
                </div>
                <div>
                  <p className="font-black text-gray-900">Google account connected</p>
                  <p className="text-sm text-gray-500">{gbStatus.connectedEmail}</p>
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    onLoadAccounts();
                    setStep(2);
                  }}
                  className="flex-1 py-3 bg-orange-600 hover:bg-orange-700 text-white font-black text-sm rounded-xl transition-colors"
                >
                  Continue →
                </button>
                {canEdit && (
                  <button
                    onClick={onDisconnect}
                    disabled={disconnecting}
                    className="px-4 py-3 border border-gray-200 text-gray-500 hover:text-red-600 hover:border-red-200 hover:bg-red-50 font-bold text-sm rounded-xl transition-colors"
                  >
                    {disconnecting ? "..." : "Disconnect"}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center space-y-5">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 via-red-500 to-yellow-400 flex items-center justify-center text-white text-3xl mx-auto">
                G
              </div>
              <div>
                <h2 className="text-xl font-black text-gray-900 mb-2">
                  Connect Your Google Account
                </h2>
                <p className="text-sm text-gray-500">
                  Sign in with the Google account that manages your Google Business Profile.
                  Restaflow will never post on your behalf.
                </p>
              </div>
              <button
                onClick={onConnect}
                disabled={connecting || !canEdit}
                className="w-full py-3.5 bg-gray-900 hover:bg-gray-700 disabled:bg-gray-300 text-white font-black text-sm rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                {connecting ? (
                  "Redirecting to Google..."
                ) : (
                  <>
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                    </svg>
                    Continue with Google
                  </>
                )}
              </button>
              {!canEdit && (
                <p className="text-xs text-gray-400">Only the owner or manager can connect Google.</p>
              )}
            </div>
          )}

          <div className="bg-gray-50 rounded-2xl border border-gray-100 p-5 text-sm text-gray-500">
            <p className="font-bold text-gray-700 mb-2">What Restaflow will access:</p>
            <ul className="space-y-1 text-xs">
              <li>✓ Read and update your Google Business Profile listing</li>
              <li>✓ View your business name, address, hours, and photos</li>
            </ul>
            <p className="mt-3 text-xs">
              Restaflow will <strong>never</strong> post reviews, publish ads, or access your
              personal Google data beyond your email address.
            </p>
          </div>
        </div>
      )}

      {/* Step 2: Business Details */}
      {step === 2 && (
        <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="font-black text-gray-900">Business Details</h2>
            <button
              onClick={() => setStep(1)}
              className="text-xs text-gray-400 hover:text-gray-700 font-bold"
            >
              ← Back
            </button>
          </div>
          <p className="text-sm text-gray-500 -mt-2">
            These details will be submitted to Google. Pre-filled from your restaurant settings.
          </p>

          <div>
            <FieldLabel>Business Name *</FieldLabel>
            <Input value={details.name} onChange={setDetail("name")} placeholder="Your restaurant name" />
          </div>

          <div>
            <FieldLabel>Primary Category *</FieldLabel>
            <Input
              value={details.category}
              onChange={setDetail("category")}
              placeholder="Restaurant, Fast Food, Cafe, etc."
            />
            <p className="text-xs text-gray-400 mt-1">
              Match Google&apos;s category names for best results.
            </p>
          </div>

          <div>
            <FieldLabel>Address *</FieldLabel>
            <Input
              value={details.address}
              onChange={setDetail("address")}
              placeholder="123 Main St, Lagos"
            />
          </div>

          <div>
            <FieldLabel>Phone Number</FieldLabel>
            <Input
              value={details.phone}
              onChange={setDetail("phone")}
              placeholder="+234..."
              type="tel"
            />
          </div>

          <div>
            <FieldLabel>Website / Ordering URL</FieldLabel>
            <Input value={details.website} onChange={setDetail("website")} placeholder={publicUrl} type="url" />
          </div>

          <div>
            <FieldLabel>Description</FieldLabel>
            <textarea
              value={details.description}
              onChange={(e) => setDetail("description")(e.target.value)}
              placeholder="Describe your restaurant, cuisine type, specialties..."
              rows={4}
              maxLength={750}
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 outline-none focus:border-orange-500 resize-none"
            />
            <p className="text-xs text-gray-400 mt-1">{details.description.length}/750 characters</p>
          </div>

          {/* Account selector (if accounts loaded) */}
          {accounts.length > 0 && (
            <div>
              <FieldLabel>Google Business Account</FieldLabel>
              <select
                value={details.accountName ?? ""}
                onChange={(e) => setDetail("accountName")(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-orange-500 bg-white"
              >
                {accounts.map((a) => (
                  <option key={a.accountName} value={a.accountName}>
                    {a.displayName} ({a.locations.length} location{a.locations.length !== 1 ? "s" : ""})
                  </option>
                ))}
              </select>
              {/* Location selector if they have existing locations */}
              {accounts.find((a) => a.accountName === details.accountName)?.locations.length! > 0 && (
                <div className="mt-3">
                  <FieldLabel>Update Existing Listing (optional)</FieldLabel>
                  <select
                    value={details.locationId ?? ""}
                    onChange={(e) => setDetail("locationId")(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-orange-500 bg-white"
                  >
                    <option value="">Create new listing</option>
                    {accounts
                      .find((a) => a.accountName === details.accountName)
                      ?.locations.map((l) => (
                        <option key={l.name} value={l.name}>
                          {l.title}
                        </option>
                      ))}
                  </select>
                </div>
              )}
            </div>
          )}

          {accounts.length === 0 && !loadingAccounts && (
            <button
              onClick={onLoadAccounts}
              className="w-full py-2.5 border border-gray-200 text-gray-600 hover:bg-gray-50 font-bold text-sm rounded-xl transition-colors"
            >
              Load my Google Business accounts
            </button>
          )}
          {loadingAccounts && (
            <p className="text-sm text-gray-400 text-center py-2">Loading accounts...</p>
          )}

          {canEdit && (
            <button
              onClick={onSaveDraft}
              disabled={saving || !details.name.trim()}
              className="w-full py-3 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-300 text-white font-black text-sm rounded-xl transition-colors"
            >
              {saving ? "Saving..." : "Save & Continue →"}
            </button>
          )}
        </div>
      )}

      {/* Step 3: Review */}
      {step === 3 && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-black text-gray-900">Review Listing</h2>
              <button
                onClick={() => setStep(2)}
                className="text-xs text-gray-400 hover:text-gray-700 font-bold"
              >
                ← Edit
              </button>
            </div>
            <p className="text-sm text-gray-500 -mt-2">
              This is what will be submitted to Google Business Profile.
            </p>

            <div className="bg-gray-50 rounded-xl border border-gray-100 p-5 space-y-3">
              {[
                { label: "Business Name", value: details.name },
                { label: "Category", value: details.category },
                { label: "Address", value: details.address },
                { label: "Phone", value: details.phone },
                { label: "Website", value: details.website },
              ].map(({ label, value }) => (
                <div key={label} className="flex gap-4">
                  <span className="text-xs font-black text-gray-400 uppercase tracking-wide w-24 flex-shrink-0 pt-0.5">
                    {label}
                  </span>
                  <span className="text-sm text-gray-700 flex-1">{value || "—"}</span>
                </div>
              ))}
              {details.description && (
                <div className="flex gap-4">
                  <span className="text-xs font-black text-gray-400 uppercase tracking-wide w-24 flex-shrink-0 pt-0.5">
                    Description
                  </span>
                  <span className="text-sm text-gray-700 flex-1 leading-relaxed">
                    {details.description}
                  </span>
                </div>
              )}
            </div>

            {!details.accountName && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
                <strong>Note:</strong> No Google Business account selected. Go back to Step 2 and
                load your accounts first, or this will fail.
              </div>
            )}

            {canEdit && (
              <button
                onClick={() => setStep(4)}
                disabled={!details.name.trim()}
                className="w-full py-3 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-300 text-white font-black text-sm rounded-xl transition-colors"
              >
                Submit to Google →
              </button>
            )}
          </div>
        </div>
      )}

      {/* Step 4: Submit */}
      {step === 4 && (
        <div className="bg-white rounded-2xl border border-gray-100 p-8 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="font-black text-gray-900">Submit to Google</h2>
            <button
              onClick={() => setStep(3)}
              className="text-xs text-gray-400 hover:text-gray-700 font-bold"
            >
              ← Back
            </button>
          </div>

          {!submitResult ? (
            <>
              <div className="bg-gray-50 rounded-xl p-4 text-sm text-gray-600">
                <p className="font-bold text-gray-800 mb-1">What happens next:</p>
                <ul className="space-y-1 text-xs">
                  <li>1. Restaflow creates or updates your GBP listing via Google&apos;s API</li>
                  <li>2. Google may require verification before the listing goes live</li>
                  <li>3. Your local SEO settings will be updated automatically</li>
                </ul>
              </div>
              <button
                onClick={onSubmit}
                disabled={submitting || !canEdit}
                className="w-full py-3.5 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-300 text-white font-black text-sm rounded-xl transition-colors"
              >
                {submitting ? "Submitting to Google..." : "Confirm & Submit"}
              </button>
            </>
          ) : submitResult.success ? (
            <div className="text-center space-y-4">
              <div className="text-5xl">🎉</div>
              <p className="font-black text-gray-900 text-lg">Submitted successfully!</p>
              <p className="text-sm text-gray-500">
                Your listing has been sent to Google. Continue to see verification status.
              </p>
              <button
                onClick={() => setStep(5)}
                className="w-full py-3 bg-orange-600 hover:bg-orange-700 text-white font-black text-sm rounded-xl transition-colors"
              >
                View Status →
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
                <p className="font-bold mb-1">Submission failed</p>
                <p>{submitResult.error}</p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={onSubmit}
                  disabled={submitting}
                  className="flex-1 py-3 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-300 text-white font-black text-sm rounded-xl transition-colors"
                >
                  Try Again
                </button>
                <button
                  onClick={() => setStep(2)}
                  className="flex-1 py-3 border border-gray-200 text-gray-600 hover:bg-gray-50 font-bold text-sm rounded-xl transition-colors"
                >
                  Edit Details
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Step 5: Status */}
      {step === 5 && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
            <h2 className="font-black text-gray-900">Listing Status</h2>

            <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-xl border border-gray-100">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center text-lg flex-shrink-0 ${
                  gbStatus?.profileStatus === "verified"
                    ? "bg-green-100"
                    : gbStatus?.profileStatus === "synced"
                    ? "bg-blue-50"
                    : gbStatus?.profileStatus === "sync_failed"
                    ? "bg-red-50"
                    : "bg-orange-50"
                }`}
              >
                {gbStatus?.profileStatus === "verified"
                  ? "✅"
                  : gbStatus?.profileStatus === "synced"
                  ? "🔄"
                  : gbStatus?.profileStatus === "sync_failed"
                  ? "❌"
                  : "⏳"}
              </div>
              <div>
                <p className="font-black text-gray-900">
                  {gbStatus?.profileStatus === "verified"
                    ? "Business Verified"
                    : gbStatus?.profileStatus === "synced"
                    ? "Synced to Google"
                    : gbStatus?.profileStatus === "sync_failed"
                    ? "Sync Failed"
                    : "Awaiting Verification"}
                </p>
                {gbStatus?.lastSyncedAt && (
                  <p className="text-xs text-gray-400 mt-0.5">
                    Last synced:{" "}
                    {new Date(gbStatus.lastSyncedAt._seconds * 1000).toLocaleDateString()}
                  </p>
                )}
                {gbStatus?.lastSyncError && (
                  <p className="text-xs text-red-600 mt-0.5">{gbStatus.lastSyncError}</p>
                )}
              </div>
            </div>

            {gbStatus?.profileStatus === "synced" && (
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-sm text-blue-800">
                <p className="font-bold mb-1">Verification may be required</p>
                <p>
                  Google may contact you via phone, email, or postcard to verify business ownership
                  before your listing goes live. Check your Google Business Profile dashboard for
                  verification options.
                </p>
                <a
                  href="https://business.google.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-block font-bold text-blue-700 hover:underline"
                >
                  Open Google Business Profile →
                </a>
              </div>
            )}

            {gbStatus?.profileStatus === "sync_failed" && (
              <button
                onClick={() => setStep(3)}
                className="w-full py-3 bg-orange-600 hover:bg-orange-700 text-white font-black text-sm rounded-xl transition-colors"
              >
                Retry Submission
              </button>
            )}
          </div>

          {/* Verification guidance */}
          <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
            <h2 className="font-black text-gray-900">Verification Methods</h2>
            <p className="text-sm text-gray-500">
              Google determines which verification method to offer based on your listing type.
              These are the most common methods:
            </p>
            <div className="space-y-3">
              {[
                {
                  icon: "📱",
                  title: "Phone (SMS or call)",
                  desc: "Google sends a verification code to your business phone number.",
                },
                {
                  icon: "📧",
                  title: "Email",
                  desc: "A verification code is sent to a business email address.",
                },
                {
                  icon: "📬",
                  title: "Postcard",
                  desc: "Google mails a postcard with a code to your business address (takes 5–14 days).",
                },
                {
                  icon: "⚡",
                  title: "Instant verification",
                  desc: "Available if your business is already verified in Google Search Console.",
                },
              ].map(({ icon, title, desc }) => (
                <div key={title} className="flex gap-3 p-3 bg-gray-50 rounded-xl">
                  <span className="text-lg flex-shrink-0">{icon}</span>
                  <div>
                    <p className="font-bold text-gray-800 text-sm">{title}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Navigation */}
          <div className="flex gap-3">
            <Link
              href={`/admin/${slug}/seo`}
              className="flex-1 py-3 border border-gray-200 text-gray-600 hover:bg-gray-50 font-bold text-sm rounded-xl transition-colors text-center"
            >
              ← Back to SEO
            </Link>
            <button
              onClick={() => setStep(2)}
              className="flex-1 py-3 border border-orange-200 text-orange-600 hover:bg-orange-50 font-bold text-sm rounded-xl transition-colors"
            >
              Update Details
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
