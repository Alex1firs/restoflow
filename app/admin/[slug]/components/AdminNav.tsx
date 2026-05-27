"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import {
  LayoutDashboard,
  ClipboardList,
  ShoppingCart,
  Utensils,
  ChefHat,
  BarChart2,
  CreditCard,
  Store,
  Heart,
  Search,
  Globe,
  Wifi,
  QrCode,
  Users,
  HelpCircle,
  Wrench,
  Menu as MenuIcon,
  X,
  LogOut,
  ExternalLink,
} from "lucide-react";

type Role = "owner" | "manager" | "staff";

type NavItem = {
  name: string;
  href: string;
  Icon: React.ElementType;
  roles: Role[];
  badge?: React.ReactNode;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

type Props = {
  slug: string;
  role?: Role;
};

function DomainDot({ slug }: { slug: string }) {
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/domain")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.domainStatus) setStatus(d.domainStatus);
      })
      .catch(() => {});
  }, [slug]);

  if (!status) return null;
  const color =
    status === "connected"
      ? "bg-green-500"
      : status === "pending_dns"
      ? "bg-yellow-400"
      : status === "error"
      ? "bg-red-500"
      : null;

  if (!color) return null;
  return (
    <span
      className={`ml-auto w-2 h-2 rounded-full ${color} shrink-0`}
    />
  );
}

function buildGroups(slug: string): NavGroup[] {
  return [
    {
      label: "Operations",
      items: [
        {
          name: "Dashboard",
          href: `/admin/${slug}/dashboard`,
          Icon: LayoutDashboard,
          roles: ["owner", "manager", "staff"],
        },
        {
          name: "Orders",
          href: `/admin/${slug}/orders`,
          Icon: ClipboardList,
          roles: ["owner", "manager", "staff"],
        },
        {
          name: "Kitchen",
          href: `/admin/${slug}/kitchen`,
          Icon: Utensils,
          roles: ["owner", "manager", "staff"],
        },
        {
          name: "POS",
          href: `/admin/${slug}/pos`,
          Icon: ShoppingCart,
          roles: ["owner", "manager", "staff"],
        },
      ],
    },
    {
      label: "Store",
      items: [
        {
          name: "Menu",
          href: `/admin/${slug}/menu`,
          Icon: ChefHat,
          roles: ["owner", "manager"],
        },
        {
          name: "Reports",
          href: `/admin/${slug}/reports`,
          Icon: BarChart2,
          roles: ["owner", "manager"],
        },
        {
          name: "Payments",
          href: `/admin/${slug}/payment`,
          Icon: CreditCard,
          roles: ["owner"],
        },
        {
          name: "Store",
          href: `/admin/${slug}/settings`,
          Icon: Store,
          roles: ["owner"],
        },
        {
          name: "Loyalty",
          href: `/admin/${slug}/loyalty`,
          Icon: Heart,
          roles: ["owner", "manager"],
        },
      ],
    },
    {
      label: "Settings",
      items: [
        {
          name: "SEO",
          href: `/admin/${slug}/seo`,
          Icon: Search,
          roles: ["owner", "manager"],
        },
        {
          name: "Google Business",
          href: `/admin/${slug}/seo/google-business`,
          Icon: Globe,
          roles: ["owner", "manager"],
        },
        {
          name: "Domain",
          href: `/admin/${slug}/domain`,
          Icon: Wifi,
          roles: ["owner"],
        },
        {
          name: "QR Code",
          href: `/admin/${slug}/qr`,
          Icon: QrCode,
          roles: ["owner"],
        },
        {
          name: "Staff",
          href: `/admin/${slug}/staff`,
          Icon: Users,
          roles: ["owner"],
        },
        {
          name: "Setup",
          href: `/admin/${slug}/setup`,
          Icon: Wrench,
          roles: ["owner", "manager"],
        },
        {
          name: "Help",
          href: `/admin/${slug}/help`,
          Icon: HelpCircle,
          roles: ["owner", "manager", "staff"],
        },
      ],
    },
  ];
}

