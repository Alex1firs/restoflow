"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Props = {
  slug: string;
};

export default function AdminNav({ slug }: Props) {
  const pathname = usePathname();

  const navItems = [
    { name: "Orders", href: `/admin/${slug}/orders` },
    { name: "Menu", href: `/admin/${slug}/menu` },
  ];

  return (
    <nav className="bg-white border-b border-gray-200">
      <div className="max-w-6xl mx-auto px-4">
        <div className="flex gap-8 h-14 items-center">
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
      </div>
    </nav>
  );
}
