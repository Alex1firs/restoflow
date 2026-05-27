"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SetupChecklist } from "@/lib/setup-checklist";

type Props = {
  slug: string;
  status: string;
  setupChecklist: SetupChecklist;
  menuItemCount: number;
  initialStep: number;
};

type StepDef = {
  id: number;
  key: string;
  title: string;
  description: string;
  note: string;
  checklistKeys: string[];
  completeIfAny?: boolean;
  optional?: boolean;
  actionUrl: ((s: string) => string) | null;
  actionLabel: string | null;
  externalAction?: boolean;
};

const STEPS: StepDef[] = [
  {
    id: 1,
    key: "business",
    title: "Business Information",
    description:
      "Add your restaurant name, description, phone number, and address. This helps customers find you and builds trust.",
    note: "Open Store Settings → Business Information to fill in your details.",
    checklistKeys: ["name", "description", "phone", "address"],
    actionUrl: (s) => `/admin/${s}/settings#business-info`,
    actionLabel: "Open Business Settings",
  },
  {
    id: 2,
    key: "branding",
    title: "Branding",
    description:
      "Upload your restaurant logo and a cover photo. A professional look makes customers more likely to place an order.",
    note: "Open Store Settings → Branding to upload your images.",
    checklistKeys: ["logo", "coverImage"],
    completeIfAny: true,
    actionUrl: (s) => `/admin/${s}/settings#branding`,
    actionLabel: "Upload Logo & Cover",
  },
  {
    id: 3,
    key: "hours",
    title: "Opening Hours",
    description:
      "Set your opening hours so customers know when they can place orders. You need at least one open day configured.",
    note: "Opening hours are in Store Settings → Business Information.",
    checklistKeys: ["openingHours"],
    actionUrl: (s) => `/admin/${s}/settings#business-info`,
    actionLabel: "Set Opening Hours",
  },
  {
    id: 4,
    key: "menu",
    title: "Menu Setup",
    description:
      "Add your best-selling meals with clear names, prices, and food photos. Customers order more when they can see what they are getting.",
    note: "You need at least 3 menu items before you can submit for review.",
    checklistKeys: ["menuItems"],
    actionUrl: (s) => `/admin/${s}/menu`,
    actionLabel: "Go to Menu",
  },
  {
    id: 5,
    key: "payment",
    title: "Payment Setup",
    description:
      "Connect your bank account so online payments are settled directly to you. Customers can still pay on delivery without this, but online payment earns you more orders.",
    note: "This step is optional but strongly recommended.",
    checklistKeys: ["payment"],
    optional: true,
    actionUrl: (s) => `/admin/${s}/payment`,
    actionLabel: "Set Up Payments",
  },
  {
    id: 6,
    key: "preview",
    title: "Preview Your Storefront",
    description:
      "See exactly what customers see when they visit your store. Check that your name, menu, and photos all look right before you go live.",
    note: "The preview opens in a new tab. Come back here when you are done.",
    checklistKeys: [],
    actionUrl: (s) => `/r/${s}`,
    actionLabel: "Open Store Preview",
    externalAction: true,
  },
  {
    id: 7,
    key: "readiness",
    title: "Publish Readiness",
    description:
      "Review your setup below. Once all required items are complete, submit your store for review and we will activate it.",
    note: "",
    checklistKeys: [],
    actionUrl: null,
    actionLabel: null,
  },
];

const TOTAL = STEPS.length;

const READINESS_ITEMS: { label: string; checkKey: string; required: boolean }[] = [
  { label: "Restaurant name", checkKey: "name", required: true },
  { label: "Restaurant description", checkKey: "description", required: true },
  { label: "Phone number", checkKey: "phone", required: true },
  { label: "Address", checkKey: "address", required: true },
  { label: "Opening hours", checkKey: "openingHours", required: true },
  { label: "Menu items (min. 3)", checkKey: "menuItems", required: true },
  { label: "Logo or cover photo", checkKey: "_logoOrCover", required: false },
  { label: "Online payment setup", checkKey: "payment", required: false },
];

