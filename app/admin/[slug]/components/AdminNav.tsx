"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useState, useEffect } from "react";

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

  const allItems = [
    { name: "Dashboard", href: `/admin/${slug}/dashboard`, roles: ["owner", "manager", "staff"] },
    { name: "Orders", href: `/admin/${slug}/orders`, roles: ["owner", "manager", "staff"] },
    { name: "Menu", href: `/admin/${slug}/menu`, roles: ["owner", "manager"] },
    { name: "Reports", href: `/admin/${slug}/reports`, roles: ["owner", "manager"] },
    { name: "Payments", href: `/admin/${slug}/payment`, roles: ["owner"] },
    { name: "Store", href: `/admin/${slug}/settings`, roles: ["owner"] },
    { name: "SEO", href: `/admin/${slug}/seo`, roles: ["owner", "manager"] },
    { name: "Domain", href: `/admin/${slug}/domain`, roles: ["owner"], badge: <DomainDot slug={slug} /> },
    { name: "QR Code", href: `/admin/${slug}/qr`, roles: ["owner"] },
    { name: "Staff", href: `/admin/${slug}/staff`, roles: ["owner"] },
  ];

  const navItems = allItems.filter((item) => item.roles.includes(role));

  const handleLogout = async () => {
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
  );
}
