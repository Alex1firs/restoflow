"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useState, useEffect } from "react";
import { Home, ClipboardList, ShoppingCart, Utensils, MoreHorizontal, X } from "lucide-react";

type Props = {
  slug: string;
  role?: "owner" | "manager" | "staff";
};

function DomainDot({ slug }: { slug: string }) {
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/domain")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.domainStatus) setStatus(d.domainStatus); })
      .catch(() => {});
  }, [slug]);

  if (!status) return null;
  const color =
    status === "connected" ? "bg-green-500" :
    status === "pending_dns" ? "bg-yellow-400" :
    status === "error" ? "bg-red-500" : null;

  if (!color) return null;
  return <span className={`ml-1.5 w-2 h-2 rounded-full ${color} inline-block flex-shrink-0`} />;
}

export default function AdminNav({ slug, role = "owner" }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);

  const allItems = [
    { name: "Dashboard", href: `/admin/${slug}/dashboard`, roles: ["owner", "manager", "staff"] },
    { name: "Orders",    href: `/admin/${slug}/orders`,    roles: ["owner", "manager", "staff"] },
    { name: "POS",       href: `/admin/${slug}/pos`,       roles: ["owner", "manager", "staff"] },
    { name: "Kitchen",   href: `/admin/${slug}/kitchen`,   roles: ["owner", "manager", "staff"] },
    { name: "Menu",      href: `/admin/${slug}/menu`,      roles: ["owner", "manager"] },
    { name: "Reports",   href: `/admin/${slug}/reports`,   roles: ["owner", "manager"] },
    { name: "Payments",  href: `/admin/${slug}/payment`,   roles: ["owner"] },
    { name: "Store",     href: `/admin/${slug}/settings`,  roles: ["owner"] },
    { name: "SEO",       href: `/admin/${slug}/seo`,       roles: ["owner", "manager"] },
    { name: "Domain",    href: `/admin/${slug}/domain`,    roles: ["owner"], badge: <DomainDot slug={slug} /> },
    { name: "QR Code",   href: `/admin/${slug}/qr`,        roles: ["owner"] },
    { name: "Staff",     href: `/admin/${slug}/staff`,     roles: ["owner"] },
  ];

  const navItems = allItems.filter((item) => item.roles.includes(role));

  // Bottom nav: 4 fixed primary items
  const bottomPrimary = [
    { name: "Home",    href: `/admin/${slug}/dashboard`, Icon: Home },
    { name: "Orders",  href: `/admin/${slug}/orders`,    Icon: ClipboardList },
    { name: "POS",     href: `/admin/${slug}/pos`,       Icon: ShoppingCart },
    { name: "Kitchen", href: `/admin/${slug}/kitchen`,   Icon: Utensils },
  ];

  // "More" drawer: everything not in the 4 primary items
  const primaryNames = new Set(["Dashboard", "Orders", "POS", "Kitchen"]);
  const drawerItems = navItems.filter((item) => !primaryNames.has(item.name));

  // Full-screen views handle their own layout — hide bottom nav there
  const isFullScreen = pathname === `/admin/${slug}/kitchen` || pathname === `/admin/${slug}/pos`;

  const handleLogout = async () => {
    await Promise.all([
      signOut(auth),
      fetch("/api/auth/session", { method: "DELETE" }),
    ]);
    router.push("/admin/login");
  };

  return (
    <>
      {/* ── Top navigation bar ─────────────────────────────────────────── */}
      <nav className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex h-14 items-center justify-between">
            <div className="flex gap-6 h-full items-center overflow-x-auto">
              {navItems.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`text-sm font-bold transition-all border-b-2 h-full flex items-center px-1 whitespace-nowrap ${
                      isActive
                        ? "border-orange-600 text-orange-600"
                        : "border-transparent text-gray-500 hover:text-gray-900"
                    }`}
                  >
                    {item.name}
                    {"badge" in item ? item.badge : null}
                  </Link>
                );
              })}
            </div>

            <div className="flex items-center gap-3 flex-shrink-0">
              <a
                href={`/r/${slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-bold text-gray-400 hover:text-orange-600 transition-colors px-3 py-1.5 rounded-xl hover:bg-orange-50 border border-gray-100 hover:border-orange-200"
              >
                View Store ↗
              </a>
              <button
                onClick={handleLogout}
                className="text-sm font-bold text-gray-400 hover:text-red-600 transition-colors px-3 py-1.5 rounded-xl hover:bg-red-50"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* ── Mobile: "More" drawer backdrop ─────────────────────────────── */}
      {moreOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setMoreOpen(false)}
        />
      )}

      {/* ── Mobile: "More" slide-up drawer ──────────────────────────────── */}
      {moreOpen && (
        <div
          className="fixed bottom-14 left-0 right-0 z-50 md:hidden bg-white rounded-t-2xl border-t border-gray-200 shadow-2xl"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
            <p className="text-xs font-black text-gray-400 uppercase tracking-widest">More</p>
            <button
              onClick={() => setMoreOpen(false)}
              className="text-gray-400 hover:text-gray-700 p-1"
            >
              <X size={18} />
            </button>
          </div>
          <div className="grid grid-cols-4 gap-1 p-3">
            {drawerItems.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMoreOpen(false)}
                  className={`flex flex-col items-center justify-center gap-1 py-3 px-1 rounded-xl transition-colors text-center ${
                    isActive ? "bg-orange-50 text-orange-600" : "text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  <span className="text-[11px] font-bold leading-tight">{item.name}</span>
                </Link>
              );
            })}
            <button
              onClick={handleLogout}
              className="flex flex-col items-center justify-center gap-1 py-3 px-1 rounded-xl text-red-500 hover:bg-red-50 transition-colors"
            >
              <span className="text-[11px] font-bold">Sign out</span>
            </button>
          </div>

          {/* View Store link in drawer */}
          <div className="px-4 pb-4 pt-1">
            <a
              href={`/r/${slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl border border-gray-200 text-xs font-bold text-gray-500 hover:bg-gray-50 transition-colors"
            >
              View Store ↗
            </a>
          </div>
        </div>
      )}

      {/* ── Mobile: Fixed bottom navigation bar ────────────────────────── */}
      {!isFullScreen && (
        <nav
          className="fixed bottom-0 left-0 right-0 z-40 md:hidden bg-white border-t border-gray-200"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <div className="flex h-14">
            {bottomPrimary.map(({ name, href, Icon }) => {
              const isActive = pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  className={`flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors ${
                    isActive ? "text-orange-600" : "text-gray-400 active:text-gray-700"
                  }`}
                >
                  <Icon size={21} strokeWidth={isActive ? 2.5 : 2} />
                  <span className="text-[10px] font-bold">{name}</span>
                </Link>
              );
            })}
            {/* More button */}
            <button
              onClick={() => setMoreOpen((v) => !v)}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors ${
                moreOpen ? "text-orange-600" : "text-gray-400 active:text-gray-700"
              }`}
            >
              {moreOpen ? <X size={21} /> : <MoreHorizontal size={21} />}
              <span className="text-[10px] font-bold">More</span>
            </button>
          </div>
        </nav>
      )}
    </>
  );
}
