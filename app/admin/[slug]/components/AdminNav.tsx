"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";

type Props = {
  slug: string;
};

export default function AdminNav({ slug }: Props) {
  const pathname = usePathname();
  const router = useRouter();

  const navItems = [
    { name: "Orders", href: `/admin/${slug}/orders` },
    { name: "Menu", href: `/admin/${slug}/menu` },
  ];

  const handleLogout = async () => {
    // Clear both the client-side Firebase auth state and the server-side session cookie
    await Promise.all([
      signOut(auth),
      fetch("/api/auth/session", { method: "DELETE" }),
    ]);
    router.push("/admin/login");
  };

  return (
    <nav className="bg-white border-b border-gray-200">
      <div className="max-w-6xl mx-auto px-4">
        <div className="flex h-14 items-center justify-between">
          <div className="flex gap-8 h-full items-center">
            {navItems.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`text-sm font-bold transition-all border-b-2 h-full flex items-center px-1 ${
                    isActive
                      ? "border-orange-600 text-orange-600"
                      : "border-transparent text-gray-500 hover:text-gray-900"
                  }`}
                >
                  {item.name}
                </Link>
              );
            })}
          </div>

          <button
            onClick={handleLogout}
            className="text-sm font-bold text-gray-400 hover:text-red-600 transition-colors px-3 py-1.5 rounded-xl hover:bg-red-50"
          >
            Sign out
          </button>
        </div>
      </div>
    </nav>
  );
}
