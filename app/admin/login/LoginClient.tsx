"use client";

import { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useRouter } from "next/navigation";

export default function LoginClient() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      // 1. Authenticate with Firebase Auth
      const credential = await signInWithEmailAndPassword(auth, email, password);

      // 2. Get a short-lived ID token to exchange for a server-side session cookie
      const idToken = await credential.user.getIdToken();

      // 3. Exchange the ID token for an httpOnly session cookie
      const sessionRes = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });

      if (!sessionRes.ok) {
        throw new Error("Session creation failed");
      }

      // 4. Look up which restaurant this user is linked to
      const userDoc = await getDoc(doc(db, "users", credential.user.uid));
      if (!userDoc.exists()) {
        setError("Your account is not linked to any restaurant. Contact support.");
        setLoading(false);
        return;
      }

      const restaurantSlug = userDoc.data().restaurantSlug as string;

      // 5. Redirect to their own restaurant dashboard
      router.push(`/admin/${restaurantSlug}/orders`);
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (
        code === "auth/user-not-found" ||
        code === "auth/wrong-password" ||
        code === "auth/invalid-credential"
      ) {
        setError("Invalid email or password.");
      } else if (code === "auth/too-many-requests") {
        setError("Too many failed attempts. Please try again later.");
      } else {
        setError("Login failed. Please try again.");
      }
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-10">
          <h1 className="text-4xl font-black text-gray-900 tracking-tighter italic uppercase">
            Rest
          </h1>
          <p className="text-gray-500 font-medium mt-2">Restaurant Admin Portal</p>
        </div>

        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-8">
          <h2 className="text-xl font-bold text-gray-900 mb-6">
            Sign in to your account
          </h2>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@restaurant.com"
                required
                autoComplete="email"
                className="w-full p-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-orange-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="current-password"
                className="w-full p-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-orange-500 outline-none"
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
              className="w-full bg-orange-600 hover:bg-orange-700 text-white font-black py-4 rounded-2xl uppercase tracking-widest transition-all disabled:opacity-60 disabled:cursor-not-allowed mt-2"
            >
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6 font-medium">
          Restaurant owners only. Contact your administrator to get access.
        </p>
      </div>
    </div>
  );
}
