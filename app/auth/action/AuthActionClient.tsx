"use client";

import { useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { confirmPasswordReset, verifyPasswordResetCode } from "firebase/auth";
import { auth } from "@/lib/firebase";
import Link from "next/link";

type State = "idle" | "loading" | "success" | "error";

export default function AuthActionClient() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const mode = searchParams.get("mode");
  const oobCode = searchParams.get("oobCode") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [state, setState] = useState<State>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setErrorMsg("Password must be at least 8 characters.");
      setState("error");
      return;
    }
    if (password !== confirm) {
      setErrorMsg("Passwords do not match.");
      setState("error");
      return;
    }

    setState("loading");
    setErrorMsg("");

    try {
      await verifyPasswordResetCode(auth, oobCode);
      await confirmPasswordReset(auth, oobCode, password);
      setState("success");
      setTimeout(() => router.push("/admin/login"), 3000);
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? "";
      if (code === "auth/invalid-action-code" || code === "auth/expired-action-code") {
        setErrorMsg("This reset link has expired or already been used. Please request a new one from the login page.");
      } else if (code === "auth/weak-password") {
        setErrorMsg("Password is too weak. Use at least 8 characters.");
      } else {
        setErrorMsg(`Error: ${code || "unknown"}. Please try again.`);
      }
      setState("error");
    }
  }

  if (mode !== "resetPassword") {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-gray-400">Unknown action.</p>
          <Link href="/" className="text-orange-500 text-sm mt-4 inline-block">Go home</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <Link href="/" className="block text-center mb-10">
          <span className="text-white font-black text-2xl italic">RestoFlow</span>
        </Link>

        {state === "success" ? (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-8 text-center">
            <div className="w-12 h-12 bg-green-500/10 border border-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-xl font-black text-white mb-2">Password set!</h2>
            <p className="text-gray-400 text-sm">Redirecting you to login…</p>
          </div>
        ) : (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-8">
            <h1 className="text-2xl font-black text-white italic uppercase tracking-tight mb-1">
              Set your password
            </h1>
            <p className="text-gray-500 text-sm mb-7">Choose a new password for your account.</p>

            <form onSubmit={handleResetPassword} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">
                  New Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setState("idle"); }}
                  required
                  minLength={8}
                  placeholder="At least 8 characters"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 text-sm focus:outline-none focus:border-orange-500 transition"
                  style={{ color: "white" }}
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">
                  Confirm Password
                </label>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => { setConfirm(e.target.value); setState("idle"); }}
                  required
                  placeholder="Repeat your password"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 text-sm focus:outline-none focus:border-orange-500 transition"
                  style={{ color: "white" }}
                />
              </div>

              {state === "error" && (
                <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
                  {errorMsg}
                </p>
              )}

              <button
                type="submit"
                disabled={state === "loading"}
                className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white font-black text-sm py-3.5 rounded-xl transition mt-2"
              >
                {state === "loading" ? "Saving…" : "Save Password →"}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
