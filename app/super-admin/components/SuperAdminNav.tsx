"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";

const NAV = [
  { label: "Overview", href: "/super-admin/overview" },
  { label: "Reviews", href: "/super-admin/reviews" },
  { label: "Restaurants", href: "/super-admin/restaurants" },
  { label: "Subscriptions", href: "/super-admin/subscriptions" },
  { label: "Payments", href: "/super-admin/payments" },
  { label: "Plans", href: "/super-admin/plans" },
  { label: "Onboarding", href: "/super-admin/onboarding" },
  { label: "Assistance", href: "/super-admin/assistance" },
];

export default function SuperAdminNav() {
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = async () => {
    await Promise.all([
      signOut(auth),
      fetch("/api/auth/session", { method: "DELETE" }),
    ]);
    router.push("/admin/login");
  };

  return (
    <nav className="bg-gray-900 border-b border-gray-800 px-4">
      <div className="max-w-7xl mx-auto flex h-14 items-center justify-between">
        <div className="flex items-center gap-6 h-full">
          <span className="text-orange-500 font-black text-sm uppercase tracking-widest mr-2">
            Super Admin
          </span>
          {NAV.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`text-xs font-bold h-full flex items-center border-b-2 transition-all ${
                  active
                    ? "border-orange-500 text-orange-400"
                    : "border-transparent text-gray-400 hover:text-white"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
        <button
          onClick={handleLogout}
          className="text-xs font-bold text-gray-500 hover:text-red-400 transition-colors"
        >
          Sign out
        </button>
      </div>
    </nav>
  );
}
