"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import {
  LayoutDashboard,
  Building2,
  CreditCard,
  BarChart2,
  Layers,
  Wrench,
  HelpCircle,
  Star,
  Menu as MenuIcon,
  X,
  LogOut,
} from "lucide-react";

type NavItem = {
  label: string;
  href: string;
  Icon: React.ElementType;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Platform",
    items: [
      { label: "Overview",      href: "/super-admin/overview",      Icon: LayoutDashboard },
      { label: "Restaurants",   href: "/super-admin/restaurants",   Icon: Building2 },
      { label: "Subscriptions", href: "/super-admin/subscriptions", Icon: CreditCard },
      { label: "Payments",      href: "/super-admin/payments",      Icon: BarChart2 },
      { label: "Plans",         href: "/super-admin/plans",         Icon: Layers },
    ],
  },
  {
    label: "Operations",
    items: [
      { label: "Onboarding", href: "/super-admin/onboarding", Icon: Wrench },
      { label: "Assistance",  href: "/super-admin/assistance",  Icon: HelpCircle },
    ],
  },
  {
    label: "Config",
    items: [
      { label: "Reviews", href: "/super-admin/reviews", Icon: Star },
    ],
  },
];

function NavList({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex-1 overflow-y-auto py-2">
      {NAV_GROUPS.map((group) => (
        <div key={group.label} className="mb-4">
          <p className="px-4 mb-1 text-xs font-black text-gray-500 uppercase tracking-widest">
            {group.label}
          </p>
          <div className="space-y-0.5 px-2">
            {group.items.map(({ label, href, Icon }) => {
              const isActive = pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={onNavigate}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                    isActive
                      ? "bg-gray-800 text-orange-400 border border-gray-700"
                      : "text-gray-400 hover:bg-gray-800 hover:text-white"
                  }`}
                >
                  <Icon
                    size={16}
                    strokeWidth={isActive ? 2.5 : 2}
                    className="shrink-0"
                  />
                  <span className="truncate">{label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function SuperAdminNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const handleLogout = async () => {
    setDrawerOpen(false);
    await Promise.all([
      signOut(auth),
      fetch("/api/auth/session", { method: "DELETE" }),
    ]);
    router.push("/admin/login");
  };

  return (
    <>
      {/* ── Desktop sidebar ─────────────────────────────────────────────── */}
      <aside className="hidden lg:flex flex-col w-56 shrink-0 bg-gray-900 sticky top-0 h-screen overflow-hidden">
        {/* Brand */}
        <div className="px-4 py-5 border-b border-gray-800 shrink-0">
          <p className="text-xs font-black text-orange-500 uppercase tracking-widest">
            RestoFlow
          </p>
          <p className="text-xs font-bold text-gray-400 mt-0.5">
            Super Admin
          </p>
        </div>

        <NavList pathname={pathname} />

        {/* Sign out */}
        <div className="border-t border-gray-800 p-2 shrink-0">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold text-gray-400 hover:bg-gray-800 hover:text-red-400 transition-colors text-left"
          >
            <LogOut size={16} className="shrink-0" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* ── Mobile: fixed top bar ───────────────────────────────────────── */}
      <div className="fixed top-0 left-0 right-0 h-14 bg-gray-900 border-b border-gray-800 z-30 lg:hidden flex items-center justify-between px-4">
        <button
          onClick={() => setDrawerOpen(true)}
          className="p-2 -ml-2 rounded-xl text-gray-400 hover:bg-gray-800 transition-colors"
          aria-label="Open navigation"
        >
          <MenuIcon size={20} />
        </button>
        <p className="text-xs font-black text-orange-500 uppercase tracking-widest">
          Super Admin
        </p>
        <button
          onClick={handleLogout}
          className="text-xs font-bold text-gray-500 hover:text-red-400 transition-colors"
        >
          Sign out
        </button>
      </div>

      {/* ── Mobile: drawer backdrop ──────────────────────────────────────── */}
      {drawerOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 lg:hidden"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      {/* ── Mobile: slide-in drawer ──────────────────────────────────────── */}
      <div
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-gray-900 flex flex-col lg:hidden shadow-2xl transition-transform duration-300 ease-in-out ${
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Drawer header */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-gray-800 shrink-0">
          <div>
            <p className="text-xs font-black text-orange-500 uppercase tracking-widest">
              RestoFlow
            </p>
            <p className="text-xs font-bold text-gray-400 mt-0.5">
              Super Admin
            </p>
          </div>
          <button
            onClick={() => setDrawerOpen(false)}
            className="p-2 rounded-xl text-gray-400 hover:bg-gray-800 transition-colors"
            aria-label="Close navigation"
          >
            <X size={18} />
          </button>
        </div>

        <NavList
          pathname={pathname}
          onNavigate={() => setDrawerOpen(false)}
        />

        <div
          className="border-t border-gray-800 p-2 shrink-0"
          style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom))" }}
        >
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold text-gray-400 hover:bg-gray-800 hover:text-red-400 transition-colors text-left"
          >
            <LogOut size={16} className="shrink-0" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>
    </>
  );
}
