"use client";

import { useState } from "react";
import { signInWithEmailAndPassword, sendPasswordResetEmail } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

type Mode = "login" | "forgot";

export default function LoginClient() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const credential = await signInWithEmailAndPassword(auth, email, password);
      const idToken = await credential.user.getIdToken();

      const sessionRes = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });

      if (!sessionRes.ok) throw new Error("Session creation failed");

      const userDoc = await getDoc(doc(db, "users", credential.user.uid));
      if (!userDoc.exists()) {
        setError("Your account is not linked to any restaurant. Contact support.");
        setLoading(false);
        return;
      }

      const userData = userDoc.data();
      const role = userData.role as string;
      if (role === "super_admin") {
        router.push("/super-admin/overview");
        return;
      }

      const restaurantSlug = userData.restaurantSlug as string;
      router.push(`/admin/${restaurantSlug}/orders`);
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === "auth/user-not-found" || code === "auth/wrong-password" || code === "auth/invalid-credential") {
        setError("Invalid email or password.");
      } else if (code === "auth/too-many-requests") {
        setError("Too many failed attempts. Please try again later.");
      } else {
        setError("Login failed. Please try again.");
      }
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      await sendPasswordResetEmail(auth, email);
      setSuccess("Check your email for a password reset link.");
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === "auth/user-not-found") {
        // Don't reveal whether the email exists
        setSuccess("If that email is registered, you'll receive a reset link.");
      } else {
        setError("Failed to send reset email. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <Link
        href="/"
        className="absolute top-6 left-6 flex items-center gap-2 text-sm font-semibold text-gray-600 hover:text-gray-900 bg-white/80 backdrop-blur-md px-4 py-2 rounded-full border border-gray-200/80 shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 active:translate-y-0"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to home
      </Link>
      <div className="w-full max-w-md">
        <div className="text-center mb-10">
          <h1 className="text-4xl font-black text-gray-900 tracking-tighter italic uppercase">
            RestoFlow
          </h1>
          <p className="text-gray-500 font-medium mt-2">Restaurant Admin Portal</p>
        </div>

        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-8">
          {mode === "login" ? (
            <>
              <h2 className="text-xl font-bold text-gray-900 mb-6">Sign in to your account</h2>

              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@restaurant.com"
                    required
                    autoComplete="email"
                    className="w-full p-3 rounded-xl border border-gray-400 focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none !text-gray-900 placeholder:text-gray-400"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-sm font-bold text-gray-700">Password</label>
                    <button
                      type="button"
                      onClick={() => { setMode("forgot"); setError(null); }}
                      className="text-xs text-orange-600 hover:text-orange-700 font-medium"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    autoComplete="current-password"
                    className="w-full p-3 rounded-xl border border-gray-400 focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none !text-gray-900 placeholder:text-gray-400"
                  />
                </div>

                {error && (
                  <div className="bg-red-50 border border-red-200 text-red-700 text-sm font-medium p-3 rounded-xl">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-orange-600 hover:bg-orange-700 text-white font-black py-4 rounded-2xl uppercase tracking-widest transition-all disabled:opacity-60 mt-2"
                >
                  {loading ? "Signing in…" : "Sign In"}
                </button>
              </form>
            </>
          ) : (
            <>
              <button
                onClick={() => { setMode("login"); setError(null); setSuccess(null); }}
                className="text-sm text-gray-400 hover:text-gray-600 mb-5 flex items-center gap-1"
              >
                ← Back to login
              </button>

              <h2 className="text-xl font-bold text-gray-900 mb-2">Reset your password</h2>
              <p className="text-sm text-gray-500 mb-6">
                Enter your email and we&apos;ll send you a reset link.
              </p>

              <form onSubmit={handleForgotPassword} className="space-y-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@restaurant.com"
                    required
                    autoComplete="email"
                    className="w-full p-3 rounded-xl border border-gray-400 focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none !text-gray-900 placeholder:text-gray-400"
                  />
                </div>

                {error && (
                  <div className="bg-red-50 border border-red-200 text-red-700 text-sm font-medium p-3 rounded-xl">
                    {error}
                  </div>
                )}
                {success && (
                  <div className="bg-green-50 border border-green-200 text-green-700 text-sm font-medium p-3 rounded-xl">
                    {success}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-orange-600 hover:bg-orange-700 text-white font-black py-4 rounded-2xl uppercase tracking-widest transition-all disabled:opacity-60 mt-2"
                >
                  {loading ? "Sending…" : "Send Reset Link"}
                </button>
              </form>
            </>
          )}
        </div>

        <p className="text-center text-xs text-gray-400 mt-6 font-medium">
          Restaurant owners only. Contact your administrator to get access.
        </p>
      </div>
    </div>
  );
}