function NavList({
  groups,
  role,
  slug,
  pathname,
  onNavigate,
}: {
  groups: NavGroup[];
  role: Role;
  slug: string;
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex-1 overflow-y-auto py-2">
      {groups.map((group) => {
        const visible = group.items.filter((i) => i.roles.includes(role));
        if (visible.length === 0) return null;
        return (
          <div key={group.label} className="mb-4">
            <p className="px-4 mb-1 text-xs font-black text-gray-400 uppercase tracking-widest">
              {group.label}
            </p>
            <div className="space-y-0.5 px-2">
              {visible.map(({ name, href, Icon }) => {
                const isActive = pathname === href;
                const isDomain = name === "Domain";
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={onNavigate}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                      isActive
                        ? "bg-orange-50 text-orange-600 border border-orange-100"
                        : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                    }`}
                  >
                    <Icon
                      size={16}
                      strokeWidth={isActive ? 2.5 : 2}
                      className="shrink-0"
                    />
                    <span className="flex-1 truncate">{name}</span>
                    {isDomain && <DomainDot slug={slug} />}
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BottomActions({
  slug,
  onLogout,
}: {
  slug: string;
  onLogout: () => void;
}) {
  return (
    <div className="border-t border-gray-100 p-2 space-y-0.5">
      <a
        href={`/r/${slug}`}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
      >
        <ExternalLink size={16} className="shrink-0" />
        <span>View Store</span>
      </a>
      <button
        onClick={onLogout}
        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold text-gray-600 hover:bg-red-50 hover:text-red-600 transition-colors text-left"
      >
        <LogOut size={16} className="shrink-0" />
        <span>Sign Out</span>
      </button>
    </div>
  );
}

export default function AdminNav({ slug, role = "owner" }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const isFullScreen =
    pathname === `/admin/${slug}/kitchen` ||
    pathname === `/admin/${slug}/pos`;

  const groups = buildGroups(slug);

  const handleLogout = async () => {
    setDrawerOpen(false);
    await Promise.all([
      signOut(auth),
      fetch("/api/auth/session", { method: "DELETE" }),
    ]);
    router.push("/admin/login");
  };

  const displayName = slug.replace(/-/g, " ");

  return (
    <>
      {/* ── Desktop sidebar ─────────────────────────────────────────────── */}
      <aside className="hidden lg:flex flex-col w-64 shrink-0 bg-white border-r border-gray-200 sticky top-0 h-screen overflow-hidden">
        {/* Brand */}
        <div className="px-4 py-5 border-b border-gray-100 shrink-0">
          <p className="text-xs font-black text-orange-500 uppercase tracking-widest">
            RestoFlow
          </p>
          <p className="text-sm font-black text-gray-900 truncate capitalize mt-0.5">
            {displayName}
          </p>
        </div>

        <NavList
          groups={groups}
          role={role}
          slug={slug}
          pathname={pathname}
        />

        <BottomActions slug={slug} onLogout={handleLogout} />
      </aside>

      {/* ── Mobile: fixed top bar ───────────────────────────────────────── */}
      <div className="fixed top-0 left-0 right-0 h-14 bg-white border-b border-gray-200 z-30 lg:hidden flex items-center justify-between px-4 gap-3">
        <button
          onClick={() => setDrawerOpen(true)}
          className="p-2 -ml-2 rounded-xl text-gray-600 hover:bg-gray-100 transition-colors"
          aria-label="Open navigation"
        >
          <MenuIcon size={20} />
        </button>
        <p className="text-sm font-black text-gray-900 capitalize truncate flex-1 text-center">
          {displayName}
        </p>
        <a
          href={`/r/${slug}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-bold text-orange-600 hover:text-orange-700 shrink-0"
        >
          Store ↗
        </a>
      </div>

      {/* ── Mobile: drawer backdrop ──────────────────────────────────────── */}
      {drawerOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      {/* ── Mobile: slide-in drawer ──────────────────────────────────────── */}
      <div
        className={`fixed inset-y-0 left-0 z-50 w-72 bg-white flex flex-col lg:hidden shadow-2xl transition-transform duration-300 ease-in-out ${
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Drawer header */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-gray-100 shrink-0">
          <div>
            <p className="text-xs font-black text-orange-500 uppercase tracking-widest">
              RestoFlow
            </p>
            <p className="text-sm font-black text-gray-900 capitalize">
              {displayName}
            </p>
          </div>
          <button
            onClick={() => setDrawerOpen(false)}
            className="p-2 rounded-xl text-gray-400 hover:bg-gray-100 transition-colors"
            aria-label="Close navigation"
          >
            <X size={18} />
          </button>
        </div>

        <NavList
          groups={groups}
          role={role}
          slug={slug}
          pathname={pathname}
          onNavigate={() => setDrawerOpen(false)}
        />

        <div
          className="shrink-0"
          style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom))" }}
        >
          <BottomActions slug={slug} onLogout={handleLogout} />
        </div>
      </div>

      {/* ── Mobile: fixed bottom nav ─────────────────────────────────────── */}
      {!isFullScreen && (
        <nav
          className="fixed bottom-0 left-0 right-0 z-30 lg:hidden bg-white border-t border-gray-200"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <div className="flex h-16">
            {(
              [
                {
                  name: "Home",
                  href: `/admin/${slug}/dashboard`,
                  Icon: LayoutDashboard,
                },
                {
                  name: "Orders",
                  href: `/admin/${slug}/orders`,
                  Icon: ClipboardList,
                },
                {
                  name: "POS",
                  href: `/admin/${slug}/pos`,
                  Icon: ShoppingCart,
                },
                {
                  name: "Kitchen",
                  href: `/admin/${slug}/kitchen`,
                  Icon: Utensils,
                },
              ] as { name: string; href: string; Icon: React.ElementType }[]
            ).map(({ name, href, Icon }) => {
              const isActive = pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  className={`flex-1 flex flex-col items-center justify-center gap-1 transition-colors ${
                    isActive
                      ? "text-orange-600"
                      : "text-gray-400 active:text-gray-700"
                  }`}
                >
                  <Icon size={20} strokeWidth={isActive ? 2.5 : 2} />
                  <span className="text-[10px] font-bold">{name}</span>
                </Link>
              );
            })}
            <button
              onClick={() => setDrawerOpen((v) => !v)}
              className={`flex-1 flex flex-col items-center justify-center gap-1 transition-colors ${
                drawerOpen ? "text-orange-600" : "text-gray-400 active:text-gray-700"
              }`}
            >
              {drawerOpen ? (
                <X size={20} />
              ) : (
                <MenuIcon size={20} />
              )}
              <span className="text-[10px] font-bold">More</span>
            </button>
          </div>
        </nav>
      )}
    </>
  );
}
