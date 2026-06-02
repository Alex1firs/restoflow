"use client";

import { useState, useEffect } from "react";
import { onAuthStateChanged, sendEmailVerification, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { MailWarning, Send, CheckCircle2, Loader2 } from "lucide-react";

export default function EmailVerificationBanner() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  // If email is already verified, or user is not logged in, or banner is dismissed
  if (!user || user.emailVerified || dismissed) return null;

  const handleSendVerification = async () => {
    setLoading(true);
    setError(null);
    try {
      await sendEmailVerification(user);
      setSent(true);
      // Auto dismiss success state after 15 seconds
      setTimeout(() => setDismissed(true), 15000);
    } catch (err: any) {
      if (err.code === "auth/too-many-requests") {
        setError("Too many requests. Please check your inbox or try again later.");
      } else {
        setError("Failed to send verification email. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-amber-50 dark:bg-amber-950/20 border-b border-amber-200 dark:border-amber-900/40 px-4 py-3.5 transition-all duration-300 animate-scaleUp">
      <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center text-amber-600 dark:text-amber-500 shrink-0 shadow-sm">
            {sent ? <CheckCircle2 size={18} /> : <MailWarning size={18} />}
          </div>
          <div>
            <p className="text-sm font-black text-amber-900 dark:text-amber-300 tracking-tight leading-snug">
              {sent ? "Verification Link Dispatched!" : "Email Verification Required"}
            </p>
            <p className="text-xs font-semibold text-amber-700/80 dark:text-amber-500/80 mt-0.5">
              {sent
                ? `We sent a secure activation link to ${user.email}. Check your spam folder if it doesn't arrive.`
                : "Please verify your email address to secure your restaurant and enable all admin privileges."}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!sent ? (
            <button
              onClick={handleSendVerification}
              disabled={loading}
              className="inline-flex items-center gap-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-extrabold px-4.5 py-2 rounded-2xl text-xs tracking-wider uppercase transition-all shadow-md active:scale-95 active:shadow-sm"
            >
              {loading ? (
                <>
                  <Loader2 size={13} className="animate-spin" />
                  <span>Sending...</span>
                </>
              ) : (
                <>
                  <Send size={13} />
                  <span>Send Link</span>
                </>
              )}
            </button>
          ) : (
            <span className="text-xs font-black text-emerald-600 dark:text-emerald-500 uppercase tracking-widest bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/30 px-3.5 py-1.5 rounded-xl shadow-inner">
              Sent Successfully
            </span>
          )}

          <button
            onClick={() => setDismissed(true)}
            className="text-xs font-bold text-amber-700/60 dark:text-amber-500/60 hover:text-amber-900 dark:hover:text-amber-300 px-2.5 py-2 rounded-xl transition-colors"
          >
            Dismiss
          </button>
        </div>
      </div>
      {error && (
        <div className="max-w-6xl mx-auto mt-2 text-xs font-bold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/20 border border-red-100 dark:border-red-900/30 px-3.5 py-2 rounded-xl">
          ⚠️ {error}
        </div>
      )}
    </div>
  );
}