export default function SetupWizard({
  slug,
  status,
  setupChecklist,
  menuItemCount,
  initialStep,
}: Props) {
  const router = useRouter();
  const [step, setStep] = useState(initialStep);
  const [isRequestingHelp, setIsRequestingHelp] = useState(false);
  const [helpRequestSent, setHelpRequestSent] = useState(false);
  const [helpAlreadyOpen, setHelpAlreadyOpen] = useState(false);
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function goTo(n: number) {
    const clamped = Math.max(1, Math.min(TOTAL, n));
    setStep(clamped);
    router.replace(`/admin/${slug}/setup?step=${clamped}`, { scroll: false });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function getItemPassed(key: string): boolean {
    if (key === "_logoOrCover") {
      return (
        (setupChecklist.items.find((i) => i.key === "logo")?.passed ?? false) ||
        (setupChecklist.items.find((i) => i.key === "coverImage")?.passed ?? false)
      );
    }
    return setupChecklist.items.find((i) => i.key === key)?.passed ?? false;
  }

  function isStepComplete(s: StepDef): boolean {
    if (!s.checklistKeys.length) return false;
    return s.completeIfAny
      ? s.checklistKeys.some((k) => getItemPassed(k))
      : s.checklistKeys.every((k) => getItemPassed(k));
  }

  const allReadinessPassed = READINESS_ITEMS.filter((i) => i.required).every((i) =>
    getItemPassed(i.checkKey)
  );

  async function requestHelp() {
    if (helpAlreadyOpen || helpRequestSent || isRequestingHelp) return;
    setIsRequestingHelp(true);
    try {
      const res = await fetch("/api/admin/restaurants/assistance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setupScore: setupChecklist.score }),
      });
      if (res.status === 409) { setHelpAlreadyOpen(true); return; }
      if (res.ok) setHelpRequestSent(true);
    } finally {
      setIsRequestingHelp(false);
    }
  }

  async function submitForReview() {
    setIsSubmittingReview(true);
    setSubmitError(null);
    try {
      const res = await fetch(`/api/admin/restaurants/${slug}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "pending_review" }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error ?? "Failed to submit");
      }
      setSubmitSuccess(true);
      setTimeout(() => router.push(`/admin/${slug}/dashboard`), 3000);
    } catch (e: unknown) {
      setSubmitError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setIsSubmittingReview(false);
    }
  }

  const currentStep = STEPS[step - 1];
  const stepComplete = isStepComplete(currentStep);

  return (
    <div className="min-h-screen bg-gray-50 pb-20 md:pb-0">
      <div className="max-w-2xl mx-auto px-4 pt-6">

        {/* Top bar */}
        <div className="flex items-center justify-between mb-6">
          <a
            href={`/admin/${slug}/dashboard`}
            className="inline-flex items-center gap-1.5 text-sm font-bold text-gray-500 hover:text-gray-800 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Dashboard
          </a>
          <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">
            Step {step} of {TOTAL}
          </span>
        </div>

        {/* Step dot indicator */}
        <div className="flex items-center mb-8">
          {STEPS.map((s, i) => {
            const complete = isStepComplete(s) || (s.key === "readiness" && allReadinessPassed);
            const active = step === s.id;
            return (
              <div key={s.id} className="flex items-center" style={{ flex: i < STEPS.length - 1 ? "1" : "0" }}>
                <button
                  type="button"
                  onClick={() => goTo(s.id)}
                  title={s.title}
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black transition-all flex-shrink-0 ${
                    complete
                      ? "bg-green-500 text-white"
                      : active
                      ? "bg-gray-900 text-white ring-2 ring-gray-900 ring-offset-2"
                      : "bg-gray-200 text-gray-500 hover:bg-gray-300"
                  }`}
                >
                  {complete ? (
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    s.id
                  )}
                </button>
                {i < STEPS.length - 1 && (
                  <div
                    className={`flex-1 h-0.5 mx-1 ${complete ? "bg-green-300" : "bg-gray-200"}`}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Step card */}
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden mb-4">

          {/* Card header band */}
          <div
            className={`px-6 py-3.5 border-b flex items-center justify-between ${
              currentStep.key === "preview"
                ? "bg-blue-50 border-blue-100"
                : currentStep.key === "readiness"
                ? allReadinessPassed
                  ? "bg-green-50 border-green-100"
                  : "bg-gray-50 border-gray-100"
                : stepComplete
                ? "bg-green-50 border-green-100"
                : currentStep.optional
                ? "bg-gray-50 border-gray-100"
                : "bg-orange-50 border-orange-100"
            }`}
          >
            <h2 className="text-base font-black text-gray-900">{currentStep.title}</h2>
            {currentStep.key !== "preview" && currentStep.key !== "readiness" && (
              <span
                className={`inline-flex items-center gap-1.5 text-xs font-black px-2.5 py-1 rounded-full ${
                  stepComplete
                    ? "bg-green-100 text-green-700"
                    : currentStep.optional
                    ? "bg-gray-100 text-gray-500"
                    : "bg-orange-100 text-orange-700"
                }`}
              >
                {stepComplete ? (
                  <>
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                    Complete
                  </>
                ) : currentStep.optional ? (
                  "Optional"
                ) : (
                  "Incomplete"
                )}
              </span>
            )}
          </div>

          <div className="p-6 space-y-5">

            <p className="text-sm text-gray-600 leading-relaxed">{currentStep.description}</p>

            {/* Action button (all steps except readiness) */}
            {currentStep.key !== "readiness" &&
              currentStep.actionUrl &&
              currentStep.actionLabel && (
                <div>
                  <a
                    href={currentStep.actionUrl(slug)}
                    target={currentStep.externalAction ? "_blank" : undefined}
                    rel={currentStep.externalAction ? "noopener noreferrer" : undefined}
                    className="inline-flex items-center gap-2 bg-gray-900 hover:bg-black text-white text-sm font-black px-5 py-3 rounded-xl transition-colors"
                  >
                    {currentStep.actionLabel}
                    {currentStep.externalAction ? (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    )}
                  </a>
                  {currentStep.note && (
                    <p className="text-xs text-gray-400 mt-2">{currentStep.note}</p>
                  )}
                </div>
              )}

            {/* Readiness gate (step 7) */}
            {currentStep.key === "readiness" && (
              <ReadinessGate
                items={READINESS_ITEMS}
                getItemPassed={getItemPassed}
                allRequiredPassed={allReadinessPassed && setupChecklist.canSubmit}
                canSubmit={setupChecklist.canSubmit}
                status={status}
                isSubmittingReview={isSubmittingReview}
                submitSuccess={submitSuccess}
                submitError={submitError}
                onSubmit={submitForReview}
              />
            )}

            {/* Need help */}
            <div className="border-t border-gray-100 pt-4">
              {helpAlreadyOpen ? (
                <p className="text-xs text-blue-600 font-bold">
                  Setup assistance has already been requested. Our team will reach out soon.
                </p>
              ) : helpRequestSent ? (
                <p className="text-xs text-green-600 font-bold">Help request sent ✓</p>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">Need help with this step?</span>
                  <button
                    type="button"
                    onClick={requestHelp}
                    disabled={isRequestingHelp}
                    className="text-xs font-black text-orange-600 hover:text-orange-700 transition-colors disabled:opacity-50"
                  >
                    {isRequestingHelp ? "Sending…" : "Request Setup Help →"}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Bottom navigation */}
        <div className="flex items-center justify-between py-4 mb-6">
          <a
            href={`/admin/${slug}/dashboard`}
            className="text-sm font-bold text-gray-400 hover:text-gray-600 transition-colors"
          >
            Save &amp; continue later
          </a>
          <div className="flex items-center gap-2">
            {step > 1 && (
              <button
                type="button"
                onClick={() => goTo(step - 1)}
                className="inline-flex items-center gap-1.5 text-sm font-bold text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 px-4 py-2 rounded-xl transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back
              </button>
            )}
            {currentStep.optional && !stepComplete && step < TOTAL && (
              <button
                type="button"
                onClick={() => goTo(step + 1)}
                className="text-sm font-bold text-gray-400 hover:text-gray-600 transition-colors px-2"
              >
                Skip
              </button>
            )}
            {step < TOTAL && (
              <button
                type="button"
                onClick={() => goTo(step + 1)}
                className="inline-flex items-center gap-1.5 text-sm font-bold text-white bg-gray-900 hover:bg-black px-4 py-2 rounded-xl transition-colors"
              >
                Next
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}

/* ── Readiness Gate (Step 7) ─────────────────────────────────────────── */

type ReadinessItem = { label: string; checkKey: string; required: boolean };

function ReadinessGate({
  items,
  getItemPassed,
  allRequiredPassed,
  canSubmit,
  status,
  isSubmittingReview,
  submitSuccess,
  submitError,
  onSubmit,
}: {
  items: ReadinessItem[];
  getItemPassed: (key: string) => boolean;
  allRequiredPassed: boolean;
  canSubmit: boolean;
  status: string;
  isSubmittingReview: boolean;
  submitSuccess: boolean;
  submitError: string | null;
  onSubmit: () => void;
}) {
  if (submitSuccess) {
    return (
      <div className="text-center py-6">
        <div className="w-14 h-14 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <p className="text-base font-black text-gray-900 mb-1">Submitted for review!</p>
        <p className="text-sm text-gray-500">Taking you back to the dashboard…</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Celebration when all required items pass */}
      {allRequiredPassed && (
        <div className="bg-green-50 border border-green-200 rounded-2xl p-5 text-center">
          <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
            <svg className="w-7 h-7 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-base font-black text-gray-900 mb-1">Your store is ready to launch.</p>
          <p className="text-sm text-gray-500 mb-4">
            {status === "pending_review"
              ? "Your store is currently under review."
              : "Submit for review and our team will activate it."}
          </p>
          {(status === "draft" || status === "rejected") && (
            <button
              type="button"
              onClick={onSubmit}
              disabled={isSubmittingReview || !canSubmit}
              className="bg-orange-600 hover:bg-orange-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-black text-sm px-8 py-3 rounded-xl transition-colors"
            >
              {isSubmittingReview
                ? "Submitting…"
                : status === "rejected"
                ? "Resubmit for Review"
                : "Submit for Review"}
            </button>
          )}
          {submitError && (
            <p className="text-xs text-red-500 mt-3">{submitError}</p>
          )}
        </div>
      )}

      {/* Readiness checklist */}
      <div>
        <p className="text-[11px] font-black text-gray-400 uppercase tracking-widest mb-2">
          {allRequiredPassed ? "All required steps complete" : "Required steps"}
        </p>
        <div className="space-y-2">
          {items
            .filter((i) => i.required)
            .map((item) => {
              const passed = getItemPassed(item.checkKey);
              return (
                <div
                  key={item.checkKey}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${
                    passed ? "bg-gray-50 border-gray-100" : "bg-orange-50 border-orange-100"
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${
                      passed ? "bg-green-100" : "bg-orange-100"
                    }`}
                  >
                    {passed ? (
                      <svg className="w-3 h-3 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg className="w-2.5 h-2.5 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                      </svg>
                    )}
                  </div>
                  <span
                    className={`text-xs font-bold ${
                      passed ? "text-gray-400 line-through" : "text-gray-800"
                    }`}
                  >
                    {item.label}
                  </span>
                </div>
              );
            })}
        </div>
      </div>

      {/* Recommended (optional) items */}
      <div>
        <p className="text-[11px] font-black text-gray-400 uppercase tracking-widest mb-2">
          Recommended
        </p>
        <div className="space-y-2">
          {items
            .filter((i) => !i.required)
            .map((item) => {
              const passed = getItemPassed(item.checkKey);
              return (
                <div
                  key={item.checkKey}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${
                    passed ? "bg-gray-50 border-gray-100" : "bg-white border-gray-100"
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${
                      passed ? "bg-green-100" : "bg-gray-100"
                    }`}
                  >
                    {passed ? (
                      <svg className="w-3 h-3 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg className="w-2.5 h-2.5 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                      </svg>
                    )}
                  </div>
                  <span
                    className={`text-xs font-bold ${
                      passed ? "text-gray-400 line-through" : "text-gray-500"
                    }`}
                  >
                    {item.label}
                  </span>
                  {!passed && (
                    <span className="ml-auto text-[10px] font-black text-gray-400 uppercase tracking-wide">
                      Optional
                    </span>
                  )}
                </div>
              );
            })}
        </div>
      </div>

      {/* Not ready hint */}
      {!allRequiredPassed && (
        <p className="text-xs text-gray-500 pt-1">
          Complete all required steps above to submit your store for review.
        </p>
      )}
    </div>
  );
}
